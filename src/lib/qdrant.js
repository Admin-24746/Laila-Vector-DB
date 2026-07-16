// Qdrant collection layout per docs/05 §4: one collection, named dense + sparse vectors,
// all metadata as filterable payload. Chunk identity per docs/03 §6.

import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'node:crypto';
import { CONFIG } from './config.js';

// Per-request timeout (client default is 300 s): a hung Qdrant must fail fast so the
// service can 503 and Druid falls back (docs/06 §7). Generous vs the docs/08 §5 latency
// budget; ingestion calls (upsert wait:true, index creation) fit comfortably too.
export const qdrant = new QdrantClient({ url: CONFIG.qdrantUrl, timeout: CONFIG.qdrantTimeoutMs });

// Qdrant point IDs must be integers or UUIDs, so the human chunk key
// ("bundle_1601::overview::en") is hashed into a stable UUID; the key itself
// rides in payload.chunk_id. Same key → same UUID → clean upsert-overwrite.
export function pointIdFor(chunkKey) {
  const digest = createHash('sha1').update(chunkKey, 'utf8').digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const KEYWORD_INDEXES = [
  'entity_id', 'type', 'subtype', 'section', 'language', 'status',
  'target_flow', 'eligible_locations', 'eligible_service_classes',
];
const DATETIME_INDEXES = ['valid_from', 'valid_to'];

export async function collectionExists(name = CONFIG.collection) {
  const { collections } = await qdrant.getCollections();
  return collections.some((c) => c.name === name);
}

export async function ensureCollection({ recreate = false } = {}) {
  const name = CONFIG.collection;
  const exists = await collectionExists(name);
  if (exists && recreate) await qdrant.deleteCollection(name);
  if (exists && !recreate) return false;

  await qdrant.createCollection(name, {
    vectors: { dense: { size: 1024, distance: 'Cosine' } }, // BGE-M3 (docs/04 §6)
    sparse_vectors: { lexical: { modifier: 'idf' } }, // tf client-side + IDF server-side ≈ BM25
  });
  for (const field of KEYWORD_INDEXES) {
    await qdrant.createPayloadIndex(name, { field_name: field, field_schema: 'keyword', wait: true });
  }
  for (const field of DATETIME_INDEXES) {
    await qdrant.createPayloadIndex(name, { field_name: field, field_schema: 'datetime', wait: true });
  }
  return true;
}

// Update = delete-by-entity_id + re-insert (docs/03 §6, docs/07 §6)
export async function deleteEntityPoints(entityId) {
  await qdrant.delete(CONFIG.collection, {
    wait: true,
    filter: { must: [{ key: 'entity_id', match: { value: entityId } }] },
  });
}

/** @param {{id:string, vector:{dense:number[], lexical:{indices:number[],values:number[]}}, payload:object}[]} points */
export async function upsertPoints(points) {
  await qdrant.upsert(CONFIG.collection, { wait: true, points });
}

export async function countPoints() {
  const res = await qdrant.count(CONFIG.collection, { exact: true });
  return res.count;
}

export async function qdrantHealthy() {
  try {
    await qdrant.getCollections();
    return true;
  } catch {
    return false;
  }
}
