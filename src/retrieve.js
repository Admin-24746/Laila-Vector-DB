// The ONE retrieval engine (doc 06 §1): knowledge retrieval and intent routing
// are the same function called with different arguments. Pipeline per doc 06 §2:
// normalize → detect → embed → (filter+hybrid search) → same-language boost → assemble.
import { config } from "./config.js";
import { normalizeText } from "./normalize.js";
import { detectLanguage } from "./langdetect.js";
import { toSparseVector } from "./sparse.js";
import { buildFilter } from "./qdrant.js";

// Same-language soft boost (doc 12 §4): reorder, never filter. Pure — unit-tested.
export function applyLangBoost(hits, detected, boost = config.langBoost) {
  if (!detected?.language || detected.confidence === "low") return [...hits];
  return hits
    .map((h) => ({ ...h, _adj: h.score + (h.payload?.language === detected.language ? boost : 0) }))
    .sort((a, b) => b._adj - a._adj);
}

// Routing decision (doc 06 §5): route / clarify / fallback on τ + margin.
// LLM tie-breaker is OFF in alpha (doc 08 §5b) → ambiguous resolves to clarify. Pure.
export function decideRoute(hits, { tauHigh = config.tauHigh, tauLow = config.tauLow, margin = config.margin } = {}) {
  const top = hits[0];
  const second = hits[1];
  const alternatives = hits.slice(1, 3).map((h) => ({ flow: h.payload?.target_flow, score: round(h.score) }));

  if (!top || top.score < tauLow) {
    return { action: "fallback", flow: null, confidence: top ? round(top.score) : 0, alternatives, reason: top ? `top score ${round(top.score)} < τ_low ${tauLow}` : "no intent matches" };
  }
  const gap = top.score - (second?.score ?? 0);
  if (top.score >= tauHigh && gap >= margin) {
    return { action: "route", flow: top.payload.target_flow, confidence: round(top.score), alternatives, reason: `matched ${top.payload.chunk_key} (${round(top.score)}), margin ${round(gap)}` };
  }
  return { action: "clarify", flow: null, confidence: round(top.score), alternatives, reason: `ambiguous: top ${round(top.score)} (τ_high ${tauHigh}), margin ${round(gap)} (min ${margin}); LLM tie-breaker OFF in alpha → clarify` };
}

function round(x) { return Math.round(x * 1000) / 1000; }

// grounded_facts per entity (doc 08 §2, refined per doc 29 §3).
export function collectGroundedFacts(hits) {
  const out = {};
  for (const h of hits) {
    const p = h.payload ?? {};
    if (p.facts && !out[p.entity_id]) out[p.entity_id] = p.facts;
  }
  return out;
}

export function createEngine({ embedder, qdrant }) {
  async function search(text, { types, topK, filters = {}, dense: denseOnly = false }) {
    const detected = detectLanguage(text);
    const norm = normalizeText(text);
    const [dense] = await embedder.embed([norm]);
    const filter = buildFilter({ types, ...filters });
    const hits = denseOnly
      ? await qdrant.queryDense({ dense, filter, limit: topK })
      : await qdrant.queryHybrid({ dense, sparse: toSparseVector(norm), filter, limit: topK * 2 });
    return { detected, hits };
  }

  return {
    // Knowledge retrieval (doc 06 §4).
    async retrieve(text, { types = ["bundle", "service", "roaming", "terminology", "error"], topK = 5, filters = {} } = {}) {
      const { detected, hits } = await search(text, { types, topK, filters });
      const ranked = applyLangBoost(hits, detected).slice(0, topK);
      return {
        language: detected,
        chunks: ranked.map((h) => ({
          text: h.payload.text,
          entity_id: h.payload.entity_id,
          chunk_key: h.payload.chunk_key,
          section: h.payload.section,
          language: h.payload.language,
          score: round(h.score),
        })),
        grounded_facts: collectGroundedFacts(ranked),
        bucket_hint: "B", // alpha: no bucket classifier yet (doc 00 §4)
      };
    },

    // Semantic routing (doc 06 §5). Dense cosine so τ thresholds stay meaningful.
    async route(text) {
      const { detected, hits } = await search(text, { types: ["intent"], topK: 5, dense: true });
      const decision = decideRoute(applyLangBoost(hits, detected));
      return { ...decision, language: detected };
    },
  };
}
