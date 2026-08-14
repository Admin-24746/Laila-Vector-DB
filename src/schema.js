// Entity validation — the quality gate of doc 07 §4, field rules of doc 25 §5.
// Bad data never reaches the index: errors reject the entity; warnings pass with a report.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadVocab(path = join(HERE, "..", "content", "vocab.json")) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const vocab = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    vocab[key] = Array.isArray(val) ? val : val.values;
  }
  return vocab;
}

const UNIVERSAL_REQUIRED = ["entity_id", "type", "names", "status", "source", "version", "updated_at"];
const ID_RE = /^[a-z0-9_]+$/;

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function langMapOk(map, languages) {
  return isPlainObject(map) &&
    Object.keys(map).length > 0 &&
    Object.entries(map).every(([k, v]) => (languages.includes(k) || k === "aliases") && (k === "aliases" ? Array.isArray(v) : typeof v === "string" && v.trim() !== ""));
}

// validateEntity(entity, vocab, knownIds) → { ok, errors[], warnings[] }
export function validateEntity(entity, vocab, knownIds = new Set()) {
  const errors = [];
  const warnings = [];
  const e = entity ?? {};
  const languages = vocab.language;

  for (const f of UNIVERSAL_REQUIRED) {
    if (e[f] === undefined || e[f] === null || e[f] === "") errors.push(`missing required field: ${f}`);
  }
  if (typeof e.entity_id === "string" && !ID_RE.test(e.entity_id)) {
    errors.push(`entity_id "${e.entity_id}" must be lowercase [a-z0-9_] (doc 25 §1)`);
  }
  if (e.type && !vocab.entity_type.includes(e.type)) errors.push(`type "${e.type}" not in entity_type vocab`);
  if (e.status && !vocab.status.includes(e.status)) errors.push(`status "${e.status}" not in status vocab`);
  if (e.names && !langMapOk(e.names, languages)) errors.push(`names must map language codes (${languages.join("/")}) to non-empty strings`);

  // Language completeness (doc 07 §4): flag, don't reject — policy pending (doc 21).
  if (isPlainObject(e.names)) {
    const present = languages.filter((l) => e.names[l]);
    const missing = languages.filter((l) => !e.names[l]);
    if (missing.length > 0) warnings.push(`missing language(s): ${missing.join(", ")}`);
    if (Array.isArray(e.languages_present)) {
      const declared = [...e.languages_present].sort().join(",");
      if (declared !== present.sort().join(",")) warnings.push(`languages_present does not match names`);
    }
  }

  const c = e.conditions ?? {};
  const facts = e.facts ?? {};

  if (e.type === "bundle") {
    if (!Number.isInteger(facts.price_iqd) || facts.price_iqd <= 0) errors.push(`bundle requires facts.price_iqd as positive integer (doc 25 §3)`);
    if (!Number.isInteger(facts.validity_days) || facts.validity_days <= 0) errors.push(`bundle requires facts.validity_days as positive integer (doc 25 §3)`);
    if (e.subtype && !vocab.bundle_subtype.includes(e.subtype)) errors.push(`bundle subtype "${e.subtype}" not in vocab`);
    if (!Number.isInteger(facts.bundleId)) errors.push(`bundle requires facts.bundleId (int) — it is the canonical systemId (D16)`);
  }
  if (e.type === "roaming" && e.subtype && !vocab.roaming_subtype.includes(e.subtype)) {
    errors.push(`roaming subtype "${e.subtype}" not in vocab`);
  }
  if (e.type === "intent") {
    if (typeof e.target_flow !== "string" || e.target_flow === "") errors.push(`intent requires target_flow (doc 02 §2b)`);
    const ex = e.examples;
    const ok = isPlainObject(ex) && Object.entries(ex).every(
      ([lang, arr]) => languages.includes(lang) && Array.isArray(arr) && arr.length > 0 && arr.every((s) => typeof s === "string" && s.trim() !== ""),
    ) && Object.keys(ex).length > 0;
    if (!ok) errors.push(`intent requires examples: { lang: [utterance, …] }`);
  }

  for (const [field, list] of [["eligible_locations", vocab.location], ["eligible_service_classes", vocab.service_class]]) {
    const vals = c[field];
    if (vals === undefined) continue;
    if (!Array.isArray(vals)) errors.push(`conditions.${field} must be an array`);
    else for (const v of vals) if (!list.includes(v)) errors.push(`conditions.${field} value "${v}" not in vocab`);
  }
  if (c.valid_from && c.valid_to && String(c.valid_from) > String(c.valid_to)) {
    errors.push(`conditions.valid_from > valid_to`);
  }
  for (const f of ["repeat_purchase_fee_iqd", "repeat_purchase_threshold"]) {
    if (c[f] !== undefined && (!Number.isInteger(c[f]) || c[f] <= 0)) errors.push(`conditions.${f} must be a positive integer`);
  }

  // Referential checks (doc 25 §5) — unknown targets warn (batch order tolerant).
  for (const field of ["conflicts_with", "belongs_to_service"]) {
    const refs = field === "belongs_to_service" ? (e[field] ? [e[field]] : []) : (e[field] ?? []);
    for (const ref of refs) if (!knownIds.has(ref)) warnings.push(`${field} → "${ref}" not found in this batch/index`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// Validate a batch: uniqueness + cross-references across the whole set.
export function validateBatch(entities, vocab) {
  const ids = new Set();
  const dupes = new Set();
  for (const e of entities) {
    if (ids.has(e?.entity_id)) dupes.add(e.entity_id);
    if (e?.entity_id) ids.add(e.entity_id);
  }
  return entities.map((e) => {
    const r = validateEntity(e, vocab, ids);
    if (dupes.has(e?.entity_id)) {
      r.errors.push(`duplicate entity_id "${e.entity_id}" in batch`);
      r.ok = false;
    }
    return { entity_id: e?.entity_id ?? "(missing)", ...r };
  });
}
