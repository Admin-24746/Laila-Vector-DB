// Unit tests (docs/23 §1): normalizer — digit folding (docs/25 §4) and the
// embedding/sparse normalization levels (docs/06 §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDigits, normalizeForEmbedding, normalizeForSparse, tokenizeForSparse,
} from '../src/lib/normalize.js';

test('normalizeDigits folds Arabic-Indic and Eastern Arabic-Indic digits', () => {
  assert.equal(normalizeDigits('٥٠٠٠'), '5000');
  assert.equal(normalizeDigits('۲۵ گیگابایت'), '25 گیگابایت');
  assert.equal(normalizeDigits('باقة ٣ مرات و 28 يوم'), 'باقة 3 مرات و 28 يوم');
  assert.equal(normalizeDigits('no digits'), 'no digits');
});

test('normalizeForEmbedding strips diacritics and tatweel, collapses whitespace', () => {
  assert.equal(normalizeForEmbedding('مَرْحَبًا'), 'مرحبا');
  assert.equal(normalizeForEmbedding('كـــومبو'), 'كومبو');
  assert.equal(normalizeForEmbedding('  spaced   out\ttext \n'), 'spaced out text');
  assert.equal(normalizeForEmbedding('٥٠٠٠ دينار'), '5000 دينار');
});

test('normalizeForSparse folds confusable Arabic/Kurdish letters', () => {
  assert.equal(normalizeForSparse('باقة'), 'باقه'); // ة → ه
  assert.equal(normalizeForSparse('کۆمبۆ'), 'كومبو'); // ک → ك, ۆ → و
  assert.equal(normalizeForSparse('علی'), 'علي'); // Farsi yeh → Arabic yeh
  assert.equal(normalizeForSparse('أسيا إسيا آسيا'), 'اسيا اسيا اسيا'); // hamza forms → bare alef
  assert.equal(normalizeForSparse('COMBO'), 'combo'); // lowercased
});

test('tokenizeForSparse keeps words and digit runs, drops single letters', () => {
  assert.deepEqual(tokenizeForSparse('Combo 5000 IQD!'), ['combo', '5000', 'iqd']);
  assert.deepEqual(tokenizeForSparse('a combo'), ['combo']);
  assert.deepEqual(tokenizeForSparse('*123*1#'), ['123', '1']); // single DIGIT survives
  assert.deepEqual(tokenizeForSparse(''), []);
});
