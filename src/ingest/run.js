// Ingestion pipeline (docs/07): seed files → normalize → validate → chunk ×language
// → embed (TEI) → upsert into Qdrant by entity_id. Hash-based change detection makes
// re-runs incremental and idempotent (§6). Usage: npm run ingest [-- --rebuild|--dry-run]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

function loadSeedEntities() {
  const entities = [];
  const files = readdirSync(SEED_DIR, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.json') && !path.basename(f).startsWith('_'));
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

const contentHash = (e) => {
  const { _file, ...rest } = e;
  return createHash('sha256').update(stableStringify(rest)).digest('hex');
};

const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {});

async function main() {
  const t0 = Date.now();
  console.log(`Ingesting from ${SEED_DIR}${REBUILD ? ' (REBUILD)' : ''}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const vocab = loadVocab();
  const entities = loadSeedEntities();
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

  // Change detection (docs/07 §6)
  const state = REBUILD ? {} : loadState();
  const changed = valid.filter((e) => state[e.entity_id] !== contentHash(e));
  const unchanged = valid.length - changed.length;
  const sourceIds = new Set(valid.map((e) => e.entity_id));
  const removed = Object.keys(state).filter((id) => !sourceIds.has(id));

  // Chunk
  const nameOf = (() => {
    const byId = new Map(entities.map((e) => [e.entity_id, e]));
    return (id, lang) => byId.get(id)?.names?.[lang] ?? byId.get(id)?.names?.en ?? id;
  })();
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

  for (const e of changed) state[e.entity_id] = contentHash(e);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — upserted ${points.length} chunks for ${changed.length} entities; collection now holds ${await countPoints()} points.`);
}

main().catch((err) => {
  console.error(`\nIngestion failed: ${err.message}`);
  process.exit(1);
});
