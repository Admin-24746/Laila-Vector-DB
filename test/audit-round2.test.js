// Regression pins for the SECOND audit pass (2026-08-22, README items 1–9).
// Same bar as test/audit-fixes.test.js: every test here fails without its fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { coerceNum, CONFIG, ROOT_DIR } from '../src/lib/config.js';
import { buildFilter, businessDay, orderSections } from '../src/service/retrieve.js';
import { anchorRatio } from '../src/service/understand.js';
import { validateEntities } from '../src/lib/validate.js';
import { entityToChunks } from '../src/lib/chunker.js';
import { contentHash, isIngestableSeedFile } from '../src/ingest/run.js';
import { scoreRouting } from '../src/eval/run.js';

// ── item 1 — numeric env coercion ────────────────────────────────────────────
// `Number('')` is 0 and `??` only catches null/undefined, so a present-but-empty line in
// .env silently zeroed the value: ROUTE_TAU_HIGH=0 makes decide() confidently route a
// garbage query, TOP_K=0 returns nothing, EMBED_TIMEOUT_MS=0 503s every query.
test('empty and junk numeric env values fall back to the default, not 0', async (t) => {
  await t.test('the old expression really did produce 0', () => {
    assert.equal(Number(process.env.__ABSENT__ ?? 0.8), 0.8, 'absent is fine either way');
    assert.equal(Number('' ?? 0.8), 0, 'THIS is the bug: ?? does not catch the empty string');
  });

  for (const raw of ['', ' ', '\t', 'abc', 'NaN', undefined, null]) {
    assert.equal(coerceNum(raw, 0.8, 'ROUTE_TAU_HIGH'), 0.8, `${JSON.stringify(raw)} → default`);
  }
  // Real values, including a legitimate zero, still come through.
  assert.equal(coerceNum('0', 5, 'TOP_K'), 0);
  assert.equal(coerceNum('0.65', 0.8), 0.65);
  assert.equal(coerceNum('30000', 10_000), 30_000);
  assert.equal(coerceNum(' 7 ', 5), 7, 'surrounding whitespace is not junk');
});

// The integrated path: a key absent from .env, blanked in the environment, must not zero
// the config. EMBED_TIMEOUT_MS is not set in .env, so the process env is the only source.
test('a blank EMBED_TIMEOUT_MS in the environment does not zero the timeout', () => {
  const out = execFileSync(process.execPath, [
    // `console.log` of a number can arrive ANSI-colored; write the raw string instead.
    '-e', "import('./src/lib/config.js').then(m => process.stdout.write(String(m.CONFIG.embedTimeoutMs)))",
  ], { cwd: ROOT_DIR, env: { ...process.env, EMBED_TIMEOUT_MS: '' }, encoding: 'utf8' });
  assert.equal(Number(out.trim()), 10_000, 'blank must fall back to the 10s default, not 0');
});

// ── item 2 — a confidently-routed "should have clarified" item IS a false route ──
// The __clarify__ branch `continue`d before `falseRoutes++`, so the exact failure the
// ≤0.05 gate exists to catch was excluded from the headline number.
test('scoreRouting counts a confidently-routed clarify item as a false route', () => {
  const THRESHOLDS = { tauHigh: 0.8, tauLow: 0.6, margin: 0.05 };
  const match = (flow, score) => ({ chunk_id: `intent_${flow}:en:example_1`, score, payload: { target_flow: flow } });

  const raw = [
    // Ambiguous garbage that SHOULD be clarified, but scores high and unrivalled → routed.
    { item: { query: 'اشتراك', expected_flow: '__clarify__' }, matches: [match('subscribe_flow', 0.93)] },
    // A correctly abstained clarify item — must not be counted.
    { item: { query: 'هاي', expected_flow: '__clarify__' }, matches: [match('subscribe_flow', 0.42)] },
    // A plain correct route.
    { item: { query: 'how do I subscribe', expected_flow: 'subscribe_flow' }, matches: [match('subscribe_flow', 0.91)] },
  ];

  const s = scoreRouting(raw, THRESHOLDS);
  assert.equal(s.n, 3);
  assert.equal(s.falseRouteRate, 1 / 3, 'the routed clarify item must appear in the false-route rate');
  assert.equal(s.accuracy, 2 / 3);
  assert.equal(s.abstainCorrect, 0.5);
  assert.equal(s.failures.length, 1, 'it is still reported as a failure');
  assert.equal(s.failures[0].expected, '__clarify__');
});

