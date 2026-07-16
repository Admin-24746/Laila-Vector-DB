// Unit tests (docs/23 §1): the validation gate (docs/07 §4, docs/25 §5) —
// errors reject an entity, warnings surface but never block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntities } from '../src/lib/validate.js';

const vocab = {
  languages: { en: { required: true }, ar: { required: true }, ckb: {} },
  entity_types: {
    bundle: { subtypes: ['atl', 'btl', 'corporate'] },
    service: {},
    terminology: {},
    intent: {},
  },
  locations: { baghdad: {}, erbil: {} },
  service_classes: { prepaid: {} },
  flows: { knowledge_flow: {}, loan_flow: {} },
};

const goodBundle = {
  entity_id: 'bundle_9001',
  type: 'bundle',
  subtype: 'btl',
  status: 'verified',
  source: 'manual',
  version: 1,
  updated_at: '2026-07-01T00:00:00Z',
  names: { en: 'Test', ar: 'تجريبي' },
  description: { en: 'Test bundle.', ar: 'باقة.' },
  bundleId: 9001,
  price_iqd: 5000,
  validity_days: 28,
};

const run = (entities) => validateEntities(entities, vocab);

test('a complete bundle passes with no warnings', () => {
  const { valid, rejected, warnings } = run([goodBundle]);
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(warnings.length, 0);
});

test('entity_id must be prefixed with its type (D16)', () => {
  const { rejected } = run([{ ...goodBundle, entity_id: 'combo_9001' }]);
  assert.ok(rejected[0].errors.some((e) => e.includes('must start with "bundle_"')));
});

test('bundle numerics: subtype required, price must be a positive integer', () => {
  const { rejected } = run([
    { ...goodBundle, subtype: undefined },
    { ...goodBundle, entity_id: 'bundle_9002', price_iqd: 0 },
    { ...goodBundle, entity_id: 'bundle_9003', price_iqd: '5000' },
  ]);
  assert.equal(rejected.length, 3);
  assert.ok(rejected[0].errors.some((e) => e.includes('requires a subtype')));
  assert.ok(rejected[1].errors.some((e) => e.includes('price_iqd')));
  assert.ok(rejected[2].errors.some((e) => e.includes('price_iqd')));
});

test('dates must be YYYY-MM-DD and ordered', () => {
  const { rejected } = run([
    { ...goodBundle, valid_from: '2026-1-1' },
    { ...goodBundle, entity_id: 'bundle_9002', valid_from: '2026-02-01', valid_to: '2026-01-01' },
  ]);
  assert.ok(rejected[0].errors.some((e) => e.includes('valid_from must be YYYY-MM-DD')));
  assert.ok(rejected[1].errors.some((e) => e.includes('valid_from > valid_to')));
});

test('vocab enums are enforced for locations and service classes', () => {
  const { rejected } = run([
    { ...goodBundle, eligible_locations: ['baghdad', 'atlantis'] },
    { ...goodBundle, entity_id: 'bundle_9002', eligible_service_classes: ['vip'] },
  ]);
  assert.ok(rejected[0].errors.some((e) => e.includes('location "atlantis"')));
  assert.ok(rejected[1].errors.some((e) => e.includes('service_class "vip"')));
});

test('intents need a known target_flow and at least one example', () => {
  const base = {
    entity_id: 'intent_test',
    type: 'intent',
    status: 'verified',
    source: 'manual',
    version: 1,
    updated_at: '2026-07-01T00:00:00Z',
    names: { en: 'Test intent' },
  };
  const { valid, rejected } = run([
    { ...base, target_flow: 'loan_flow', examples: { en: ['lend me credit'] } },
    { ...base, entity_id: 'intent_bad_flow', target_flow: 'nope_flow', examples: { en: ['x'] } },
    { ...base, entity_id: 'intent_no_examples', target_flow: 'loan_flow', examples: {} },
  ]);
  assert.equal(valid.length, 1);
  assert.ok(rejected[0].errors.some((e) => e.includes('target_flow "nope_flow"')));
  assert.ok(rejected[1].errors.some((e) => e.includes('at least one example')));
});

test('referential integrity: conflicts_with must point at an ingested entity', () => {
  const { valid, rejected } = run([
    { ...goodBundle, conflicts_with: ['bundle_9002'] },
    { ...goodBundle, entity_id: 'bundle_9002' },
  ]);
  assert.equal(valid.length, 2); // both present → reference resolves
  const missing = run([{ ...goodBundle, conflicts_with: ['bundle_ghost'] }]);
  assert.ok(missing.rejected[0].errors.some((e) => e.includes('bundle_ghost')));
  void rejected;
});

test('duplicate entity_id rejects the second occurrence', () => {
  const { valid, rejected } = run([goodBundle, { ...goodBundle }]);
  assert.equal(valid.length, 1);
  assert.ok(rejected[0].errors.some((e) => e.includes('duplicate entity_id')));
});

test('missing required languages warn but do not block', () => {
  const { valid, rejected, warnings } = run([
    { ...goodBundle, names: { en: 'Test' }, description: { en: 'Test bundle.' } },
  ]);
  assert.equal(valid.length, 1);
  assert.equal(rejected.length, 0);
  assert.ok(warnings[0].warnings.some((w) => w.includes('names missing required languages: ar')));
  assert.ok(warnings[0].warnings.some((w) => w.includes('description missing required languages: ar')));
});
