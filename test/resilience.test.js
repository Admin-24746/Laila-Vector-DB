// Resilience tests (docs/06 §7, docs/08 §5 "graceful failure"): when a dependency —
// TEI, Qdrant or the LLM — is down or hung mid-request, endpoints must return PROMPTLY
// with a machine-readable 503 {error:'dependency_unavailable', dependency, detail} so
// Druid falls back to its current logic instead of hanging. LLM failures inside the
// understood paths degrade instead (rewrite → raw query per docs/12 §7, compose →
// guardrail fallback per docs/08 §3) and must stay 200. Offline: deps stubbed via
// buildApp() overrides; lib-level timeout mechanics tested with a mocked global fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/service/app.js';
import { DependencyError } from '../src/lib/errors.js';
import { CONFIG } from '../src/lib/config.js';
import { embedOne } from '../src/lib/embedder.js';
import { chat } from '../src/lib/llm.js';
import { SAFE_FALLBACK } from '../src/service/prompts.js';

// --- fixtures -----------------------------------------------------------------

const CHUNK = {
  chunk_id: 'bundle_combo::fees_edgecases::en',
  entity_id: 'bundle_combo',
  section: 'fees_edgecases',
  language: 'en',
  score: 0.88,
  text: '[Combo Bundle · BTL] Costs 5000 IQD.',
  payload: { chunk_id: 'bundle_combo::fees_edgecases::en', price_iqd: 5000 },
};

const understood = (text) => ({ raw: text, rewritten: null, language: 'en' });

// Healthy-by-default offline app; individual tests break one dependency at a time.
// Passing `key: undefined` removes the stub → buildApp uses the REAL implementation.
function testApp(overrides = {}) {
  const deps = {
    understandQuery: async (text) => understood(text),
    mergedRetrieve: async () => [CHUNK],
    routeMessage: async () => ({
      flow: 'loan_flow', confidence: 0.91, suggested_flow: 'loan_flow',
      alternatives: [], action: 'route', reason: 'x', matches: [],
    }),
    composeAnswer: async () => ({
      answer: 'Combo costs 5000 IQD.', grounded: true, citations: [CHUNK.chunk_id],
      guardrail: { retried: false, blocked: false, violations: [] },
    }),
    entityCard: async () => 'card',
    llmConfigured: () => true,
    qdrantHealthy: async () => true,
    embedderHealthy: async () => true,
    countPoints: async () => 129,
    audit: async () => {},
    serviceToken: null,
    ...overrides,
  };
  for (const k of Object.keys(deps)) if (deps[k] === undefined) delete deps[k];
  return buildApp(deps);
}

const post = (app, url, body) => app.inject({ method: 'POST', url, payload: body });

const teiDown = async () => {
  throw new DependencyError('tei', 'connect ECONNREFUSED 127.0.0.1:8080');
};
const qdrantDown = async () => {
  throw new DependencyError('qdrant', 'connect ECONNREFUSED 127.0.0.1:6333');
};

// --- the 503 failure contract (docs/06 §7 → docs/08 §5) ------------------------

test('/v1/retrieve: TEI down → 503 dependency_unavailable {dependency:"tei"}', async () => {
  const app = testApp({ mergedRetrieve: teiDown });
  const res = await post(app, '/v1/retrieve', { text: 'combo?' });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), {
    error: 'dependency_unavailable',
    dependency: 'tei',
    detail: 'connect ECONNREFUSED 127.0.0.1:8080',
  });
});

test('/v1/retrieve: Qdrant down → 503 with dependency:"qdrant"', async () => {
  const app = testApp({ mergedRetrieve: qdrantDown });
  const res = await post(app, '/v1/retrieve', { text: 'combo?' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().dependency, 'qdrant');
});

test('/v1/retrieve: expand entity_card failure → same 503 contract', async () => {
  const app = testApp({ entityCard: qdrantDown });
  const res = await post(app, '/v1/retrieve', { text: 'combo?', expand: true });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'dependency_unavailable');
});

test('/v1/route: dependency down → 503 dependency_unavailable', async () => {
  const app = testApp({ routeMessage: qdrantDown });
  const res = await post(app, '/v1/route', { text: 'loan' });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(Object.keys(res.json()).sort(), ['dependency', 'detail', 'error']);
});

