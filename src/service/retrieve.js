// The ONE retrieval engine (docs/06 §1): normalize → embed → filtered hybrid search →
// assemble. Knowledge retrieval and intent routing both call this with different args.

import { CONFIG } from '../lib/config.js';
import { embedOne } from '../lib/embedder.js';
import { sparseVector } from '../lib/sparse.js';
import { qdrant } from '../lib/qdrant.js';
import { DependencyError } from '../lib/errors.js';

export const KNOWLEDGE_TYPES = ['bundle', 'service', 'roaming', 'terminology', 'error'];

// "Empty condition = unrestricted" semantics (docs/02): match the value OR the field is absent.
const matchOrEmpty = (key, value) => ({
  should: [
    { key, match: { any: [value] } },
    { is_empty: { key } },
  ],
});

export function buildFilter({ types, language, filters = {} }) {
  const must = [
    { key: 'type', match: { any: types } },
  ];
  if (language) must.push({ key: 'language', match: { value: language } });
  if (filters.location) must.push(matchOrEmpty('eligible_locations', filters.location));
  if (filters.service_class) must.push(matchOrEmpty('eligible_service_classes', filters.service_class));

  // Date validity pre-filter (docs/06 §2.2): expired promos can never surface
  const now = new Date().toISOString();
  must.push({ should: [{ key: 'valid_from', range: { lte: now } }, { is_empty: { key: 'valid_from' } }] });
  must.push({ should: [{ key: 'valid_to', range: { gte: now } }, { is_empty: { key: 'valid_to' } }] });

  // Retired content is never answerable; draft content is answerable only in the sandbox
  // (CONFIG.excludeDraft — see lib/config.js). docs/25 §2 status values.
  const blockedStatuses = CONFIG.excludeDraft ? ['retired', 'draft'] : ['retired'];
  return { must, must_not: [{ key: 'status', match: { any: blockedStatuses } }] };
}

/**
 * @param {string} text
 * @param {object} opts
 *   types: entity types to search (default: knowledge types)
 *   topK, language (hard filter — omit for cross-lingual), filters:{location, service_class}
 *   mode: 'hybrid' (RRF dense+lexical — knowledge) | 'dense' (cosine scores — routing,
 *         because RRF fusion scores are rank-based and unusable as confidence thresholds)
 * @returns {Promise<{chunk_id:string, entity_id:string, section:string, language:string, score:number, text:string, payload:object}[]>}
 */
export async function retrieve(text, {
  types = KNOWLEDGE_TYPES, topK = CONFIG.topK, language = null, filters = {}, mode = 'hybrid',
} = {}) {
  const filter = buildFilter({ types, language, filters });
  const dense = await embedOne(text);

  let body;
  if (mode === 'dense') {
    body = { query: dense, using: 'dense', filter, limit: topK, with_payload: true };
  } else {
    const sparse = sparseVector(text);
    const prefetch = [{ query: dense, using: 'dense', filter, limit: topK * 4 }];
    if (sparse.indices.length) {
      prefetch.push({ query: sparse, using: 'lexical', filter, limit: topK * 4 });
    }
    body = { prefetch, query: { fusion: 'rrf' }, limit: topK, with_payload: true };
  }

  let res;
  try {
    res = await qdrant.query(CONFIG.collection, body);
  } catch (err) {
    // Down/hung Qdrant → typed error; the service maps it to 503 (docs/06 §7, docs/08 §5)
    throw DependencyError.wrap('qdrant', err);
  }
  return res.points.map((p) => ({
    chunk_id: p.payload.chunk_id,
    entity_id: p.payload.entity_id,
    section: p.payload.section,
    language: p.payload.language,
    score: p.score,
    text: p.payload.text,
    payload: p.payload,
  }));
}

const FACT_KEYS = [
  'price_iqd', 'validity_days', 'data_mb', 'minutes_onnet', 'minutes_offnet',
  'sms_onnet', 'sms_offnet', 'repeat_purchase_fee_iqd', 'repeat_purchase_threshold',
  'bundleId', 'offerId',
];

// Structured metadata of the top-matched entity — feeds the docs/08 §3 grounding guardrail.
export function groundedFacts(results) {
  const top = results[0];
  if (!top) return {};
  const facts = {};
  for (const k of FACT_KEYS) if (top.payload[k] != null) facts[k] = top.payload[k];
  return facts;
}

// Rough Phase-0 bucket heuristic (docs/00 §4 via docs/08 §2): eligibility-sections → A,
// several close entities → C (comparison), otherwise B (single lookup).
export function bucketHint(results) {
  if (!results.length) return null;
  if (results[0].section === 'eligibility') return 'A';
  const entities = new Set(results.slice(0, 3).map((r) => r.entity_id));
  return entities.size >= 2 ? 'C' : 'B';
}

// Small-to-big expansion (docs/03 §4.4): fetch every section of an entity in one language
// so the LLM can see the full entity card without sacrificing match precision.
export async function entityCard(entityId, language) {
  let res;
  try {
    res = await qdrant.scroll(CONFIG.collection, {
      filter: {
        must: [
          { key: 'entity_id', match: { value: entityId } },
          { key: 'language', match: { value: language } },
        ],
      },
      limit: 32,
      with_payload: true,
    });
  } catch (err) {
    throw DependencyError.wrap('qdrant', err); // docs/06 §7 — expand fails like search fails
  }
  const order = ['overview', 'definition', 'subscribe', 'unsubscribe', 'eligibility', 'fees_edgecases', 'conflicts'];
  return res.points
    .map((p) => p.payload)
    .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
    .map((p) => p.text)
    .join('\n');
}
