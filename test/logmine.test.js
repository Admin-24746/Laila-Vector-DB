// Unit tests for the log-mining pipeline (content-kit/utterances-instructions.md):
// CSV parsing, export-format sniffing, column detection, who-spoke detection, PII redaction,
// and the train/gold hold-out split. These back scripts/logs-to-utterances.mjs and
// scripts/utterances-to-seed.mjs, which are thin CLIs over src/lib/logmine.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvRecords, csvCell, toCsv } from '../src/lib/csv.js';
import {
  loadRecords, pickColumn, isCustomerTurn, redact, isHeldOut,
  TEXT_KEYS, SESSION_KEYS, ROLE_KEYS,
} from '../src/lib/logmine.js';

// ── CSV ──────────────────────────────────────────────────────────────────────
test('CSV: quoted fields, embedded commas and newlines, escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n"x,y",2'), [['a', 'b'], ['x,y', '2']]);
  assert.deepEqual(parseCsv('a\n"line1\nline2"'), [['a'], ['line1\nline2']]);
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('CSV: an Excel BOM never becomes part of the first column name', () => {
  // Excel writes a UTF-8 BOM. Without stripping it the first header reads "﻿utterance"
  // and every lookup by name silently misses.
  const { header, records } = parseCsvRecords('﻿utterance,language\nhello,en');
  assert.deepEqual(header, ['utterance', 'language']);
  assert.equal(records[0].utterance, 'hello');
});

test('CSV: empty cells survive, blank trailing lines do not', () => {
  const { records } = parseCsvRecords('a,b,c\n1,,3\n\n');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], { a: '1', b: '', c: '3' });
});

test('CSV: round-trips values that need quoting', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('has,comma'), '"has,comma"');
  assert.equal(csvCell('has"quote'), '"has""quote"');
  assert.equal(csvCell(null), '');

  const rows = [{ utterance: 'I want data, and minutes', notes: 'said "urgent"' }];
  const parsed = parseCsvRecords(toCsv(['utterance', 'notes'], rows));
  assert.deepEqual(parsed.records[0], rows[0], 'write → read must be lossless');
});

// ── format sniffing ──────────────────────────────────────────────────────────
test('loadRecords detects every export shape the exporters actually produce', () => {
  assert.equal(loadRecords('[{"a":1}]').format, 'json-array');
  assert.equal(loadRecords('{"a":1}\n{"a":2}').format, 'jsonl');
  assert.equal(loadRecords('{"a":1}').format, 'json-object');

  // Power Automate / Graph style envelope: the rows are under some array-valued key.
  const wrapped = loadRecords('{"@odata.count":2,"value":[{"a":1},{"a":2}]}');
  assert.equal(wrapped.format, 'json-wrapped(value)');
  assert.equal(wrapped.records.length, 2);

  const csv = loadRecords('x,y\n1,2', 'export.csv');
  assert.equal(csv.format, 'csv');
  assert.deepEqual(csv.records, [{ x: '1', y: '2' }]);

  assert.throws(() => loadRecords('just some prose', 'notes.txt'), /cannot determine the format/);
});

// ── column detection ─────────────────────────────────────────────────────────
test('pickColumn finds the text/session/role columns across naming conventions', () => {
  const snake = [{ conversation_id: 'c1', user_message: 'hi', sender: 'user' }];
  assert.equal(pickColumn(snake, TEXT_KEYS), 'user_message');
  assert.equal(pickColumn(snake, SESSION_KEYS), 'conversation_id');
  assert.equal(pickColumn(snake, ROLE_KEYS), 'sender');

  const pascal = [{ DialogId: 'd1', CustomerMessageText: 'hi', IsSentByBot: false }];
  assert.equal(pickColumn(pascal, TEXT_KEYS), 'CustomerMessageText', 'substring match, case-insensitive');
  assert.equal(pickColumn(pascal, SESSION_KEYS), 'DialogId');
  assert.equal(pickColumn(pascal, ROLE_KEYS), 'IsSentByBot');

  assert.equal(pickColumn([{ nothing: 1 }], TEXT_KEYS), null, 'no guess is better than a wrong guess');
  assert.equal(pickColumn(snake, TEXT_KEYS, 'sender'), 'sender', 'an explicit override always wins');
});