test('/v1/answer: retrieval failure → 503 (LLM never invoked on missing evidence)', async () => {
  let composed = false;
  const app = testApp({
    mergedRetrieve: teiDown,
    composeAnswer: async () => { composed = true; },
  });
  const res = await post(app, '/v1/answer', { text: 'combo?' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().dependency, 'tei');
  assert.equal(composed, false);
});

test('timed-out dependency wraps into the same contract (no hang reaches Druid)', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const app = testApp({ mergedRetrieve: async () => { throw DependencyError.wrap('tei', timeout); } });
  const res = await post(app, '/v1/retrieve', { text: 'combo?' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().dependency, 'tei');
  assert.match(res.json().detail, /timeout/);
});

test('dependency failures are audited (feeds docs/13 gap report)', async () => {
  const records = [];
  const app = testApp({ mergedRetrieve: teiDown, audit: async (r) => records.push(r) });
  await post(app, '/v1/retrieve', { text: 'combo?' });
  assert.deepEqual(records, [{
    endpoint: '/v1/retrieve', error: 'dependency_unavailable',
    dependency: 'tei', detail: 'connect ECONNREFUSED 127.0.0.1:8080',
  }]);
});

test('untyped (bug) error → 500 internal_error, still prompt JSON', async () => {
  const app = testApp({ mergedRetrieve: async () => { throw new Error('boom'); } });
  const res = await post(app, '/v1/retrieve', { text: 'combo?' });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal_error', detail: 'boom' });
});

test('unparseable JSON body keeps a 4xx, not a 500/503', async () => {
  const app = testApp();
  const res = await app.inject({
    method: 'POST', url: '/v1/retrieve', payload: '{not json',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'bad_request');
});

test('missing text stays the pinned 200 shape even with every dependency down', async () => {
  const app = testApp({ mergedRetrieve: teiDown, routeMessage: qdrantDown, composeAnswer: teiDown });
  for (const url of ['/v1/retrieve', '/v1/route', '/v1/answer']) {
    const res = await post(app, url, {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { error: 'text is required' });
  }
});

// --- LLM degradation stays 200 (docs/12 §7, docs/08 §3 — NOT the 503 path) ------

const HISTORY = [{ role: 'user', text: 'tell me about the combo bundle' }];

// Point the real llm.js client at a fake endpoint and kill fetch, then restore.
function withDeadLlm(t) {
  const saved = { ...CONFIG.llm };
  Object.assign(CONFIG.llm, { baseUrl: 'http://127.0.0.1:9', model: 'test-model', noThink: false });
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  t.after(() => Object.assign(CONFIG.llm, saved));
}

test('/v1/retrieve: LLM down during follow-up rewrite → 200 on the raw query', async (t) => {
  withDeadLlm(t);
  // real understandQuery (not overridden): the follow-up gate fires, the rewrite call
  // fails, and per docs/12 §7 it must fall back to the raw query — never block retrieval.
  const app = testApp({ understandQuery: undefined });
  const res = await post(app, '/v1/retrieve', { text: 'and how do I cancel it?', history: HISTORY });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().query_understanding.rewritten, null);
  assert.equal(res.json().chunks.length, 1);
});

test('/v1/answer: LLM down during compose → 200 guardrail fallback, grounded:false', async (t) => {
  withDeadLlm(t);
  // real composeAnswer (not overridden): both compose attempts fail → safe fallback
  // answer instead of a 503 — Druid sees grounded:false and can escalate (docs/08 §3).
  const app = testApp({ composeAnswer: undefined });
  const res = await post(app, '/v1/answer', { text: 'how much is combo?' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.answer, SAFE_FALLBACK.en);
  assert.equal(body.grounded, false);
  assert.deepEqual(body.citations, [CHUNK.chunk_id]);
});

// --- lib-level mechanics: call sites really produce typed, prompt failures ------

test('embedOne: TEI unreachable → DependencyError("tei")', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(embedOne('hello'), (err) => {
    assert.ok(err instanceof DependencyError);
    assert.equal(err.dependency, 'tei');
    return true;
  });
});

test('embedOne: hung TEI aborts at CONFIG.embedTimeoutMs, not 120 s', async (t) => {
  const saved = CONFIG.embedTimeoutMs;
  CONFIG.embedTimeoutMs = 30;
  t.after(() => { CONFIG.embedTimeoutMs = saved; });
  // fetch that never responds but honors the abort signal — a hung socket
  t.mock.method(globalThis, 'fetch', (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
  }));
  const t0 = Date.now();
  await assert.rejects(embedOne('hello'), (err) => {
    assert.ok(err instanceof DependencyError);
    assert.equal(err.dependency, 'tei');
    return true;
  });
  assert.ok(Date.now() - t0 < 5000, 'must abort at the configured timeout, not hang');
});

test('chat: LLM unreachable → DependencyError("llm") (callers catch and degrade)', async (t) => {
  withDeadLlm(t);
  await assert.rejects(chat([{ role: 'user', content: 'hi' }]), (err) => {
    assert.ok(err instanceof DependencyError);
    assert.equal(err.dependency, 'llm');
    return true;
  });
});

test('DependencyError.wrap: passes typed errors through, wraps raw ones', () => {
  const typed = new DependencyError('qdrant', 'down');
  assert.equal(DependencyError.wrap('tei', typed), typed);
  const wrapped = DependencyError.wrap('tei', new TypeError('fetch failed'));
  assert.equal(wrapped.dependency, 'tei');
  assert.equal(wrapped.detail, 'fetch failed');
});
