// Validation gate (docs/07 §4, docs/25 §5). Errors reject the entity — bad data never
// reaches the index. Warnings (e.g. missing languages) are surfaced but do not block,
// per docs/07: "flag entities missing a language so authoring can fill gaps".

import { requiredLanguages } from './vocab.js';

const STATUSES = ['draft', 'needs_review', 'verified', 'retired'];
const SOURCES = ['api', 'manual', 'mixed'];
const KNOWLEDGE_TYPES = ['bundle', 'service', 'roaming', 'terminology', 'error'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isInt = (v) => Number.isInteger(v);
const isLangMap = (v) => v && typeof v === 'object' && !Array.isArray(v);

function checkEntity(e, { vocab, ids, reqLangs }) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // Universal fields (docs/25 §2)
  if (!e.entity_id || typeof e.entity_id !== 'string') err('entity_id missing');
  if (!e.type || !(e.type in (vocab.entity_types ?? {}))) err(`type "${e.type}" not in entity_types vocab`);
  if (e.entity_id && e.type && !e.entity_id.startsWith(`${e.type}_`)) {
    err(`entity_id "${e.entity_id}" must start with "${e.type}_" (D16)`);
  }
  const subtypes = vocab.entity_types?.[e.type]?.subtypes ?? [];
  if (e.subtype && subtypes.length && !subtypes.includes(e.subtype)) {
    err(`subtype "${e.subtype}" not in vocab for type ${e.type}`);
  }
  if (e.type === 'bundle' && !e.subtype) err('bundle requires a subtype (atl|btl|corporate)');
  if (!STATUSES.includes(e.status)) err(`status "${e.status}" invalid`);
  if (!SOURCES.includes(e.source)) err(`source "${e.source}" invalid`);
  if (!isInt(e.version) || e.version < 1) err('version must be an integer ≥ 1');
  if (!e.updated_at || Number.isNaN(Date.parse(e.updated_at))) err('updated_at missing/unparseable');

  if (!isLangMap(e.names) || Object.keys(e.names).length === 0) {
    err('names must have at least one language');
  } else if (e.type !== 'intent') {
    // Intent names are internal labels — en-only is fine; their multilingual content is `examples`.
    const missing = reqLangs.filter((l) => !e.names[l]);
    if (missing.length) warn(`names missing required languages: ${missing.join(', ')}`);
  }

  if (KNOWLEDGE_TYPES.includes(e.type)) {
    if (!isLangMap(e.description) || Object.keys(e.description).length === 0) {
      err('description must have at least one language');
    } else {
      const missing = reqLangs.filter((l) => !e.description[l]);
      if (missing.length) warn(`description missing required languages: ${missing.join(', ')}`);
    }
  }

  // Bundle numerics (docs/25 §3, D18 — normalized ints)
  if (e.type === 'bundle') {
    if (!isInt(e.bundleId)) err('bundleId must be an integer (system id)');
    if (!isInt(e.price_iqd) || e.price_iqd <= 0) err('price_iqd must be an integer > 0');
    if (!isInt(e.validity_days) || e.validity_days <= 0) err('validity_days must be an integer > 0');
  }
  for (const f of ['data_mb', 'minutes_onnet', 'minutes_offnet', 'sms_onnet', 'sms_offnet',
    'repeat_purchase_fee_iqd', 'repeat_purchase_threshold']) {
    if (e[f] != null && (!isInt(e[f]) || e[f] < 0)) err(`${f} must be a non-negative integer`);
  }

  // Dates
  for (const f of ['valid_from', 'valid_to']) {
    if (e[f] != null && !ISO_DATE.test(e[f])) err(`${f} must be YYYY-MM-DD`);
  }
  if (e.valid_from && e.valid_to && e.valid_from > e.valid_to) err('valid_from > valid_to');

  // Enums from controlled vocab (docs/26)
  for (const loc of e.eligible_locations ?? []) {
    if (!(loc in (vocab.locations ?? {}))) err(`location "${loc}" not in vocab`);
  }
  for (const sc of e.eligible_service_classes ?? []) {
    if (!(sc in (vocab.service_classes ?? {}))) err(`service_class "${sc}" not in vocab`);
  }

  // Intents (docs/02 §2b)
  if (e.type === 'intent') {
    if (!e.target_flow || !(e.target_flow in (vocab.flows ?? {}))) {
      err(`target_flow "${e.target_flow}" not in flows vocab`);
    }
    const total = Object.values(e.examples ?? {}).flat().filter(Boolean).length;
    if (total === 0) err('intent needs at least one example utterance');
  }

  // Referential integrity (docs/25 §5)
  for (const rel of e.conflicts_with ?? []) {
    if (!ids.has(rel)) err(`conflicts_with "${rel}" does not exist`);
  }
  if (e.belongs_to_service && !ids.has(e.belongs_to_service)) {
    err(`belongs_to_service "${e.belongs_to_service}" does not exist`);
  }

  // Consistency flags — intents carry their languages in `examples`, others in `names`
  if (e.languages_present) {
    const declared = new Set(e.languages_present);
    const source = e.type === 'intent' ? e.examples : e.names;
    const actual = new Set(Object.keys(source ?? {}));
    if (declared.size !== actual.size || [...declared].some((l) => !actual.has(l))) {
      warn(`languages_present does not match ${e.type === 'intent' ? 'examples' : 'names'} keys`);
    }
  }

  return { errors, warnings };
}

/** @returns {{valid:object[], rejected:{entity_id:string,errors:string[]}[], warnings:{entity_id:string,warnings:string[]}[]}} */
export function validateEntities(entities, vocab) {
  const reqLangs = requiredLanguages(vocab);
  const ids = new Set(entities.map((e) => e.entity_id));
  const seen = new Set();
  const valid = [];
  const rejected = [];
  const warnings = [];

  for (const e of entities) {
    const { errors, warnings: w } = checkEntity(e, { vocab, ids, reqLangs });
    if (seen.has(e.entity_id)) errors.push(`duplicate entity_id "${e.entity_id}"`);
    seen.add(e.entity_id);
    if (errors.length) rejected.push({ entity_id: e.entity_id ?? '(missing id)', errors });
    else valid.push(e);
    if (w.length) warnings.push({ entity_id: e.entity_id, warnings: w });
  }
  return { valid, rejected, warnings };
}