// ── who spoke ────────────────────────────────────────────────────────────────
test('isCustomerTurn understands roles, directions and boolean bot flags', () => {
  for (const v of ['user', 'customer', 'Human', 'inbound', 'client', false, 0]) {
    assert.equal(isCustomerTurn(v), true, `${v} should be a customer turn`);
  }
  for (const v of ['bot', 'assistant', 'Laila', 'system', 'outbound', true, 1]) {
    assert.equal(isCustomerTurn(v), false, `${v} should NOT be a customer turn`);
  }
  // No role column at all → keep everything; the labeller sorts it out.
  assert.equal(isCustomerTurn(null), true);
  assert.equal(isCustomerTurn(''), true);
  // Unknown vocabulary is kept, not silently dropped — a false negative shrinks the corpus
  // invisibly, a stray bot line is obvious to the human.
  assert.equal(isCustomerTurn('participant_42'), true);
  // An explicit --customer-role makes the match exact.
  assert.equal(isCustomerTurn('EndUser', 'enduser'), true);
  assert.equal(isCustomerTurn('bot', 'enduser'), false);
});

// ── PII ──────────────────────────────────────────────────────────────────────
test('redact removes subscriber numbers and emails, keeps shortcodes and prices', () => {
  assert.equal(redact('my number is 07701234567'), 'my number is <msisdn>');
  assert.equal(redact('call +9647701234567 please'), 'call <msisdn> please');
  assert.equal(redact('reach me at a.b@example.com'), 'reach me at <email>');

  // The things that MUST survive: shortcodes, bundle ids, prices — they are the content.
  for (const keep of ['dial *123*1#', 'send NET10 to 1234', 'bundle 1601', 'costs 5,000 IQD', 'باقة كومبو 10000']) {
    assert.equal(redact(keep), keep, `must not redact: ${keep}`);
  }
});

test('redact is applied to Arabic-script text too', () => {
  assert.equal(redact('رقمي 07801234567 دزلي'), 'رقمي <msisdn> دزلي');
});

// ── train / gold split ───────────────────────────────────────────────────────
test('isHeldOut is deterministic and keyed by intent as well as text', () => {
  assert.equal(isHeldOut('I need a loan', 'loan'), isHeldOut('I need a loan', 'loan'));
  // Re-running the importer must never reshuffle the split, or eval numbers stop being
  // comparable between runs. Same input → same side, always.
  const first = [...Array(50)].map((_, i) => isHeldOut(`u${i}`, 'loan'));
  const again = [...Array(50)].map((_, i) => isHeldOut(`u${i}`, 'loan'));
  assert.deepEqual(first, again);
});

test('isHeldOut splits near the requested fraction', () => {
  const n = 4000;
  const rate = (h) => [...Array(n)].filter((_, i) => isHeldOut(`utterance ${i}`, 'loan', h)).length / n;
  assert.ok(Math.abs(rate(0.2) - 0.2) < 0.02, `20% hold-out drifted: ${rate(0.2)}`);
  assert.ok(Math.abs(rate(0.5) - 0.5) < 0.02, `50% hold-out drifted: ${rate(0.5)}`);
  assert.equal(rate(0), 0, 'holdout 0 keeps everything for training');
});

test('a gold item is never also a training example', () => {
  // The reason the split exists: overlap would make `npm run eval` measure memorisation and
  // the 0.85 routing gate meaningless.
  const utterances = [...Array(200)].map((_, i) => `utterance ${i}`);
  const gold = utterances.filter((u) => isHeldOut(u, 'loan'));
  const train = utterances.filter((u) => !isHeldOut(u, 'loan'));
  assert.ok(gold.length > 0 && train.length > 0, 'both sides must be non-empty at this size');
  assert.equal(gold.filter((g) => train.includes(g)).length, 0);
  assert.equal(gold.length + train.length, utterances.length, 'and every row lands somewhere');
});
