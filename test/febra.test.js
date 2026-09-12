// Pins the FEBRA import (src/lib/febra.js). Every case here is a shape that actually
// occurs in the export — the fixtures are trimmed from the real files — because the whole
// value of this importer is that it refuses to guess, and a parser that quietly guesses
// again would be invisible in the entity count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriceIqd, parseValidityDays, parseDataMb, parsePromptBlocks, rowToEntity, febraToEntities,
} from '../src/lib/febra.js';

const NOW = '2026-09-12T00:00:00Z';

test('price: reads the export’s formats, rejects what it cannot read', () => {
  assert.equal(parsePriceIqd('1,250 IQD'), 1250);
  assert.equal(parsePriceIqd('Price:12,000 IQD'), 12000); // no space after the colon, real row
  assert.equal(parsePriceIqd('70,000 IQD'), 70000);
  assert.equal(parsePriceIqd('السعر: 5,000 دينار'), 5000);
  assert.equal(parsePriceIqd(''), null);
  assert.equal(parsePriceIqd('free'), null);
});

test('validity: days, weeks and whole-day hours only', () => {
  assert.equal(parseValidityDays('Valid For 24h, Does not Auto-renew'), 1);
  assert.equal(parseValidityDays('Valid For 7 Days, Automatically renewed'), 7);
  assert.equal(parseValidityDays('4 Weeks'), 28);
  assert.equal(parseValidityDays('12 Weeks'), 84);
  assert.equal(parseValidityDays('20 days'), 20);
  assert.equal(parseValidityDays('الصلاحية: 7 أيام'), 7);
  // A part-day is not roundable in either direction, so it is not a number we have.
  assert.equal(parseValidityDays('Valid For 36h'), null);
  // The row whose validity cell was mis-escaped by the export.
  assert.equal(parseValidityDays('), Show Bundle Pocket Roaming, Stop Premium SMS, Purchase Validity'), null);
});

test('data: GB→MB, and null rather than a guess', () => {
  assert.equal(parseDataMb('Daily Free Social 300 MB'), 300);
  assert.equal(parseDataMb('2.5 GB'), 2560);
  assert.equal(parseDataMb('GB 1 إنترنت'), 1024); // the RTL files put the unit first
  // Two different sizes in one row: picking either would be a guess.
  assert.equal(parseDataMb('Every 4 weeks: 5 GB, total 15 GB'), null);
  // Same size twice is not ambiguous.
  assert.equal(parseDataMb('3 GB data · 3GB included'), 3072);
});

test('data: an unlimited bundle’s GB figure is the FUP threshold, not an allowance', () => {
  const real = 'Unlimited Internet for 24 hours | Price: 3,000 IQD | FUP applied after using (3GB)';
  assert.equal(parseDataMb(real), null,
    'storing 3 GB here would answer "how much data do I get?" with a cap the customer does not have');
});

test('prompt blocks: a blank line between the name and its bullets keeps the name', () => {
  // The Yooz file's layout. Treating the blank line as the block boundary silently cost
  // every Yooz bundle its Arabic name — the entities imported as English-only.
  const blocks = parsePromptBlocks([
    'البيانات أكثر – يووز 5,000',
    '',
    '- 20 دقيقة',
    '- الصلاحية: 7 أيام',
    '- BundleID : 2628',
  ].join('\n'));
  assert.equal(blocks.get(2628).name, 'البيانات أكثر – يووز 5,000');
  assert.deepEqual(blocks.get(2628).bullets, ['20 دقيقة', 'الصلاحية: 7 أيام']);
});

test('prompt blocks: both id separators, and the RTL trailing list marker', () => {
  const blocks = parsePromptBlocks([
    'فري سوشيال اليومية (300 ميجابايت) .1', // marker after the name, as the RTL files write it
    '- 300 ميجابايت',
    '-BundleID: 1025',                      // ATL spelling: no space before the colon
    '2. Weekly Free Social',                 // marker before the name
    '- 3 GB',
    '- BundleID : 1026',                     // Yooz spelling: spaces both sides
  ].join('\n'));
  assert.equal(blocks.get(1025).name, 'فري سوشيال اليومية (300 ميجابايت)');
  assert.equal(blocks.get(1026).name, 'Weekly Free Social');
});

test('prompt blocks: a block with no name of its own does not steal the previous one’s', () => {
  const blocks = parsePromptBlocks([
    'Real Name',
    '- 1 GB',
    '- BundleID : 111',
    '- BundleID : 222',
  ].join('\n'));
  assert.equal(blocks.get(111).name, 'Real Name');
  // Carrying nothing, it may be absent altogether — what it must never do is inherit 111's
  // name, which would attach one bundle's copy to another bundle's id.
  assert.notEqual(blocks.get(222)?.name, 'Real Name');
});

const row = (over = {}) => ({
  bundleId: '1026', name: 'Weekly Free Social 3 GB', price: '5,000 IQD',
  validity: 'Valid For 7 Days, Automatically renewed',
  description: 'Free usage for Viber, WhatsApp and Facebook', ...over,
});

test('a clean row becomes a draft entity with the export’s own numbers', () => {
  const { entity, skip } = rowToEntity(row(), { family: 'ATL', now: NOW });
  assert.equal(skip, null);
  assert.equal(entity.entity_id, 'bundle_1026');
  assert.equal(entity.bundleId, 1026);
  assert.equal(entity.price_iqd, 5000);
  assert.equal(entity.validity_days, 7);
  assert.equal(entity.data_mb, 3072);
  assert.equal(entity.status, 'draft', 'nothing imported may claim to be verified');
});

