#!/usr/bin/env node
// Stage 1 of the routing-content pipeline (content-kit/utterances-instructions.md):
//   raw Laila log export  →  content-kit/utterances-<date>.csv  →  [HUMAN LABELS intent_id]
//   →  scripts/utterances-to-seed.mjs  →  data/seed/intents/*.json + eval/gold/gold.jsonl
//
// The export format is not known in advance (portal CSV, JSONL, a JSON array, a BI dump), so
// this sniffs the shape and the column names rather than demanding one schema. Anything it
// cannot work out, you pass explicitly with a flag.
//
// It deliberately does NOT guess intent_id. Labelling is the one step that must be human:
// the kit is explicit that copying the OLD dispatcher's routing decisions would teach the new
// router the old bugs (that is the "loan → BTL" misroute). intent_id/target_flow come out
// blank for a person to fill in.
//
// Usage:
//   node scripts/logs-to-utterances.mjs <export-file> [options]
//
//   --out <path>           output CSV (default content-kit/utterances-<today>.csv)
//   --text-col <name>      column/field holding the message text
//   --session-col <name>   column/field holding the conversation/session id
//   --role-col <name>      column that says who spoke
//   --customer-role <v>    value of role-col meaning "the customer" (default: sniffed)
//   --all-turns            keep every customer turn (default: FIRST turn per session only,
//                          which the kit says is the cleanest intent expression)
//   --min-chars <n>        drop messages shorter than this (default 2)
//   --max-chars <n>        drop messages longer than this (default 300 — long pastes are
//                          rarely intent expressions)
//   --keep-duplicates      keep repeated identical utterances (default: dedupe, keeping count)
//   --limit <n>            stop after n rows
//   --inspect              print the detected shape and a preview, write nothing

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/lib/config.js';
import { detectLanguage } from '../src/service/understand.js';
import { toCsv } from '../src/lib/csv.js';
import {
  loadRecords, pickColumn, isCustomerTurn, redact,
  TEXT_KEYS, SESSION_KEYS, ROLE_KEYS, TIME_KEYS,
} from '../src/lib/logmine.js';

// ── argument parsing ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);
const input = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);

if (!input) {
  console.error('usage: node scripts/logs-to-utterances.mjs <export-file> [--inspect] [--text-col ...]');
  console.error('       see the header of this file for every option');
  process.exit(1);
}

const MIN_CHARS = Number(flag('min-chars', 2));
const MAX_CHARS = Number(flag('max-chars', 300));
const LIMIT = flag('limit') ? Number(flag('limit')) : Infinity;

// ── main ─────────────────────────────────────────────────────────────────────
const raw = readFileSync(input, 'utf8');
const { records, format } = loadRecords(raw, input);
if (!records.length) {
  console.error(`No records found in ${input} (detected format: ${format}).`);
  process.exit(1);
}

const textCol = pickColumn(records, TEXT_KEYS, flag('text-col'));
const sessionCol = pickColumn(records, SESSION_KEYS, flag('session-col'));
const roleCol = pickColumn(records, ROLE_KEYS, flag('role-col'));
const timeCol = pickColumn(records, TIME_KEYS, null);
const customerRole = flag('customer-role');

if (!textCol) {
  console.error(`Could not find the message-text column in ${input}.`);
  console.error(`Detected format: ${format}. Available fields:`);
  console.error('  ' + [...new Set(records.flatMap((r) => Object.keys(r ?? {})))].join(', '));
  console.error('Re-run with --text-col <name>.');
  process.exit(1);
}

