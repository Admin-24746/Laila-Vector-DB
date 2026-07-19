import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Node < 21.7 — fall back to process env / defaults
  }
}

export const CONFIG = {
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  teiUrl: process.env.TEI_URL ?? 'http://localhost:8080',
  collection: process.env.COLLECTION ?? 'laila_knowledge',
  port: Number(process.env.PORT ?? 8090),
  serviceToken: process.env.SERVICE_TOKEN || null,
  topK: Number(process.env.TOP_K ?? 5),
  // Query-time dependency timeouts, ms (docs/06 §7): a hung TEI/Qdrant must fail fast
  // (→ 503, Druid falls back) rather than hang Druid. Ingestion keeps its own larger
  // embed ceiling (see lib/embedder.js).
  embedTimeoutMs: Number(process.env.EMBED_TIMEOUT_MS ?? 10_000),
  qdrantTimeoutMs: Number(process.env.QDRANT_TIMEOUT_MS ?? 10_000),
  // Routing thresholds (docs/06 §5, D7) — cosine scale; calibrated via `npm run eval:sweep`.
  route: {
    tauHigh: Number(process.env.ROUTE_TAU_HIGH ?? 0.8),
    tauLow: Number(process.env.ROUTE_TAU_LOW ?? 0.6),
    margin: Number(process.env.ROUTE_MARGIN ?? 0.05),
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
    // Qwen3-style thinking models burn the token budget inside <think> and return nothing.
    // "/no_think" is Qwen's soft switch; harmless plain text if sent to other models.
    noThink: process.env.LLM_NO_THINK != null
      ? process.env.LLM_NO_THINK === '1'
      : (process.env.LLM_MODEL ?? '').toLowerCase().includes('qwen3'),
  },
};
