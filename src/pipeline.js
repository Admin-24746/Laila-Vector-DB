// Ingestion pipeline (doc 07): read → validate → hash-skip → chunk → embed →
// delete+upsert per entity. Idempotent: unchanged entities are skipped by hash.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadVocab, validateBatch } from "./schema.js";
import { chunkEntity, contentHash } from "./chunker.js";
import { toSparseVector } from "./sparse.js";
import { uuid5 } from "./uuid5.js";

export function readEntitiesDir(dir) {
  const entities = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const e of Array.isArray(parsed) ? parsed : [parsed]) {
      if (e && typeof e === "object" && !e._doc) entities.push(e);
    }
  }
  return entities;
}

export async function ingest({ dir, embedder, qdrant, log = console.log, requireVerified = false }) {
  const entities = readEntitiesDir(dir);
  const vocab = loadVocab();
  const reports = validateBatch(entities, vocab);

  const summary = { read: entities.length, rejected: 0, skipped: 0, ingested: 0, chunks: 0, warnings: 0 };
  const rejected = reports.filter((r) => !r.ok);
  summary.rejected = rejected.length;
  for (const r of reports) {
    for (const w of r.warnings) { summary.warnings++; log(`  warn  ${r.entity_id}: ${w}`); }
    for (const e of r.errors) log(`  ERROR ${r.entity_id}: ${e}`);
  }
  if (rejected.length > 0) log(`${rejected.length} entity(ies) rejected — bad data never reaches the index (doc 07 §4).`);

  const nameOf = (id, lang) => {
    const target = entities.find((e) => e.entity_id === id);
    return target?.names?.[lang] ?? target?.names?.en ?? id;
  };

  for (const entity of entities) {
    const report = reports.find((r) => r.entity_id === entity.entity_id);
    if (!report?.ok) continue;
    if (requireVerified && entity.status !== "verified") {
      log(`  skip  ${entity.entity_id}: status "${entity.status}" (requireVerified)`);
      summary.skipped++;
      continue;
    }
    if (!requireVerified && entity.status !== "verified") {
      log(`  warn  ${entity.entity_id}: ingesting status "${entity.status}" (alpha sandbox — doc 29 §3)`);
    }

    const hash = contentHash(entity);
    const existing = await qdrant.getEntityHash(entity.entity_id);
    if (existing === hash) {
      summary.skipped++;
      continue;
    }

    const chunks = chunkEntity(entity, { nameOf });
    if (chunks.length === 0) {
      log(`  warn  ${entity.entity_id}: produced 0 chunks — nothing retrievable`);
      continue;
    }
    const vectors = await embedder.embed(chunks.map((c) => c.text));
    await qdrant.deleteByEntityId(entity.entity_id); // atomic per entity (doc 07 §6)
    await qdrant.upsertPoints(chunks.map((c, i) => ({
      id: uuid5(c.chunkKey),
      dense: vectors[i],
      sparse: toSparseVector(c.text),
      payload: c.payload,
    })));
    summary.ingested++;
    summary.chunks += chunks.length;
    log(`  ok    ${entity.entity_id}: ${chunks.length} chunks`);
  }

  log(`ingest: ${summary.ingested} ingested, ${summary.skipped} skipped (unchanged/gated), ${summary.rejected} rejected, ${summary.chunks} chunks upserted, ${summary.warnings} warning(s)`);
  return summary;
}
