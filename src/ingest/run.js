// Ingestion pipeline (docs/07): seed files → normalize → validate → chunk ×language
// → embed (TEI) → upsert into Qdrant by entity_id. Hash-based change detection makes
// re-runs incremental and idempotent (§6). Usage: npm run ingest [-- --rebuild|--dry-run]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, ROOT_DIR } from '../lib/config.js';
import { loadVocab } from '../lib/vocab.js';
import { validateEntities } from '../lib/validate.js';
import { entityToChunks } from '../lib/chunker.js';
import { embed, embedderHealthy } from '../lib/embedder.js';
import { sparseVector } from '../lib/sparse.js';
import {
  ensureCollection, deleteEntityPoints, upsertPoints, pointIdFor, countPoints, qdrantHealthy,
} from '../lib/qdrant.js';

const SEED_DIR = path.join(ROOT_DIR, 'data', 'seed');
const STATE_FILE = path.join(ROOT_DIR, '.ingest-state.json');
const UPSERT_BATCH = 128;

const args = new Set(process.argv.slice(2));
const REBUILD = args.has('--rebuild');
const DRY_RUN = args.has('--dry-run');

/**
 * The `_` convention marks something as not-for-ingest (`_TEMPLATE.json`). Testing only the
 * BASENAME meant a whole `data/seed/_drafts/` folder was ingested anyway (audit 2026-08-22
 * item 7) — every path segment has to honour the convention.
 * @param {string} rel path relative to the seed dir
 */
export const isIngestableSeedFile = (rel) =>
  rel.endsWith('.json') && !rel.split(/[\\/]/).some((seg) => seg.startsWith('_'));

function loadSeedEntities() {
  const entities = [];
  const files = readdirSync(SEED_DIR, { recursive: true })
    .map(String)
    .filter(isIngestableSeedFile);
  for (const rel of files) {
    const parsed = JSON.parse(readFileSync(path.join(SEED_DIR, rel), 'utf8'));
    for (const e of Array.isArray(parsed) ? parsed : [parsed]) {
      entities.push({ ...e, _file: rel });
    }
  }
  return entities;
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const body = Object.keys(v).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',');
    return `{${body}}`;
  }
  return JSON.stringify(v);
}

/**
 * Everything a chunk's TEXT depends on — not just the entity's own fields.
 * `entityToChunks` bakes in the *names of related entities* (`conflicts_with`, via `nameOf`)
 * and the *vocab labels* of the codes it references. Hashing only the entity meant renaming
 * `bundle_b` left `bundle_a`'s conflict chunk quoting the old name forever: `bundle_a` is
 * byte-identical, so it never re-embeds (audit 2026-08-22 item 4). Only the referenced
 * entries go in, so an unrelated vocab edit still doesn't re-embed the world.
 * @param {object} e @param {{byId:Map<string,object>, vocab:object}} deps
 */
function chunkDeps(e, { byId, vocab }) {
  const related = {};
  for (const id of e.conflicts_with ?? []) related[id] = byId.get(id)?.names ?? null;
  const labels = {};
  for (const [group, codes] of [['locations', e.eligible_locations], ['service_classes', e.eligible_service_classes]]) {
    for (const c of codes ?? []) labels[`${group}.${c}`] = vocab?.[group]?.[c]?.labels ?? null;
  }
  return { related, labels };
}

export const contentHash = (e, deps) => {
  const { _file, ...rest } = e;
  return createHash('sha256')
    .update(stableStringify({ entity: rest, deps: chunkDeps(e, deps) }))
    .digest('hex');
};

const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {});

/**
 * Entities to retire: previously ingested (present in state) but no longer ON DISK.
 * Keyed off every entity read from the seed dir, NOT off the ones that passed validation —
 * see the note at the call site.
 * @param {Record<string,string>} state @param {{entity_id:string}[]} entities
 */
export function retiredIds(state, entities) {
  const sourceIds = new Set(entities.map((e) => e.entity_id));
  return Object.keys(state).filter((id) => !sourceIds.has(id));
}

