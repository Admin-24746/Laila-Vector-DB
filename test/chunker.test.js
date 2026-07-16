// Unit tests (docs/23 §1): section-aware chunking (docs/03) — deterministic keys,
// contextual headers, per-language emission, structured facts riding as payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityToChunks } from '../src/lib/chunker.js';

const bundle = {
  entity_id: 'bundle_9001',
  type: 'bundle',
  subtype: 'btl',
  status: 'verified',
  source: 'manual',
  version: 1,
  updated_at: '2026-07-01T00:00:00Z',
  names: { en: 'Test Combo', ar: 'كومبو تجريبي' },
  aliases: ['tc', 'تي سي'],
  description: { en: 'A test bundle.', ar: 'باقة تجريبية.' },
  how_to: { subscribe: { en: 'Dial *123#.' } },
  bundleId: 9001,
  price_iqd: 5000,
  validity_days: 28,
  repeat_purchase_fee_iqd: 2500,
  repeat_purchase_threshold: 3,
  valid_from: '2026-01-01',
  conflicts_with: ['bundle_9002'],
};

const nameOf = (id, lang) => (id === 'bundle_9002' ? (lang === 'ar' ? 'الباقة الأخرى' : 'Other Bundle') : id);

test('knowledge chunks: deterministic keys, only languages that exist', () => {
  const chunks = entityToChunks(bundle, { nameOf });
  const keys = chunks.map((c) => c.chunkKey).sort();
  assert.deepEqual(keys, [
    'bundle_9001::conflicts::ar',
    'bundle_9001::conflicts::en',
    'bundle_9001::eligibility::ar',
    'bundle_9001::eligibility::en',
    'bundle_9001::fees_edgecases::ar',
    'bundle_9001::fees_edgecases::en',
    'bundle_9001::overview::ar',
    'bundle_9001::overview::en',
    'bundle_9001::subscribe::en', // no ar how_to → no ar chunk
  ]);
});

test('knowledge chunks carry the contextual header with name, label, aliases', () => {
  const chunks = entityToChunks(bundle, { nameOf });
  const en = chunks.find((c) => c.chunkKey === 'bundle_9001::overview::en');
  assert.equal(en.text, '[Test Combo · BTL bundle · aliases: tc, تي سي] A test bundle.');
  const ar = chunks.find((c) => c.chunkKey === 'bundle_9001::overview::ar');
  assert.ok(ar.text.startsWith('[كومبو تجريبي · BTL bundle'));
});

test('fees section renders threshold ordinal and formatted fee', () => {
  const chunks = entityToChunks(bundle, { nameOf });
  const fees = chunks.find((c) => c.chunkKey === 'bundle_9001::fees_edgecases::en');
  assert.ok(fees.text.includes('from the 3rd subscription'));
  assert.ok(fees.text.includes('2,500 IQD'));
});

test('conflicts section resolves related entity names per language', () => {
  const chunks = entityToChunks(bundle, { nameOf });
  assert.ok(chunks.find((c) => c.chunkKey === 'bundle_9001::conflicts::en').text.includes('Other Bundle'));
  assert.ok(chunks.find((c) => c.chunkKey === 'bundle_9001::conflicts::ar').text.includes('الباقة الأخرى'));
});

test('payload passes structured facts through and stamps chunk identity', () => {
  const chunks = entityToChunks(bundle, { nameOf });
  const c = chunks.find((x) => x.chunkKey === 'bundle_9001::overview::en');
  assert.equal(c.payload.price_iqd, 5000);
  assert.equal(c.payload.repeat_purchase_threshold, 3);
  assert.equal(c.payload.valid_from, '2026-01-01T00:00:00Z');
  assert.equal(c.payload.chunk_id, c.chunkKey);
  assert.equal(c.payload.section, 'overview');
  assert.equal(c.payload.language, 'en');
});

test('intent examples embed as raw utterances without a header', () => {
  const intent = {
    entity_id: 'intent_test',
    type: 'intent',
    status: 'verified',
    source: 'manual',
    version: 1,
    updated_at: '2026-07-01T00:00:00Z',
    names: { en: 'Test intent' },
    examples: { en: ['lend me credit', 'I need a loan'], ar: ['اريد سلفة'] },
    target_flow: 'loan_flow',
  };
  const chunks = entityToChunks(intent);
  assert.deepEqual(chunks.map((c) => c.chunkKey).sort(), [
    'intent_test::example_1::ar',
    'intent_test::example_1::en',
    'intent_test::example_2::en',
  ]);
  assert.equal(chunks.find((c) => c.chunkKey === 'intent_test::example_1::en').text, 'lend me credit');
});

test('terminology uses definition section instead of overview', () => {
  const term = {
    entity_id: 'terminology_test',
    type: 'terminology',
    status: 'verified',
    source: 'manual',
    version: 1,
    updated_at: '2026-07-01T00:00:00Z',
    names: { en: 'Line' },
    description: { en: 'A line is a SIM subscription.' },
  };
  const chunks = entityToChunks(term);
  assert.deepEqual(chunks.map((c) => c.chunkKey), ['terminology_test::definition::en']);
});
