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
import { DependencyError } from '../lib/errors.js';
import { qdrantHealthy, countPoints } from '../lib/qdrant.js';
import { embedderHealthy } from '../lib/embedder.js';
import { llmConfigured } from '../lib/llm.js';
import { groundedFacts, bucketHint, entityCard, maxRelevance } from './retrieve.js';
import { routeMessage } from './route.js';
import { understandQuery, mergedRetrieve, detectLanguage, LANG_CODES } from './understand.js';
import { composeAnswer } from './answer.js';
import { detectInjection } from './safety.js';
import { INJECTION_DEFLECTION } from './prompts.js';

const LOG_DIR = path.join(ROOT_DIR, 'logs');

// The path Fastify actually dispatched, independent of how the client wrote the request
// target. Prefer the matched route pattern; fall back to parsing the raw target (which
// discards an absolute-form origin and any query string). Never trust req.url directly.
// `history` arrives from an external caller (docs/08) — a non-array must not turn a
// malformed request into a 500 from inside .find().
const toTurns = (h) => (Array.isArray(h) ? h : []);

export function routedPath(req) {
  const routed = req.routeOptions?.url;
  if (typeof routed === 'string' && routed) return routed;
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    return String(req.url ?? '');
  }
}

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
    detectInjection, llmConfigured, qdrantHealthy, embedderHealthy, countPoints,
    audit: auditToFile, serviceToken: CONFIG.serviceToken,
    ...overrides,
  };

  const app = Fastify({ logger: false });

  // Failure contract (docs/06 §7, docs/08 §5 "graceful failure"): a dependency dying or
  // hanging mid-request must surface promptly as machine-readable JSON — 503 + WHICH
  // dependency — so Druid falls back to its current logic instead of hanging on us.
  // (Malformed-but-parseable requests never reach here: handlers answer those inline.)
  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof DependencyError) {
      await deps.audit({
        endpoint: req.url, error: 'dependency_unavailable',
        dependency: err.dependency, detail: err.detail,
      });
      reply.code(503);
      return { error: 'dependency_unavailable', dependency: err.dependency, detail: err.detail };
    }
    if (err.statusCode && err.statusCode < 500) {
      // Fastify framework errors (unparseable JSON body, etc.) keep their status
      reply.code(err.statusCode);
      return { error: 'bad_request', detail: err.message };
    }
    await deps.audit({ endpoint: req.url, error: 'internal_error', detail: err.message });
    reply.code(500);
    return { error: 'internal_error', detail: err.message };
  });

  // Gate on the ROUTED path, never on `req.url`. RFC 9112 §3.2.2 requires servers to accept
  // an absolute-form request target ("POST http://host/v1/retrieve HTTP/1.1"), and Node then
  // reports the whole URI as req.url — so `req.url.startsWith('/v1/')` is false while the
  // router still dispatches the handler. That was a complete auth bypass (verified 2026-08-21
  // over a raw socket: 200 OK with no token; pinned in test/auth.test.js). `app.inject()`
  // normalizes the target and cannot reproduce it — the regression test uses a real socket.
  app.addHook('onRequest', async (req, reply) => {
    if (!deps.serviceToken) return;
    if (!routedPath(req).startsWith('/v1/')) return;
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
      // Per-chunk `score` orders the list but is rank-based; `max_relevance` is cosine and
      // is the number to threshold on when deciding whether anything here is usable.
      max_relevance: maxRelevance(results),
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

    // Input-side injection filter (docs/17 §2.1): a clear override/canary attempt is
    // deflected deterministically — BEFORE understandQuery, so attacker text never
    // reaches the rewrite LLM and no model output can be echoed back (2026-07-19
    // review). History turns are scanned too: an injection can hide in prior context
    // (docs/17 §2.3). Same response shape as a normal answer (docs/08 §2).
    // Scan BOTH history field names. understand.js builds the rewrite prompt from
    // `t.text ?? t.content`, so scanning only `.text` let an OpenAI-style caller smuggle an
    // injection through `.content` — the exact path the 2026-07-19 ordering fix was meant to
    // close (verified 2026-08-21; pinned in test/safety.test.js).
    const turnText = (h) => h?.text ?? h?.content;
    const injectedTurn = deps.detectInjection(text)
      ? 'text'
      : toTurns(history).find((h) => deps.detectInjection(turnText(h))) ? 'history' : null;
    if (injectedTurn) {
      const lang = LANG_CODES.includes(language) ? language : detectLanguage(text);
      const response = {
        answer: INJECTION_DEFLECTION[lang] ?? INJECTION_DEFLECTION.en,
        grounded: true,
        citations: [],
        grounded_facts: {},
        bucket_hint: null,
        query_understanding: { language: lang, rewritten: null },
        latency_ms: Date.now() - t0,
      };
      await deps.audit({
        endpoint: '/v1/answer', text, language: lang, rewritten: null,
        safety: 'injection_blocked', injection_source: injectedTurn,
        grounded: true, latency_ms: response.latency_ms,
      });
      return response;
    }

    const u = await deps.understandQuery(text, history, language);

    const results = await deps.mergedRetrieve(u, { topK: top_k ?? CONFIG.topK, filters });
    const facts = groundedFacts(results);
    const composed = await deps.composeAnswer({
      question: u.rewritten ?? u.raw, results, facts, language: u.language,
    });

    const response = {
      answer: composed.answer,
      grounded: composed.grounded,
      // True when the service declined to answer rather than composing over weak evidence.
      // `grounded` alone cannot say this: an honest "I don't have that detail" is grounded.
      abstained: composed.abstained ?? false,
      citations: composed.citations,
      grounded_facts: facts,
      bucket_hint: bucketHint(results),
      max_relevance: maxRelevance(results),
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
