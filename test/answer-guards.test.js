// The guards added on 2026-09-12 after an end-to-end usefulness probe.
//
// The number guardrail was already strong, and that was the problem: it has no opinion on a
// claim that contains no numbers. The probe found two failures of exactly that shape —
// the service asked a customer for login credentials, and it invented a definition for a
// programme the corpus only names. Both returned `grounded: true`.
//
// Each test below is the probe finding turned into a pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solicitationViolations, composeAnswer, belowRelevanceFloor } from '../src/service/answer.js';
import { maxRelevance } from '../src/service/retrieve.js';
import { CONFIG } from '../src/lib/config.js';

// ── solicitation guard ───────────────────────────────────────────────────────

test('asking the customer for a credential is a violation', () => {
  // Observed verbatim, 2026-09-12, answering "what is my current balance?".
  const observed = 'To check your current balance, you can log in to your Asiacell account online or through the Asiacell app. Please provide your login credentials so I can assist you further.';
  const v = solicitationViolations(observed);
  assert.ok(v.some((x) => x.startsWith('credential_request')),
    'a customer-service bot asking for credentials is phishing-shaped whoever wrote it');
});

test('asking for account details it cannot use is a violation', () => {
  // Also observed verbatim on the same question.
  const observed = 'To check your current balance, I would need your phone number or account details. Could you please provide that information?';
  assert.ok(solicitationViolations(observed).some((x) => x.startsWith('personal_data_request')),
    'the service has no account access, so collecting this is pointless as well as unsafe');
});

test('an internal identifier in an answer is a violation', () => {
  // Observed: a payload field leaking into customer-facing prose.
  const observed = "I don't have the specific details of your current balance for the bundle with ID 2632.";
  assert.ok(solicitationViolations(observed).some((x) => x.startsWith('internal_id_leak')));
  assert.ok(solicitationViolations('entity_id: bundle_1684').some((x) => x.startsWith('internal_id_leak')));
});

test('the Arabic phrasings are caught too', () => {
  assert.ok(solicitationViolations('يرجى تزويدي كلمة السر حتى أتحقق من حسابك')
    .some((x) => x.startsWith('credential_request')));
  assert.ok(solicitationViolations('زودني رقم الهاتف حتى أتحقق')
    .some((x) => x.startsWith('personal_data_request')));
});

test('a correct answer is not flagged', () => {
  // The shape we WANT for the same question: no ask, no internal id, points elsewhere.
  const good = 'I cannot see account details, so I am not able to check your balance. You can see it in the Asiacell app, or I can connect you with a colleague.';
  assert.deepEqual(solicitationViolations(good), []);
});

test('merely mentioning balance or a product number is not a violation', () => {
  // The guard must not fire on legitimate answers, or it becomes a refusal machine.
  assert.deepEqual(solicitationViolations('RED 15 gives you 45,000 IQD of balance and 200 free SMS.'), []);
  assert.deepEqual(solicitationViolations('Send 1 to 230, or dial *230#.'), []);
  assert.deepEqual(solicitationViolations('The Weekly TikTok bundle costs 2,500 IQD.'), []);
  assert.deepEqual(solicitationViolations('باقة تيك توك الاسبوعية 2,500 دينار.'), []);
});

test('a request word far from the sensitive term does not trip the guard', () => {
  // The 60-char bound is what keeps this a solicitation check rather than a keyword ban —
  // and keeps the regex backtracking linear (the audit checked the safety regexes for ReDoS).
  const unrelated = 'Please note the bundle renews automatically. '
    + 'Separately, our app has a section for managing your line. '
    + 'It also explains what a password reset looks like.';
  assert.deepEqual(solicitationViolations(unrelated), []);
});

// ── relevance ────────────────────────────────────────────────────────────────

test('maxRelevance reports the best cosine score and ignores unknowns', () => {
  assert.equal(maxRelevance([{ relevance: 0.4 }, { relevance: 0.71 }, { relevance: null }]), 0.71);
  assert.equal(maxRelevance([{ relevance: null }]), null, 'unknown is not the same as zero');
  assert.equal(maxRelevance([]), null);
});

const chunk = (relevance, text = 'RED Line is an Asiacell line type.') => ({
  chunk_id: 'service_red_line::overview::en',
  entity_id: 'service_red_line',
  section: 'overview',
  language: 'en',
  score: 1.0, // the fused score an irrelevant chunk can absolutely have
  relevance,
  text,
  payload: { chunk_id: 'service_red_line::overview::en', entity_id: 'service_red_line', text },
});

test('weak evidence abstains without ever calling the LLM', async () => {
  // "what is Eshrat Omar?" retrieved five chunks at a fused score of 1.00 and a cosine of
  // 0.346, and a 3B model invented a definition from them three runs out of three. Below the
  // floor the model is not asked at all — so there is nothing to invent from.
  const out = await composeAnswer({
    question: 'what is Eshrat Omar?',
    results: [chunk(0.346)],
    facts: {},
    language: 'en',
  });
  assert.equal(out.abstained, true);
  assert.equal(out.guardrail.blocked, true);
  assert.match(out.guardrail.violations[0], /below_relevance_floor/);
  assert.match(out.answer, /only help with Asiacell services/,
    'the floor catches off-topic baits too, so the wording names the scope rather than claiming a missing fact');
});

test('a fused score of 1.00 does not rescue irrelevant evidence', () => {
  // The whole point: `score` cannot be used as confidence, which is why `relevance` exists.
  assert.equal(chunk(0.346).score, 1.0);
  assert.ok(chunk(0.346).relevance < CONFIG.answerRelevanceFloor);
});

test('unknown relevance does NOT abstain — that would drop lexical-only matches', () => {
  // A chunk the fusion surfaced from the lexical side can fall outside the dense window.
  // Treating null as 0 would silently discard exactly the matches hybrid search is for.
  // Tested through the predicate rather than composeAnswer: the pass-through path calls the
  // LLM, which would put a 40-second network round trip in an offline unit suite.
  assert.equal(belowRelevanceFloor(null), false);
  assert.equal(belowRelevanceFloor(undefined), false);
  assert.equal(belowRelevanceFloor(0.346, 0.55), true);
  assert.equal(belowRelevanceFloor(0.588, 0.55), false);
  // A floor of 0 disables the gate — the documented escape hatch.
  assert.equal(belowRelevanceFloor(0.1, 0), false);
});
