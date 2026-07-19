// Unit tests (docs/23 §1): query understanding (docs/12) — language/script detection,
// the deictic/elliptical follow-up gate, and the rewrite anchoring guard. The gate tests
// are a regression net for the 2026-07-16 bug where \b-based patterns could never match
// Arabic script or accented Latin (JS \b only understands ASCII word chars).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, isFollowUp, anchorRatio, rewritePrompt, REWRITE_SYSTEM } from '../src/service/understand.js';

const history = [{ role: 'user', text: 'tell me about the combo bundle' }];

test('detectLanguage: four languages plus Arabizi-as-en', () => {
  assert.equal(detectLanguage('how much is the combo bundle?'), 'en');
  assert.equal(detectLanguage('شنو باقة كومبو؟'), 'ar');
  assert.equal(detectLanguage('وين اقرب مكتب اسياسيل'), 'ar'); // Arabic script, no marker letters → ar
  assert.equal(detectLanguage('ئەوە چۆن هەڵدەوەشێنمەوە؟'), 'ckb');
  assert.equal(detectLanguage('Li Duhok şaxa we heye?'), 'kmr');
  assert.equal(detectLanguage('shlon aghayer il baqa'), 'en'); // Arabizi stays en (soft signal only)
});

test('follow-up gate requires history', () => {
  assert.equal(isFollowUp('and how do I cancel it?', []), false);
  assert.equal(isFollowUp('and how do I cancel it?', undefined), false);
});

test('deictic references fire in all four languages', () => {
  assert.equal(isFollowUp('and how do I cancel it?', history), true);
  assert.equal(isFollowUp('هذا شنو سعره', history), true);
  assert.equal(isFollowUp('ئەوە چۆن هەڵدەوەشێنمەوە؟', history), true);
  assert.equal(isFollowUp('ka ew çiqas e', history), true);
});

test('short elliptical starts fire, including attached Arabic conjunction', () => {
  assert.equal(isFollowUp('and the price?', history), true);
  assert.equal(isFollowUp('وشلون الغيها؟', history), true); // و is written attached
  assert.equal(isFollowUp('شنو عن باقة كومبو', history), true);
});

test('standalone questions do not fire', () => {
  assert.equal(isFollowUp('how much is the combo bundle?', history), false);
  assert.equal(isFollowUp('بيش باقة سوبر نت الشهرية؟', history), false);
  // بس inside a longer word is not the conjunction
  assert.equal(isFollowUp('بسرعة اريد باقة جديدة للنت والمكالمات طويلة', history), false);
  // elliptical start alone does not fire on long messages (> 6 words, no deictic)
  assert.equal(isFollowUp('and please tell me every monthly bundle you offer today', history), false);
});

// Anchoring guard (docs/12 §7): folded orthography must let a correct rewrite through
// while garbled/hallucinated rewrites still fail. Cases from the 2026-07-16 probe.
const comboConversation = 'وشلون الغيها؟\nشنو باقة كومبو؟\nباقة كومبو: 500 دقيقة داخل الشبكة و300 ميغابايت لمدة 4 أسابيع بـ5,000 دينار.';

test('anchoring: correct MSA-shifted rewrite of an Iraqi conversation anchors (أ/ى folds)', () => {
  // 7B's semantically-correct rewrite — ألغى must anchor against الغيها, باقة against باقة
  assert.ok(anchorRatio('كيف ألغى باقة كومبو؟', comboConversation) >= 0.6);
});

test('anchoring: garbled rewrite still fails', () => {
  // 3B's garbled output for the same case — must stay rejected
  assert.ok(anchorRatio('وشلا غيها', comboConversation) < 0.6);
});

test('anchoring: hallucinated different question fails', () => {
  assert.ok(anchorRatio('what is the price of roaming in turkey?', 'tell me about the combo bundle\nCombo gives you 500 minutes.') < 0.6);
});

// Language-matched worked example (probed 2026-07-16): a static Arabic example made the
// 3B model copy it VERBATIM into English rewrites — the example must follow the language.
test('rewrite prompt: example matches the follow-up language', () => {
  assert.ok(rewritePrompt('ar').includes('باقة سوبر نت'));      // Arabic example for ar
  assert.ok(!rewritePrompt('en').includes('باقة سوبر نت'));     // never for en…
  assert.ok(rewritePrompt('en').includes('how much does roaming cost?'));
  assert.ok(!rewritePrompt('ckb').includes('باقة سوبر نت'));    // …or ckb/kmr (near-raw is fine)
  assert.ok(rewritePrompt('kmr').includes('how much does roaming cost?'));
  assert.ok(!REWRITE_SYSTEM.includes('Example:')); // rules stay example-free; selection is per-call
});

test('anchoring: english follow-up rewrite anchors', () => {
  assert.ok(anchorRatio(
    'how do I cancel the combo bundle?',
    'and how do I cancel it?\ntell me about the combo bundle\nCombo gives you 500 on-net minutes for 5,000 IQD.',
  ) >= 0.6);
});
