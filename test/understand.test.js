// Unit tests (docs/23 §1): query understanding (docs/12) — language/script detection
// and the deictic/elliptical follow-up gate. The gate tests are a regression net for
// the 2026-07-16 bug where \b-based patterns could never match Arabic script or
// accented Latin (JS \b only understands ASCII word chars).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, isFollowUp } from '../src/service/understand.js';

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
