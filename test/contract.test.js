// Contract tests (docs/23 §1): pin the docs/08 request/response shapes of
// /v1/retrieve, /v1/route, /v1/answer, /healthz and the auth hook, so Druid
// integration has a stable target. Offline: every dependency that touches
// Qdrant/TEI/the LLM is stubbed via buildApp() overrides; requests go through
// Fastify's inject() — no port, no stack. If one of these tests breaks, either
// restore the shape or version the API (docs/08 §5: /v1 must stay stable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/service/app.js';

// --- stub fixtures -----------------------------------------------------------

// What mergedRetrieve resolves with: engine results INCLUDING the raw payload
// (the service must strip `payload` before returning chunks to Druid).
const CHUNK = {
  chunk_id: 'bundle_combo::fees_edgecases::en',
  entity_id: 'bundle_combo',
  section: 'fees_edgecases',
  language: 'en',
  score: 0.88,
  text: '[Combo Bundle · BTL] Costs 5000 IQD. Repeat purchase fee 2,500 IQD.',
  payload: {
    chunk_id: 'bundle_combo::fees_edgecases::en',
    entity_id: 'bundle_combo',
    section: 'fees_edgecases',
    language: 'en',
    text: '[Combo Bundle · BTL] Costs 5000 IQD. Repeat purchase fee 2,500 IQD.',
    type: 'bundle',
    price_iqd: 5000,
    repeat_purchase_fee_iqd: 2500,
    internal_note: 'must never leak to Druid',
  },
};

const ROUTE_DECISION = {
  flow: 'loan_flow',
  confidence: 0.91,
  suggested_flow: 'loan_flow',
  alternatives: [{ flow: 'btl_flow', score: 0.62 }],
  action: 'route',
  reason: 'matched intent_loan_001 (0.91), margin 0.29',
  matches: [{ chunk_id: 'intent_loan_001::x::en', payload: { target_flow: 'loan_flow' } }],
};

const understood = (text) => ({ raw: text, rewritten: null, language: 'en' });

// Offline app: real shape logic (groundedFacts, bucketHint), stubbed I/O, silent audit.
function testApp(overrides = {}) {
  return buildApp({
    understandQuery: async (text) => understood(text),
    mergedRetrieve: async () => [CHUNK],
    routeMessage: async () => ({ ...ROUTE_DECISION }),
    composeAnswer: async () => ({
      answer: 'Combo costs 5000 IQD.',
      grounded: true,
      citations: [CHUNK.chunk_id],
      guardrail: { retried: false, blocked: false, violations: [] },
    }),
    entityCard: async () => 'full entity card text',
    llmConfigured: () => true,
    qdrantHealthy: async () => true,
    embedderHealthy: async () => true,
    countPoints: async () => 129,
    audit: async () => {},
    serviceToken: null,
    ...overrides,
  });
}

const post = (app, url, body) => app.inject({ method: 'POST', url, payload: body });

// --- /v1/retrieve -------------------------------------------------------------

test('/v1/retrieve: response shape per docs/08 §2', async () => {
  const app = testApp();
  const res = await post(app, '/v1/retrieve', { text: 'combo repeat fee?' });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.deepEqual(
    Object.keys(body).sort(),
    ['bucket_hint', 'chunks', 'grounded_facts', 'latency_ms', 'query_understanding'],
  );
  assert.equal(body.chunks.length, 1);
  // Chunk shape: exactly the docs/08 fields — and the raw payload must NOT leak.
  assert.deepEqual(
    Object.keys(body.chunks[0]).sort(),
    ['chunk_id', 'entity_id', 'language', 'score', 'section', 'text'],
  );
  assert.equal(body.chunks[0].chunk_id, CHUNK.chunk_id);
  assert.equal(typeof body.chunks[0].score, 'number');
  // grounded_facts = structured metadata of the top entity (feeds the guardrail)
  assert.deepEqual(body.grounded_facts, { price_iqd: 5000, repeat_purchase_fee_iqd: 2500 });
  assert.ok(['A', 'B', 'C'].includes(body.bucket_hint));
  assert.deepEqual(body.query_understanding, { language: 'en', rewritten: null });
  assert.equal(typeof body.latency_ms, 'number');
});

test('/v1/retrieve: expand=true adds entity_card', async () => {
  const app = testApp();
  const res = await post(app, '/v1/retrieve', { text: 'combo', expand: true });
  assert.equal(res.json().entity_card, 'full entity card text');
  // and without expand it is absent
  const res2 = await post(app, '/v1/retrieve', { text: 'combo' });
  assert.ok(!('entity_card' in res2.json()));
});

test('/v1/retrieve: empty retrieval → empty chunks, {} facts, null bucket_hint', async () => {
  const app = testApp({ mergedRetrieve: async () => [] });
  const body = (await post(app, '/v1/retrieve', { text: 'starlink?' })).json();
  assert.deepEqual(body.chunks, []);
  assert.deepEqual(body.grounded_facts, {});
  assert.equal(body.bucket_hint, null);
});