if (has('inspect')) {
  console.log(`format:      ${format}`);
  console.log(`records:     ${records.length}`);
  console.log(`text-col:    ${textCol}`);
  console.log(`session-col: ${sessionCol ?? '(none — every row treated as its own session)'}`);
  console.log(`role-col:    ${roleCol ?? '(none — every row treated as customer text)'}`);
  console.log(`time-col:    ${timeCol ?? '(none)'}`);
  if (roleCol) {
    const vals = [...new Set(records.map((r) => String(r[roleCol] ?? '')))].slice(0, 12);
    console.log(`role values: ${vals.join(' | ')}`);
    console.log(`  → treated as customer: ${vals.filter((v) => isCustomerTurn(v, customerRole)).join(' | ') || '(none)'}`);
  }
  console.log('\nfirst 5 candidate utterances:');
  let shown = 0;
  for (const r of records) {
    if (shown >= 5) break;
    const t = String(r[textCol] ?? '').trim();
    if (!t || (roleCol && !isCustomerTurn(r[roleCol], customerRole))) continue;
    console.log(`  [${detectLanguage(t)}] ${redact(t).slice(0, 100)}`);
    shown++;
  }
  process.exit(0);
}

// Order by time where we can, so "first turn per session" means the actual first turn.
const ordered = timeCol
  ? [...records].sort((a, b) => String(a[timeCol] ?? '').localeCompare(String(b[timeCol] ?? '')))
  : records;

const seenSession = new Set();
const byUtterance = new Map(); // deduped text → {text, count}
const rows = [];
let skippedBot = 0;
let skippedLength = 0;

for (const r of ordered) {
  if (rows.length >= LIMIT) break;
  const text = String(r?.[textCol] ?? '').replace(/\s+/g, ' ').trim();
  if (!text) continue;
  if (roleCol && !isCustomerTurn(r[roleCol], customerRole)) { skippedBot++; continue; }
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) { skippedLength++; continue; }

  if (!has('all-turns') && sessionCol) {
    const sid = String(r[sessionCol] ?? '');
    if (sid && seenSession.has(sid)) continue;
    if (sid) seenSession.add(sid);
  }

  const clean = redact(text);
  const key = clean.toLowerCase();
  if (!has('keep-duplicates')) {
    const prev = byUtterance.get(key);
    if (prev) { prev.count++; continue; }
    byUtterance.set(key, { count: 1, index: rows.length });
  }

  const language = detectLanguage(clean);
  const script = /[؀-ۿ]/.test(clean) ? 'arab' : 'latin';
  rows.push({
    utterance: clean,
    language,
    script,
    intent_id: '',      // ← HUMAN fills these two in. Never guessed: see the header note.
    target_flow: '',
    source: 'laila_logs',
    notes: '',
  });
}

// Fold duplicate counts into notes so the labeller can see what is common.
if (!has('keep-duplicates')) {
  for (const { count, index } of byUtterance.values()) {
    if (count > 1) rows[index].notes = `seen ${count}x`;
  }
}

const HEADER = ['utterance', 'language', 'script', 'intent_id', 'target_flow', 'source', 'notes'];
const today = new Date().toISOString().slice(0, 10);
const outPath = flag('out') ?? path.join(ROOT_DIR, 'content-kit', `utterances-${today}.csv`);
writeFileSync(outPath, toCsv(HEADER, rows), 'utf8');

const byLang = rows.reduce((acc, r) => ({ ...acc, [r.language]: (acc[r.language] ?? 0) + 1 }), {});
console.log(`Read ${records.length} records (${format}) from ${path.basename(input)}`);
console.log(`  text=${textCol}  session=${sessionCol ?? '-'}  role=${roleCol ?? '-'}  time=${timeCol ?? '-'}`);
if (skippedBot) console.log(`  skipped ${skippedBot} non-customer turns`);
if (skippedLength) console.log(`  skipped ${skippedLength} messages outside ${MIN_CHARS}-${MAX_CHARS} chars`);
console.log(`\nWrote ${rows.length} utterances → ${path.relative(ROOT_DIR, outPath)}`);
console.log(`  by language: ${Object.entries(byLang).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log(`\nNEXT: open that CSV and fill in intent_id (and target_flow where you know it).`);
console.log(`      Label the TRUE intent, not what the old dispatcher did — see`);
console.log(`      content-kit/utterances-instructions.md. Then:`);
console.log(`      node scripts/utterances-to-seed.mjs ${path.relative(ROOT_DIR, outPath)} --dry-run`);
