import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    // Was a silent catch. A missing API (Node < 20.12) or a malformed line means SERVICE_TOKEN
    // never loads, which turns auth OFF — far too quiet a failure to swallow (audit 2026-08-21).
    console.warn(`WARNING: could not load ${envFile} (${err?.message ?? err}) — using process env / defaults.`);
  }
}

// Numeric env coercion. `Number('')` is 0 and `??` only catches null/undefined, so a
// present-but-empty line (`ROUTE_TAU_HIGH=`) used to silently zero the value — which makes
// the router confidently route a garbage query, zeroes TOP_K, 503s every embed, and moves
// the port (audit 2026-08-22 item 1). Empty, whitespace and non-numeric all fall back to the
// default, loudly.
export function coerceNum(raw, fallback, name = 'value') {
  if (raw == null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`WARNING: ${name}="${raw}" is not a number — using default ${fallback}.`);
    return fallback;
  }
  return parsed;
}

const num = (name, fallback) => coerceNum(process.env[name], fallback, name);

export const CONFIG = {
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  teiUrl: process.env.TEI_URL ?? 'http://localhost:8080',
  collection: process.env.COLLECTION ?? 'laila_knowledge',
  port: num('PORT', 8090),
  serviceToken: process.env.SERVICE_TOKEN || null,
  topK: num('TOP_K', 5),
  // Below this cosine similarity, /v1/answer says it does not have the detail instead of
  // asking a 3B model to compose over evidence that is not about the question. Measured on
  // 2026-09-12 over 17 probes: answerable questions scored 0.588–0.740, questions the corpus
  // cannot answer ("what is Eshrat Omar?" 0.346, "who won the world cup?" 0.368) scored
  // 0.346–0.610. 0.55 keeps every answerable case with headroom and drops the clear misses.
  // Recalibrate with the same probe after the corpus changes materially; 0 disables the gate.
  answerRelevanceFloor: num('ANSWER_RELEVANCE_FLOOR', 0.55),
  // Business timezone. `valid_from`/`valid_to` are calendar dates in Asiacell's local time,
  // so "today" must be resolved there — comparing against UTC expired a promo at 03:00
  // Baghdad instead of local midnight (audit 2026-08-22 item 9).
  timezone: process.env.TIMEZONE || 'Asia/Baghdad',
  // Query-time dependency timeouts, ms (docs/06 §7): a hung TEI/Qdrant must fail fast
  // (→ 503, Druid falls back) rather than hang Druid. Ingestion keeps its own larger
  // embed ceiling (see lib/embedder.js).
  embedTimeoutMs: num('EMBED_TIMEOUT_MS', 10_000),
  qdrantTimeoutMs: num('QDRANT_TIMEOUT_MS', 10_000),
  // Content gate (docs/20, docs/25 §2 `status`). Every shipped seed entity is status:"draft"
  // with invented shortcodes and prices (`attributes.review_note`), and the query filter used
  // to exclude only "retired" — so placeholder facts were answerable. Draft stays visible in
  // the sandbox (that is what the sandbox is for) and is excluded in production. Force either
  // way with EXCLUDE_DRAFT=1|0.
  excludeDraft: process.env.EXCLUDE_DRAFT != null
    ? process.env.EXCLUDE_DRAFT === '1'
    : process.env.NODE_ENV === 'production',
  // Routing thresholds (docs/06 §5, D7) — cosine scale; calibrated via `npm run eval:sweep`.
  route: {
    tauHigh: num('ROUTE_TAU_HIGH', 0.8),
    tauLow: num('ROUTE_TAU_LOW', 0.6),
    margin: num('ROUTE_MARGIN', 0.05),
  },
  // Generation LLM (docs/15 §6) — any OpenAI-compatible endpoint (Ollama, OpenAI, Gemini
  // compat…). Empty = /v1/answer disabled and query rewriting (docs/12) passes through.
  llm: {
    baseUrl: process.env.LLM_BASE_URL || null,
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL || null,
    // Optional separate model for the docs/12 follow-up rewrite call only (probed:
    // small models garble Iraqi-Arabic rewrites; a bigger one may pass the anchor guard).
    rewriteModel: process.env.LLM_REWRITE_MODEL || null,
    // Generation ceilings, ms. Sized for a hosted endpoint; a local model on CPU is far
    // slower and needs these raised or every answer times out into the safe fallback.
    // Measured 2026-09-10 on this laptop: qwen2.5:3b-instruct via Ollama runs ~9 tok/s,
    // so a 900-token answer alone is ~100 s before prompt-eval and model load.
    timeoutMs: num('LLM_TIMEOUT_MS', 60_000),
    rewriteTimeoutMs: num('LLM_REWRITE_TIMEOUT_MS', 15_000),
    // Qwen3-style thinking models burn the token budget inside <think> and return nothing.
    // "/no_think" is Qwen's soft switch; harmless plain text if sent to other models.
    noThink: process.env.LLM_NO_THINK != null
      ? process.env.LLM_NO_THINK === '1'
      : (process.env.LLM_MODEL ?? '').toLowerCase().includes('qwen3'),
  },
};