test('no how_to is ever invented — the export carries no subscription steps', () => {
  const { entity } = rowToEntity(row(), { family: 'ATL', now: NOW });
  assert.equal(entity.how_to, undefined,
    'an invented *123# shortcode is exactly what the placeholder seed got wrong');
});

test('a row without a bundleId is not imported — identity is the id, never the name', () => {
  const { entity, skip } = rowToEntity(row({ bundleId: '', name: 'RED 5' }), { family: 'Line', now: NOW });
  assert.equal(entity, null);
  assert.match(skip, /no bundleId/);
});

test('a row whose validity cannot be read anywhere is not imported', () => {
  const { skip } = rowToEntity(row({
    validity: '), Show Bundle Pocket Roaming, Stop Premium SMS, Purchase Validity',
    description: 'Free usage for Viber and WhatsApp',
  }), { family: 'ATL', now: NOW });
  assert.match(skip, /validity unreadable/);
});

test('validity falls back to the description, which is reading the data, not inferring it', () => {
  const { entity, notes } = rowToEntity(row({
    validity: '',
    description: 'Unlimited Internet for 7 days | Price:12,000 IQD | FUP applied after using (20GB)',
  }), { family: 'ATL', now: NOW });
  assert.equal(entity.validity_days, 7);
  assert.ok(notes.some((n) => /read from the description/.test(n)), 'the fallback must be visible to a reviewer');
});

test('a bot instruction listing several packages is not a product row', () => {
  const { entity, skip } = rowToEntity(row({
    bundleId: '2601',
    name: '**Specific Roaming Packages for Turkey,Iran UAE, KSA, Qatar and Maldives:',
    description: 'If a user asks about these countries, provide specific packages as outlined: | Maldives 30GB Package: | 30GB data | Price: 70,000 IQD',
  }), { family: 'ATL', now: NOW });
  assert.equal(entity, null);
  assert.match(skip, /not a product row/);
});

test('markdown in a real product name is cleaned, not treated as a heading', () => {
  const { entity } = rowToEntity(row({
    bundleId: '1711', name: 'Roaming Passport Bundle 2 GB**:', validity: '7 days',
    description: '2GB data | Valid for 7 days | Price: 10,000 IQD',
  }), { family: 'ATL', now: NOW });
  assert.equal(entity.names.en, 'Roaming Passport Bundle 2 GB');
});

test('an unfilled template slot never reaches the description', () => {
  const { entity, notes } = rowToEntity(row({
    description: '2GB data | Valid for 7 days | **Operators**: [Operator(s) based on selected country]',
  }), { family: 'ATL', now: NOW });
  assert.ok(!entity.description.en.includes('['), 'a customer must not be shown a placeholder');
  assert.ok(notes.some((n) => /template slot/.test(n)));
});

test('translations supply the name and description, never a machine translation', () => {
  const { entity, notes } = rowToEntity(row(), {
    family: 'ATL',
    now: NOW,
    translations: { ar: { name: 'فري سوشيال الاسبوعية (3 جيجابايت)', bullets: ['3 جيجابايت', 'السعر: 5,000 دينار'] } },
  });
  assert.equal(entity.names.ar, 'فري سوشيال الاسبوعية (3 جيجابايت)');
  assert.equal(entity.description.ar, '3 جيجابايت · السعر: 5,000 دينار');
  assert.deepEqual(entity.languages_present, ['en', 'ar']);
  assert.ok(notes.some((n) => /no ckb\/kmr name/.test(n)));
});

test('one id claimed by two rows imports neither', () => {
  // The Iran and UAE roaming rows both claim 1013. Importing either would answer a question
  // about one country with the other country's facts.
  const rows = [
    row({ bundleId: '1013', name: 'Iran Roaming Daily', validity: '1 day' }),
    row({ bundleId: '1013', name: 'UAE Roaming Daily', validity: '1 day' }),
  ];
  const { entities, skipped } = febraToEntities([{ family: 'ATL', rows }], { now: NOW });
  assert.equal(entities.length, 0);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.every((s) => /identity collision/.test(s.reason)));
});

test('two ids with one name and identical facts import, but are flagged', () => {
  const rows = [
    row({ bundleId: '2180', name: 'MAX Card 25 for 4 Weeks', validity: '4 Weeks' }),
    row({ bundleId: '1712', name: 'MAX Card 25 for 4 Weeks', validity: '4 Weeks' }),
  ];
  const { entities, notes } = febraToEntities([{ family: 'ATL', rows }], { now: NOW });
  assert.equal(entities.length, 2, 'a live and a retired SKU is legitimate — this is not a collision');
  const flagged = notes.filter((n) => n.notes.some((x) => /same name and facts/.test(x)));
  assert.equal(flagged.length, 2);
  // The note must name the OTHER id, not itself.
  const forA = entities.find((e) => e.bundleId === 2180);
  assert.match(forA.attributes.review_note, /same name and facts as bundleId 1712/);
});

test('the Yooz family carries its service-class eligibility', () => {
  const { entities } = febraToEntities(
    [{ family: 'Yooz', rows: [row({ bundleId: '2628', name: 'Yooz 5 Mix' })], serviceClasses: ['yooz'] }],
    { now: NOW },
  );
  assert.deepEqual(entities[0].eligible_service_classes, ['yooz']);
});
