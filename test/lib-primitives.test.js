// Unit coverage for the low-level primitives, ported off the legacy `src/*.js` tree when
// it was retired (2026-09-10). The old files were test/sparse_uuid.test.js and the routing
// half of test/retrieve_logic.test.js; the assertions here are the same *behaviours*, moved
// onto the current modules (src/lib/sparse.js, src/lib/qdrant.js, src/service/route.js).
//
// Not ported, deliberately — they tested designs that no longer exist rather than code that
// moved: `applyLangBoost` (the current engine treats language as a HARD filter, docs/06 §2,
// not a soft score boost) and `collectGroundedFacts` (which built a per-entity map; the
// current `groundedFacts` describes the top entity only, docs/08 §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparseVector } from '../src/lib/sparse.js';
import { pointIdFor } from '../src/lib/qdrant.js';
import { decide } from '../src/service/route.js';

// ── lexical sparse vectors (docs/06 §2.1) ────────────────────────────────────
test('sparse vectors are deterministic and carry term frequency', () => {
  const a = sparseVector('combo combo bundle');
  assert.deepEqual(a, sparseVector('combo combo bundle'), 'same text → identical vector');
  assert.equal(a.indices.length, 2, 'two distinct terms');
  assert.equal(a.indices.length, a.values.length, 'indices and values stay aligned');
  assert.ok(a.values.includes(2), 'the repeated term keeps tf=2');
});

test('orthography and digit folding survive into the sparse vector', () => {
  // The whole point of the shared normalizer: ة↔ه, ك↔ک, and Arabic-Indic digits must not
  // produce a different lexical vector, or Arabic/Kurdish lexical search silently misses.
  const pairs = [
    ['باقة كومبو ٥٠٠٠', 'باقه کومبو 5000'],
    ['Combo Bundle', 'combo bundle'],
  ];
  for (const [a, b] of pairs) {
    const [va, vb] = [sparseVector(a), sparseVector(b)];
    assert.deepEqual(new Set(va.indices), new Set(vb.indices), `${a} ≠ ${b}`);
  }
});

test('sparse vector of empty/punctuation-only text is empty, not a crash', () => {
  for (const s of ['', '   ', '!!! ??? ،؛']) {
    const v = sparseVector(s);
    assert.deepEqual(v.indices, [], `expected no terms for ${JSON.stringify(s)}`);
  }
});

// ── point IDs (docs/05 §3) ───────────────────────────────────────────────────
test('pointIdFor is a stable, well-formed UUIDv5', () => {
  const key = 'bundle_1601::fees_edgecases::en';
  const id = pointIdFor(key);
  assert.equal(id, pointIdFor(key), 'same key → same id, which is what makes upsert idempotent');
  assert.notEqual(id, pointIdFor('bundle_1601::fees_edgecases::ar'), 'language must change the id');
  assert.notEqual(id, pointIdFor('bundle_1601::overview::en'), 'section must change the id');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ── routing decision (docs/06 §5, D7) ────────────────────────────────────────
const T = { tauHigh: 0.82, tauLow: 0.65, margin: 0.08 };
const intentHit = (score, flow, chunk_id = `intent_${flow}::example_1::en`) =>
  ({ score, chunk_id, payload: { target_flow: flow, language: 'en' } });

test('routing: confident top with margin → route', () => {
  const d = decide([intentHit(0.91, 'loan_flow'), intentHit(0.62, 'btl_flow')], T);
  assert.equal(d.action, 'route');
  assert.equal(d.flow, 'loan_flow');
});

test('routing: below τ_low, or nothing at all → fallback (never guess)', () => {
  assert.equal(decide([intentHit(0.40, 'loan_flow')], T).action, 'fallback');
  assert.equal(decide([], T).action, 'fallback');
  assert.equal(decide([], T).flow, null);
});

test('routing: an ambiguous close top-2 → clarify, with the rival reported', () => {
  const d = decide([intentHit(0.85, 'loan_flow'), intentHit(0.83, 'btl_flow')], T);
  assert.equal(d.action, 'clarify');
  assert.equal(d.flow, null, 'clarify must not leak a flow into the routing field');
  assert.ok(d.alternatives.length > 0, 'the caller needs the rival to phrase the question');
  assert.equal(d.suggested_flow, 'loan_flow', 'but shadow-mode still sees what it would have picked');
});

test('routing: strong but sub-τ_high → clarify, not route', () => {
  assert.equal(decide([intentHit(0.75, 'loan_flow'), intentHit(0.50, 'btl_flow')], T).action, 'clarify');
});

test('routing: several examples of the SAME flow are agreement, not ambiguity', () => {
  // Two chunks of one intent used to look like a tie; only a different target_flow counts.
  const d = decide([
    intentHit(0.91, 'loan_flow', 'intent_loan::example_1::en'),
    intentHit(0.90, 'loan_flow', 'intent_loan::example_2::ar'),
  ], T);
  assert.equal(d.action, 'route');
  assert.equal(d.flow, 'loan_flow');
  assert.deepEqual(d.alternatives, []);
});