test('/v1/retrieve: missing text → error object', async () => {
  const app = testApp();
  const body = (await post(app, '/v1/retrieve', {})).json();
  assert.deepEqual(body, { error: 'text is required' });
});

// --- /v1/route ----------------------------------------------------------------

test('/v1/route: response shape per docs/08 §2 (matches never leak)', async () => {
  const app = testApp();
  const res = await post(app, '/v1/route', { text: 'I need loan bundles', session_id: 'abc' });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.deepEqual(
    Object.keys(body).sort(),
    ['action', 'alternatives', 'confidence', 'flow', 'latency_ms',
      'query_understanding', 'reason', 'suggested_flow'],
  );
  assert.equal(body.flow, 'loan_flow');
  assert.equal(body.action, 'route');
  assert.equal(typeof body.confidence, 'number');
  assert.deepEqual(body.alternatives, [{ flow: 'btl_flow', score: 0.62 }]);
  assert.equal(typeof body.reason, 'string');
  // internal engine matches (raw payloads) must not reach Druid
  assert.ok(!('matches' in body));
});

test('/v1/route: action is one of route|clarify|fallback and flow is null unless routing', async () => {
  for (const [action, flow] of [['clarify', null], ['fallback', null], ['route', 'loan_flow']]) {
    const app = testApp({
      routeMessage: async () => ({ ...ROUTE_DECISION, action, flow }),
    });
    const body = (await post(app, '/v1/route', { text: 'x' })).json();
    assert.equal(body.action, action);
    assert.equal(body.flow, flow);
  }
});

test('/v1/route: shadow mode — current_flow → shadow {current_flow, agrees}', async () => {
  const app = testApp();
  const agree = (await post(app, '/v1/route', { text: 'loan', current_flow: 'loan_flow' })).json();
  assert.deepEqual(agree.shadow, { current_flow: 'loan_flow', agrees: true });

  const disagree = (await post(app, '/v1/route', { text: 'loan', current_flow: 'btl_flow' })).json();
  assert.deepEqual(disagree.shadow, { current_flow: 'btl_flow', agrees: false });

  // no current_flow → no shadow key at all
  const plain = (await post(app, '/v1/route', { text: 'loan' })).json();
  assert.ok(!('shadow' in plain));
});

test('/v1/route: missing text → error object', async () => {
  const app = testApp();
  assert.deepEqual((await post(app, '/v1/route', {})).json(), { error: 'text is required' });
});

// --- /v1/answer -----------------------------------------------------------------

test('/v1/answer: response shape per docs/08 §2–3', async () => {
  const app = testApp();
  const res = await post(app, '/v1/answer', { text: 'how much is combo?' });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  assert.deepEqual(
    Object.keys(body).sort(),
    ['answer', 'bucket_hint', 'citations', 'grounded', 'grounded_facts',
      'latency_ms', 'query_understanding'],
  );
  assert.equal(typeof body.answer, 'string');
  assert.equal(typeof body.grounded, 'boolean'); // Druid escalates on grounded:false
  assert.deepEqual(body.citations, [CHUNK.chunk_id]);
  assert.deepEqual(body.grounded_facts, { price_iqd: 5000, repeat_purchase_fee_iqd: 2500 });
});

test('/v1/answer: LLM not configured → 503 llm_not_configured (graceful, docs/06 §7)', async () => {
  const app = testApp({ llmConfigured: () => false });
  const res = await post(app, '/v1/answer', { text: 'x' });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.error, 'llm_not_configured');
  assert.equal(typeof body.detail, 'string');
});

test('/v1/answer: missing text → error object', async () => {
  const app = testApp();
  assert.deepEqual((await post(app, '/v1/answer', {})).json(), { error: 'text is required' });
});

// --- /healthz -------------------------------------------------------------------

test('/healthz: all green → 200 with full status shape', async () => {
  const app = testApp();
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    ok: true, qdrant: true, tei: true, llm: true,
    collection: res.json().collection, points: 129,
  });
  assert.equal(typeof res.json().collection, 'string');
});

test('/healthz: a dependency down → 503, ok:false, which one visible', async () => {
  const app = testApp({ embedderHealthy: async () => false });
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.ok, false);
  assert.equal(body.qdrant, true);
  assert.equal(body.tei, false);
});

// --- auth (docs/08 §5, docs/10) ---------------------------------------------------

test('auth: SERVICE_TOKEN set → /v1/* needs Bearer token; healthz stays open', async () => {
  const app = testApp({ serviceToken: 's3cret' });

  const denied = await post(app, '/v1/retrieve', { text: 'x' });
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(denied.json(), { error: 'unauthorized' });

  const wrong = await app.inject({
    method: 'POST', url: '/v1/retrieve', payload: { text: 'x' },
    headers: { authorization: 'Bearer wrong' },
  });
  assert.equal(wrong.statusCode, 401);

  const allowed = await app.inject({
    method: 'POST', url: '/v1/retrieve', payload: { text: 'x' },
    headers: { authorization: 'Bearer s3cret' },
  });
  assert.equal(allowed.statusCode, 200);

  // healthz is for orchestrators — never behind the token
  const health = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(health.statusCode, 200);
});
