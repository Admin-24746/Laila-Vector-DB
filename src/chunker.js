// Section-aware, per-language chunking (doc 03). One chunk = one answerable
// question, prefixed with a contextual header so it stands alone (§4.2).
// Chunk key {entity_id}::{section}::{language} (§6) rides in payload as
// chunk_key; the Qdrant point ID is its UUIDv5 (doc 05 §4).
import { createHash } from "node:crypto";

const LANGS = ["en", "ar", "ckb", "kmr"];

// Deterministic content hash for change detection (doc 07 §6).
export function contentHash(entity) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(stable(entity))).digest("hex");
}

function header(entity, lang) {
  const name = entity.names?.[lang] ?? entity.names?.en ?? entity.entity_id;
  const parts = [name];
  if (entity.subtype) parts.push(`${entity.subtype.toUpperCase()} ${entity.type}`);
  else parts.push(entity.type);
  const aliases = entity.names?.aliases ?? [];
  if (aliases.length > 0) parts.push(`aliases: ${aliases.join(", ")}`);
  return `[${parts.join(" · ")}]`;
}

// Render conditions → eligibility prose per language (doc 03 §4.1). Simple
// templates; an authored `eligibility_prose` on the entity overrides them.
// Non-English templates are functional drafts — native review required (doc 21).
const T = {
  classes: {
    en: (v) => `Available to ${v} service-class lines.`,
    ar: (v) => `متاح لخطوط فئة ${v}.`,
    ckb: (v) => `بەردەستە بۆ هێڵەکانی پۆلی ${v}.`,
    kmr: (v) => `Ji bo xetên celebê ${v} berdest e.`,
  },
  locations: {
    en: (v) => `Available in ${v} only.`,
    ar: (v) => `متوفر في ${v} فقط.`,
    ckb: (v) => `تەنها لە ${v} بەردەستە.`,
    kmr: (v) => `Tenê li ${v} berdest e.`,
  },
  everywhere: {
    en: "Available in all governorates.",
    ar: "متوفر في جميع المحافظات.",
    ckb: "لە هەموو پارێزگاکان بەردەستە.",
    kmr: "Li hemû parêzgehan berdest e.",
  },
  repeatFee: {
    en: (n, fee) => `Subscribing ${n} times in one month adds an extra fee of ${fee} IQD.`,
    ar: (n, fee) => `الاشتراك ${n} مرات بشهر واحد يضيف رسوم اضافية ${fee} دينار.`,
    ckb: (n, fee) => `بەشداریکردن ${n} جار لە یەک مانگدا کرێیەکی زیادەی ${fee} دینار زیاد دەکات.`,
    kmr: (n, fee) => `Abonebûna ${n} caran di mehekê de xercek zêde ya ${fee} dînar zêde dike.`,
  },
  conflicts: {
    en: (v) => `Cannot be active together with: ${v}.`,
    ar: (v) => `لا يمكن تفعيلها مع: ${v}.`,
    ckb: (v) => `ناتوانرێت لەگەڵ ئەمانە چالاک بکرێت: ${v}.`,
    kmr: (v) => `Nikare bi van re çalak be: ${v}.`,
  },
};

function eligibilityText(entity, lang) {
  const authored = entity.eligibility_prose?.[lang];
  if (authored) return authored;
  const c = entity.conditions ?? {};
  const bits = [];
  if (c.eligible_service_classes?.length > 0) bits.push(T.classes[lang](c.eligible_service_classes.join(", ")));
  if (c.eligible_locations?.length > 0) bits.push(T.locations[lang](c.eligible_locations.join(", ")));
  else if (c.eligible_service_classes?.length > 0) bits.push(T.everywhere[lang]);
  return bits.join(" ") || null;
}

function feesText(entity, lang) {
  const authored = entity.fees_prose?.[lang];
  if (authored) return authored;
  const c = entity.conditions ?? {};
  if (Number.isInteger(c.repeat_purchase_fee_iqd) && Number.isInteger(c.repeat_purchase_threshold)) {
    return T.repeatFee[lang](c.repeat_purchase_threshold, c.repeat_purchase_fee_iqd);
  }
  return null;
}

function conflictsText(entity, lang, nameOf) {
  const refs = entity.conflicts_with ?? [];
  if (refs.length === 0) return null;
  const names = refs.map((id) => nameOf(id, lang));
  return T.conflicts[lang](names.join(", "));
}

// chunkEntity(entity, { nameOf }) → [{ chunkKey, section, language, text, payload }]
// nameOf resolves a referenced entity_id to a display name (falls back to the id).
export function chunkEntity(entity, { nameOf = (id) => id } = {}) {
  const chunks = [];
  const langsPresent = LANGS.filter((l) => entity.names?.[l] || entity.description?.[l] || entity.examples?.[l]);
  const push = (section, language, body, { raw = false } = {}) => {
    if (!body) return;
    chunks.push({
      chunkKey: `${entity.entity_id}::${section}::${language}`,
      section,
      language,
      text: raw ? body : `${header(entity, language)} ${body}`,
    });
  };

  for (const lang of langsPresent) {
    if (entity.type === "intent") {
      // Intent examples embed VERBATIM (doc 02 §2b) — no contextual header.
      // The utterance is a proxy for the customer's message; prefixing entity
      // metadata dilutes the match and weakens routing confidence.
      (entity.examples?.[lang] ?? []).forEach((utterance, i) => push(`example_${i + 1}`, lang, utterance, { raw: true }));
      continue;
    }
    if (entity.type === "terminology") {
      push("definition", lang, entity.definition?.[lang]);
      continue;
    }
    if (entity.type === "error") {
      push("explanation", lang, entity.customer_explanation?.[lang]);
      push("resolution", lang, entity.resolution?.[lang]);
      if (lang === "en" && entity.match?.message_patterns?.length > 0) {
        push("match", "en", entity.match.message_patterns.join(" | "));
      }
      continue;
    }
    // bundle / service / roaming — only sections that exist are emitted (doc 03 §4.1)
    push("overview", lang, entity.description?.[lang]);
    push("subscribe", lang, entity.how_to?.subscribe?.[lang]);
    push("unsubscribe", lang, entity.how_to?.unsubscribe?.[lang]);
    push("activate", lang, entity.how_to?.activate?.[lang]);
    push("deactivate", lang, entity.how_to?.deactivate?.[lang]);
    push("eligibility", lang, eligibilityText(entity, lang));
    push("fees_edgecases", lang, feesText(entity, lang));
    push("conflicts", lang, conflictsText(entity, lang, nameOf));
  }

  // Filterable payload shared by every chunk of this entity (docs 03 §5, 05 §4).
  const c = entity.conditions ?? {};
  const facts = entity.facts ?? {};
  const base = {
    entity_id: entity.entity_id,
    type: entity.type,
    subtype: entity.subtype ?? null,
    status: entity.status,
    version: entity.version,
    updated_at: entity.updated_at,
    content_hash: contentHash(entity),
    eligible_locations: c.eligible_locations ?? [],
    eligible_service_classes: c.eligible_service_classes ?? [],
    valid_from: c.valid_from ?? null,
    valid_to: c.valid_to ?? null,
    ...(entity.type === "intent" ? { target_flow: entity.target_flow } : {}),
    ...(Object.keys(facts).length > 0 ? { facts } : {}),
  };

  return chunks.map((ch) => ({
    ...ch,
    payload: { ...base, chunk_key: ch.chunkKey, section: ch.section, language: ch.language, text: ch.text },
  }));
}