// ── item 4 — the change hash must cover what the CHUNKER bakes in ────────────
// Chunk text quotes the NAMES of related entities, so renaming bundle_b left bundle_a's
// conflict chunk quoting the old name forever: bundle_a's own fields were byte-identical,
// so it was judged "unchanged" and never re-embedded.
test('renaming a related entity changes the referring entity\'s content hash', () => {
  const a = { entity_id: 'bundle_a', type: 'bundle', names: { en: 'Alpha' }, conflicts_with: ['bundle_b'] };
  const bOld = { entity_id: 'bundle_b', type: 'bundle', names: { en: 'Beta' } };
  const bNew = { entity_id: 'bundle_b', type: 'bundle', names: { en: 'Beta Plus' } };
  const vocab = {};

  const hash = (b) => contentHash(a, { byId: new Map([[a.entity_id, a], [b.entity_id, b]]), vocab });
  assert.notEqual(hash(bOld), hash(bNew), 'bundle_a must re-embed when bundle_b is renamed');
  assert.equal(hash(bOld), hash({ ...bOld }), 'and stay stable when nothing changed (still idempotent)');

  // The chunk text is what actually differs — this is the damage the hash now tracks.
  const chunkFor = (b) => entityToChunks(a, {
    vocab,
    nameOf: (id, lang) => (id === b.entity_id ? b.names[lang] : id),
  }).find((c) => c.section === 'conflicts')?.text ?? '';
  assert.match(chunkFor(bOld), /Beta/);
  assert.match(chunkFor(bNew), /Beta Plus/);

  // A referenced vocab label is baked in the same way.
  const withLoc = { ...a, eligible_locations: ['baghdad'] };
  const locHash = (label) => contentHash(withLoc, {
    byId: new Map([[withLoc.entity_id, withLoc], ['bundle_b', bOld]]),
    vocab: { locations: { baghdad: { labels: { en: label } } } },
  });
  assert.notEqual(locHash('Baghdad'), locHash('Baghdad Governorate'));
});

// ── item 6 — an unrecognised section must not lead the entity card ───────────
test('orderSections sorts unknown sections last, not first', () => {
  const payloads = [
    { section: 'conflicts' }, { section: 'zzz_future_section' }, { section: 'overview' },
    { section: 'aaa_unknown' }, { section: 'subscribe' },
  ];
  const order = orderSections(payloads).map((p) => p.section);

  assert.equal(order[0], 'overview', 'the overview leads the card handed to the LLM');
  assert.deepEqual(order, ['overview', 'subscribe', 'conflicts', 'aaa_unknown', 'zzz_future_section']);
  // The precondition: indexOf(-1) is what used to float them to the front.
  assert.equal(['overview', 'subscribe'].indexOf('aaa_unknown'), -1);
  // Deterministic run to run, whatever order Qdrant returns the points in.
  assert.deepEqual(orderSections([...payloads].reverse()).map((p) => p.section), order);
});

// ── item 7 — the `_` not-for-ingest convention applies to DIRECTORIES too ────
test('a _-prefixed directory is skipped, not ingested', () => {
  assert.equal(isIngestableSeedFile('bundle_super_net.json'), true);
  assert.equal(isIngestableSeedFile('bundles/bundle_super_net.json'), true);
  assert.equal(isIngestableSeedFile('_TEMPLATE.json'), false, 'the original case still holds');

  for (const rel of ['_drafts/bundle_x.json', '_drafts\\bundle_x.json', 'wip/_drafts/bundle_x.json']) {
    assert.equal(isIngestableSeedFile(rel), false, `${rel} must not be ingested`);
    // The precondition: basename-only testing let all of these through.
    assert.equal(rel.split(/[\\/]/).pop().startsWith('_'), false);
  }
  assert.equal(isIngestableSeedFile('notes.md'), false);
});

// ── item 3 — langmap VALUES must be strings ──────────────────────────────────
// isLangMap only checked the container, so {"en": {...}} validated and embedded as the
// literal string "[object Object]", which was then served to the LLM as evidence.
test('a langmap whose value is not a string is rejected, not embedded', () => {
  const vocab = {
    entity_types: { terminology: { subtypes: [] } },
    languages: { required: ['en'] },
  };
  const base = {
    entity_id: 'terminology_x', type: 'terminology', status: 'draft', source: 'manual',
    version: 1, updated_at: '2026-08-22T00:00:00Z',
    names: { en: 'X' }, description: { en: 'a thing' },
  };
  const ok = validateEntities([base], vocab);
  assert.equal(ok.rejected.length, 0, `precondition: the clean entity validates (${JSON.stringify(ok.rejected)})`);

  for (const bad of [{ nested: 'object' }, 42, null, ['an', 'array'], '']) {
    const { rejected } = validateEntities([{ ...base, names: { en: bad } }], vocab);
    assert.equal(rejected.length, 1, `names.en = ${JSON.stringify(bad)} must be rejected`);
    assert.match(rejected[0].errors.join(' '), /names\.en/);
  }

  const { rejected } = validateEntities([{ ...base, description: { en: { text: 'x' } } }], vocab);
  assert.match(rejected[0]?.errors.join(' ') ?? '', /description\.en/);

  // The exact damage the type check prevents.
  assert.equal(String({ text: 'x' }), '[object Object]');
});

