// Unit tests (docs/23 §1): number-grounding guardrail (docs/08 §3) — every digit in
// an answer must literally exist in the evidence — and the deterministic not-found
// path of composeAnswer (docs/06 §4), which must never touch the LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedNumbers, composeAnswer } from '../src/service/answer.js';
import { NOT_FOUND } from '../src/service/prompts.js';

const results = [
  { chunk_id: 'bundle_1::overview::en', text: 'Combo costs 5000 IQD for 28 days. Dial *123*1# to subscribe.' },
];

test('thousand separators fold before comparison', () => {
  assert.deepEqual(unsupportedNumbers('It costs 5,000 IQD.', results, {}), []);
  assert.deepEqual(unsupportedNumbers('valid for 28 days', results, {}), []);
});

test('numbers absent from evidence are violations', () => {
  assert.deepEqual(unsupportedNumbers('It costs 6000 IQD.', results, {}), ['6000']);
  assert.deepEqual(unsupportedNumbers('You get 300 MB.', results, {}), ['300']);
});

test('structured facts extend the allowed set', () => {
  assert.deepEqual(unsupportedNumbers('You get 300 MB.', results, { data_mb: 300 }), []);
});

test('Arabic-Indic digits in the answer are folded before checking', () => {
  assert.deepEqual(unsupportedNumbers('السعر ٥٠٠٠ دينار', results, {}), []);
  assert.deepEqual(unsupportedNumbers('السعر ٦٠٠٠ دينار', results, {}), ['6000']);
});

test('USSD code segments are checked digit-run by digit-run', () => {
  assert.deepEqual(unsupportedNumbers('Dial *123*1# now', results, {}), []);
  assert.deepEqual(unsupportedNumbers('Dial *999*1# now', results, {}), ['999']);
});

test('empty retrieval → deterministic not-found in the right language, no LLM', async () => {
  const ar = await composeAnswer({ question: 'شنو؟', results: [], facts: {}, language: 'ar' });
  assert.equal(ar.answer, NOT_FOUND.ar);
  assert.equal(ar.grounded, true);
  assert.deepEqual(ar.citations, []);
  assert.equal(ar.guardrail.blocked, false);

  const unknownLang = await composeAnswer({ question: '?', results: [], facts: {}, language: 'xx' });
  assert.equal(unknownLang.answer, NOT_FOUND.en); // unmapped language falls back to en
});
