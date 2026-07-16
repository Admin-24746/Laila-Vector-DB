// The Fastify app behind the retrieval service — the stateless REST contract Druid
// calls (docs/08), plus the flow-builder sandbox console (docs/20 §4) at GET /.
// POST /v1/route (+shadow mode) · POST /v1/retrieve · POST /v1/answer · GET /healthz
//
// buildApp() takes dependency overrides so the contract tests (docs/23 §1) can pin
// the request/response shapes offline — every function that touches Qdrant/TEI/the
// LLM is injectable; defaults are the real implementations. server.js is the entry
// that builds the app and listens.

import Fastify from 'fastify';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, ROOT_DIR } from '../lib/config.js';
import { qdrantHealthy, countPoints } from '../lib/qdrant.js';
import { embedderHealthy } from '../lib/embedder.js';
import { llmConfigured } from '../lib/llm.js';
import { groundedFacts, bucketHint, entityCard } from './retrieve.js';
import { routeMessage } from './route.js';
import { understandQuery, mergedRetrieve, LANG_CODES } from './understand.js';
import { composeAnswer } from './answer.js';

const LOG_DIR = path.join(ROOT_DIR, 'logs');

// Observability per docs/08 §5 — one JSON line per call; feeds the gap report (docs/13)
async function auditToFile(record, file = 'service.jsonl') {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  await mkdir(LOG_DIR, { recursive: true }).catch(() => {});
  await appendFile(path.join(LOG_DIR, file), line + '\n').catch(() => {});
}

// Flow-builder sandbox console (docs/20 §4) — the "try it before it's live" surface.
const CONSOLE_HTML = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'console.html'), 'utf8',
);

export function buildApp(overrides = {}) {
  const deps = {
    understandQuery, mergedRetrieve, routeMessage, composeAnswer, entityCard,
    llmConfigured, qdrantHealthy, embedderHealthy, countPoints,
    audit: auditToFile, serviceToken: CONFIG.serviceToken,
    ...overrides,
  };

  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (req, reply) => {
    if (!deps.serviceToken || !req.url.startsWith('/v1/')) return;
    if (req.headers.authorization !== `Bearer ${deps.serviceToken}`) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  const understandingMeta = (u) => ({ language: u.language, rewritten: u.rewritten });

  app.post('/v1/retrieve', async (req) => {
    const t0 = Date.now();
    const { text, language, history = [], filters = {}, top_k, expand = false } = req.body ?? {};
    if (!text) return { error: 'text is required' };

    const u = await deps.understandQuery(text, history, language);
    const results = await deps.mergedRetrieve(u, {
      topK: top_k ?? CONFIG.topK,
      language: LANG_CODES.includes(language) ? language : null, // explicit code = hard filter; else cross-lingual
      filters,
    });

    const response = {
      chunks: results.map(({ payload, ...r }) => r),
      grounded_facts: groundedFacts(results),
      bucket_hint: bucketHint(results),
      query_understanding: understandingMeta(u),
      latency_ms: Date.now() - t0,
    };
    if (expand && results[0]) {
      response.entity_card = await deps.entityCard(results[0].entity_id, results[0].language);
    }
    await deps.audit({
      endpoint: '/v1/retrieve', text, language: u.language, rewritten: u.rewritten, filters,
      top: results[0]?.chunk_id ?? null, scores: results.map((r) => r.score),
      latency_ms: response.latency_ms,
    });
    return response;
  });

  app.post('/v1/route', async (req) => {
    const t0 = Date.now();
    const { text, language, history = [], session_id, current_flow } = req.body ?? {};
    if (!text) return { error: 'text is required' };

    const u = await deps.understandQuery(text, history, language);
    const { matches, ...decision } = await deps.routeMessage(u.rewritten ?? u.raw);
    const response = {
      ...decision,
      query_understanding: understandingMeta(u),
      latency_ms: Date.now() - t0,
    };

    // Shadow mode (docs/08 §6): caller sends what the old dispatcher chose; we log
    // agreement/disagreement and change nothing.
    if (current_flow) {
      const agrees = decision.suggested_flow === current_flow;
      response.shadow = { current_flow, agrees };
      await deps.audit({
        text, current_flow, suggested_flow: decision.suggested_flow, action: decision.action,
        confidence: decision.confidence, agrees,
      }, 'shadow.jsonl');
    }

    await deps.audit({
      endpoint: '/v1/route', text, language: u.language, rewritten: u.rewritten,
      session_id: session_id ?? null, action: decision.action, flow: decision.flow,
      suggested_flow: decision.suggested_flow, confidence: decision.confidence,
      reason: decision.reason, latency_ms: response.latency_ms,
    });
    return response;
  });

  app.post('/v1/answer', async (req, reply) => {
    const t0 = Date.now();
    if (!deps.llmConfigured()) {
      reply.code(503);
      return {
        error: 'llm_not_configured',
        detail: 'Set LLM_BASE_URL and LLM_MODEL in .env (any OpenAI-compatible endpoint — docs/15 §6). /v1/retrieve works without it.',
      };
    }
    const { text, language, history = [], filters = {}, top_k } = req.body ?? {};
    if (!text) return { error: 'text is required' };

    const u = await deps.understandQuery(text, history, language);
    const results = await deps.mergedRetrieve(u, { topK: top_k ?? CONFIG.topK, filters });
    const facts = groundedFacts(results);
    const composed = await deps.composeAnswer({
      question: u.rewritten ?? u.raw, results, facts, language: u.language,
    });

    const response = {
      answer: composed.answer,
      grounded: composed.grounded,
      citations: composed.citations,
      grounded_facts: facts,
      bucket_hint: bucketHint(results),
      query_understanding: understandingMeta(u),
      latency_ms: Date.now() - t0,
    };
    await deps.audit({
      endpoint: '/v1/answer', text, language: u.language, rewritten: u.rewritten,
      grounded: composed.grounded, guardrail: composed.guardrail,
      citations: composed.citations, latency_ms: response.latency_ms,
    });
    return response;
  });

  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(CONSOLE_HTML));

  app.get('/healthz', async (req, reply) => {
    const [qdrant, tei] = await Promise.all([deps.qdrantHealthy(), deps.embedderHealthy()]);
    const ok = qdrant && tei;
    if (!ok) reply.code(503);
    let points = null;
    if (qdrant) points = await deps.countPoints().catch(() => null);
    return { ok, qdrant, tei, llm: deps.llmConfigured(), collection: CONFIG.collection, points };
  });

  return app;
}