// ── item 5 — the anchoring guard must match TOKENS, not substrings ───────────
// `hay.includes(t)` scored a hallucinated word-salad rewrite at a perfect 1.00 because
// each fragment happened to appear *inside* some conversation word.
test('anchorRatio rejects a rewrite built from fragments of real words', () => {
  const corpus = 'How do I subscribe to the combo bundle? You can subscribe to the combo bundle by dialling 1602.';

  assert.ok(anchorRatio('sub scribe to bun', corpus) < 0.6,
    'fragment salad must not anchor — it scored 1.00 under substring matching');
  assert.ok(anchorRatio('How do I subscribe to the combo bundle', corpus) >= 0.6,
    'a genuine rewrite still anchors');
});

// Precision guard, not a regression pin: this is the one test in this file that passed
// BEFORE the fix too. It is here to prove the tokenisation did not over-tighten and start
// rejecting the legitimate rewrites the substring match was covering for.
test('anchorRatio still tolerates attached Arabic clitics', () => {
  // The docs/12 worked example: "بباقة" (bi- + باقة) must anchor to "باقة".
  const corpus = 'شنو باقة سوبر نت؟\nباقة سوبر نت تنطيك 10 غيغابايت شهرياً.\nوشلون اشترك بيها؟';
  assert.ok(anchorRatio('وشلون اشترك بباقة سوبر نت؟', corpus) >= 0.6,
    'clitic-attached forms must still anchor (that is why folding + affix tolerance exist)');
  assert.ok(anchorRatio('شكد سعر الروminغ بالخارج وشنو شروط الفيزا', corpus) < 0.6,
    'an unrelated question must not anchor');
});

// ── item 8 — repeat_purchase_threshold renders as an ordinal ─────────────────
test('repeat_purchase_threshold below 1 is rejected and never chunked', () => {
  const vocab = {
    entity_types: { bundle: { subtypes: ['atl'] } },
    languages: { required: ['en'] },
  };
  const bundle = {
    entity_id: 'bundle_x', type: 'bundle', subtype: 'atl', status: 'draft', source: 'manual',
    version: 1, updated_at: '2026-08-22T00:00:00Z',
    names: { en: 'X' }, description: { en: 'a bundle' },
    bundleId: 1, price_iqd: 5000, validity_days: 30,
    repeat_purchase_fee_iqd: 250, repeat_purchase_threshold: 0,
  };
  const { rejected } = validateEntities([bundle], vocab);
  assert.equal(rejected.length, 1, 'threshold 0 has no ordinal meaning — reject it');
  assert.match(rejected[0].errors.join(' '), /repeat_purchase_threshold/);

  const chunks = entityToChunks(bundle, { vocab });
  assert.equal(chunks.filter((c) => c.section === 'fees_edgecases').length, 0,
    'and no "from the 0th subscription" chunk is produced even if one slips through');

  const valid = entityToChunks({ ...bundle, repeat_purchase_threshold: 2 }, { vocab });
  assert.ok(valid.some((c) => c.section === 'fees_edgecases'), 'a real threshold still chunks');
});

// ── item 9 — date validity is a calendar DAY in the business timezone ────────
// Comparing date-only payloads against `new Date().toISOString()` expired a promo at UTC
// midnight = 03:00 Baghdad, not local midnight.
test('the date pre-filter uses the Baghdad calendar day, not the UTC instant', () => {
  assert.equal(CONFIG.timezone, 'Asia/Baghdad');

  // 2026-09-10 21:30 UTC is already 2026-09-11 00:30 in Baghdad.
  assert.equal(businessDay(new Date('2026-09-10T21:30:00Z')), '2026-09-11T00:00:00Z');
  // 2026-09-10 02:00 UTC is still 2026-09-10 05:00 in Baghdad — same day.
  assert.equal(businessDay(new Date('2026-09-10T02:00:00Z')), '2026-09-10T00:00:00Z');
  // The bug window: 00:30 UTC on the 10th is 03:30 Baghdad on the 10th. The old code sent
  // "…T00:30:00Z", which is already > the payload's "2026-09-10" (midnight UTC), so a promo
  // valid THROUGH the 10th stopped matching. The day boundary keeps it alive.
  const at = new Date('2026-09-10T00:30:00Z');
  assert.ok(at.toISOString() > '2026-09-10T00:00:00Z', 'precondition: the instant is past the payload date');
  assert.equal(businessDay(at), '2026-09-10T00:00:00Z');

  const clause = buildFilter({ types: ['bundle'] }).must
    .find((m) => m.should?.some((s) => s.key === 'valid_to'));
  const bound = clause.should.find((s) => s.key === 'valid_to').range.gte;
  assert.match(bound, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/, 'the filter compares against a day boundary');
});