async function main() {
  const t0 = Date.now();
  console.log(`Ingesting from ${SEED_DIR}${REBUILD ? ' (REBUILD)' : ''}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const vocab = loadVocab();
  const entities = loadSeedEntities();

  // Guard the catastrophic case: an empty or unreadable seed dir would otherwise mark every
  // previously-ingested entity as "removed" and delete the entire live collection, exit 0.
  if (!entities.length && Object.keys(loadState()).length) {
    throw new Error(
      `No entities found in ${SEED_DIR}, but .ingest-state.json lists `
      + `${Object.keys(loadState()).length}. Refusing to retire the whole collection — `
      + 'check the seed directory, or delete .ingest-state.json if this is intentional.',
    );
  }

  const { valid, rejected, warnings } = validateEntities(entities, vocab);

  for (const r of rejected) {
    console.error(`✗ REJECTED ${r.entity_id}: \n    - ${r.errors.join('\n    - ')}`);
  }
  for (const w of warnings) {
    console.warn(`⚠ ${w.entity_id}: ${w.warnings.join('; ')}`);
  }
  if (rejected.length) {
    console.error('\nRejected entities were NOT ingested (previous versions, if any, remain live).');
  }

  // Related-entity lookup — shared by the chunker (`nameOf`) and by the change-detection
  // hash, which must see the same related names the chunker will bake in.
  const byId = new Map(entities.map((e) => [e.entity_id, e]));
  const deps = { byId, vocab };

  // Change detection (docs/07 §6)
  const state = REBUILD ? {} : loadState();
  const changed = valid.filter((e) => state[e.entity_id] !== contentHash(e, deps));
  const unchanged = valid.length - changed.length;
  // Retirement must key off what is ON DISK, not what passed validation. Building this from
  // `valid` meant a REJECTED entity looked "removed" and had all its live points deleted —
  // the exact opposite of the message printed above ("previous versions … remain live"), and
  // an empty/unreadable seed dir silently wiped the whole collection (audit 2026-08-21).
  const removed = retiredIds(state, entities);

  // Chunk
  const nameOf = (id, lang) => byId.get(id)?.names?.[lang] ?? byId.get(id)?.names?.en ?? id;
  const perEntityChunks = changed.map((e) => ({
    entity: e,
    chunks: entityToChunks(e, { vocab, nameOf }),
  }));
  const totalChunks = perEntityChunks.reduce((n, x) => n + x.chunks.length, 0);
  console.log(`\nEntities: ${valid.length} valid (${changed.length} changed, ${unchanged} unchanged, ${rejected.length} rejected) → ${totalChunks} chunks to write`);

  if (DRY_RUN) {
    for (const { entity, chunks } of perEntityChunks) {
      console.log(`\n${entity.entity_id} (${chunks.length} chunks):`);
      for (const c of chunks) console.log(`  ${c.chunkKey}\n    ${c.text}`);
    }
    console.log('\nDry run — nothing written.');
    return;
  }

  if (!(await qdrantHealthy())) throw new Error(`Qdrant not reachable at ${CONFIG.qdrantUrl} — run: npm run stack:up`);
  if (!(await embedderHealthy())) throw new Error(`TEI not reachable at ${CONFIG.teiUrl} — run: npm run stack:up (first start downloads BGE-M3, ~2.3GB)`);

  const created = await ensureCollection({ recreate: REBUILD });
  if (created) console.log(`Collection "${CONFIG.collection}" created (dense 1024 cosine + sparse idf).`);

  // Embed in one flat pass (batched inside the embedder)
  const flat = perEntityChunks.flatMap((x) => x.chunks);
  let embedded = 0;
  const vectors = [];
  for (let i = 0; i < flat.length; i += UPSERT_BATCH) {
    const slice = flat.slice(i, i + UPSERT_BATCH);
    vectors.push(...(await embed(slice.map((c) => c.text))));
    embedded += slice.length;
    process.stdout.write(`\rEmbedding… ${embedded}/${flat.length}`);
  }
  if (flat.length) process.stdout.write('\n');

  // Atomic per entity: delete old points, then upsert new (docs/07 §6)
  const points = flat.map((c, i) => ({
    id: pointIdFor(c.chunkKey),
    vector: { dense: vectors[i], lexical: sparseVector(c.text) },
    payload: c.payload,
  }));
  for (const { entity } of perEntityChunks) await deleteEntityPoints(entity.entity_id);
  for (let i = 0; i < points.length; i += UPSERT_BATCH) {
    await upsertPoints(points.slice(i, i + UPSERT_BATCH));
  }

  // Retire entities whose source file disappeared (docs/07 §7)
  for (const id of removed) {
    await deleteEntityPoints(id);
    delete state[id];
    console.log(`Retired ${id} (source file removed).`);
  }

  for (const e of changed) state[e.entity_id] = contentHash(e, deps);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — upserted ${points.length} chunks for ${changed.length} entities; collection now holds ${await countPoints()} points.`);
}

// Only ingest when this file is the entry point — importing it (e.g. from test/ingest.test.js
// to reach retiredIds) must never kick off a real run against the live collection.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`\nIngestion failed: ${err.message}`);
    process.exit(1);
  });
}
