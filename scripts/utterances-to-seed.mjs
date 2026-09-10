#!/usr/bin/env node
// Stage 2 of the routing-content pipeline. This is the script
// content-kit/utterances-instructions.md promises ("conversion to the data/seed/intents/*.json
// shape is a trivial script once rows exist") and §"What happens with the file" specifies:
//
//   labelled CSV → 80% into data/seed/intents/intent_*.json `examples`
//                → 20% held out into eval/gold/gold.jsonl
//
// The hold-out matters: if a gold item is also a router training example, the eval measures
// memorisation and the 0.85 gate becomes meaningless. The split is HASH-BASED, not random,
// so re-running never reshuffles which rows are held out — add 200 new utterances and the
// existing ones stay on the side they were on, keeping eval numbers comparable across runs.
//
// Usage:
//   node scripts/utterances-to-seed.mjs <labelled.csv> [--dry-run] [--holdout 0.2] [--merge]
//
//   --dry-run    report what would change, write nothing (do this first)
//   --holdout    fraction held out for gold (default 0.2)
//   --merge      ADD to the examples already in the seed files (default: real utterances
//                REPLACE the invented placeholders, which is the point of the exercise)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/lib/config.js';
import { loadVocab } from '../src/lib/vocab.js';
import { parseCsvRecords } from '../src/lib/csv.js';
import { isHeldOut } from '../src/lib/logmine.js';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);
const input = argv.find((a) => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.match(/^--(holdout)$/));

if (!input) {
  console.error('usage: node scripts/utterances-to-seed.mjs <labelled.csv> [--dry-run] [--merge]');
  process.exit(1);
}

const HOLDOUT = Number(flag('holdout', 0.2));
const SEED_DIR = path.join(ROOT_DIR, 'data', 'seed', 'intents');
const GOLD_FILE = path.join(ROOT_DIR, 'eval', 'gold', 'gold.jsonl');
const LANGS = ['en', 'ar', 'ckb', 'kmr'];

// ── read + validate ──────────────────────────────────────────────────────────
const { header, records: rawRecords } = parseCsvRecords(readFileSync(input, 'utf8'));
if (!rawRecords.length) { console.error(`${input} has no data rows.`); process.exit(1); }
for (const col of ['utterance', 'language', 'intent_id']) {
  if (!header.includes(col)) { console.error(`missing required column "${col}" (found: ${header.join(', ')})`); process.exit(1); }
}
const records = rawRecords.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v).trim()])));

const vocab = loadVocab();
const knownFlows = Object.keys(vocab.flows ?? {}).filter((k) => !k.startsWith('_'));

const problems = [];
const usable = [];
const skipped = { unlabelled: 0, example: 0, badLang: 0, empty: 0 };

for (const [i, r] of records.entries()) {
  const line = i + 2; // 1-based, +1 for the header
  if (!r.utterance) { skipped.empty++; continue; }
  if (r.source === 'EXAMPLE') { skipped.example++; continue; }
  if (!r.intent_id) { skipped.unlabelled++; continue; }
  if (!LANGS.includes(r.language)) {
    problems.push(`line ${line}: language "${r.language}" is not one of ${LANGS.join('/')}`);
    skipped.badLang++; continue;
  }
  if (r.target_flow && !knownFlows.includes(r.target_flow)) {
    problems.push(`line ${line}: target_flow "${r.target_flow}" is not in data/vocab/flows.json (${knownFlows.join(', ')})`);
  }
  usable.push(r);
}

// One intent must resolve to ONE flow. Disagreement is a labelling error, not something to
// silently pick a winner for.
const flowByIntent = new Map();
for (const r of usable) {
  if (!r.target_flow) continue;
  const prev = flowByIntent.get(r.intent_id);
  if (prev && prev !== r.target_flow) {
    problems.push(`intent "${r.intent_id}" is labelled with two flows: "${prev}" and "${r.target_flow}"`);
  }
  flowByIntent.set(r.intent_id, r.target_flow);
}

// ── group ────────────────────────────────────────────────────────────────────
const byIntent = new Map();
for (const r of usable) {
  if (!byIntent.has(r.intent_id)) byIntent.set(r.intent_id, { train: {}, gold: [] });
  const bucket = byIntent.get(r.intent_id);
  if (isHeldOut(r.utterance, r.intent_id, HOLDOUT)) bucket.gold.push(r);
  else (bucket.train[r.language] ??= []).push(r.utterance);
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`${path.basename(input)}: ${records.length} rows → ${usable.length} usable`);
if (skipped.unlabelled) console.log(`  ${skipped.unlabelled} skipped: no intent_id yet (that is the human step)`);
if (skipped.example) console.log(`  ${skipped.example} skipped: source=EXAMPLE template rows`);
if (skipped.empty) console.log(`  ${skipped.empty} skipped: empty utterance`);
console.log('');

const MIN_PER_INTENT = 10; // content-kit: "minimum ~10 per intent to be usable"
const warnings = [];
console.log('intent                     train  gold   by language');
for (const [intent, { train, gold }] of [...byIntent].sort()) {
  const n = Object.values(train).flat().length;
  const langs = LANGS.filter((l) => train[l]?.length).map((l) => `${l}=${train[l].length}`).join(' ');
  const warn = (n + gold.length) < MIN_PER_INTENT ? '  ⚠ under 10 — too few to be usable' : '';
  console.log(`${intent.padEnd(26)} ${String(n).padStart(5)} ${String(gold.length).padStart(5)}   ${langs}${warn}`);
  // An intent with no held-out row is INVISIBLE to `npm run eval`: it contributes router
  // examples but nothing measures whether it actually routes. At a 20% hold-out that happens
  // ~4% of the time for 15 utterances, purely by luck of the hash. More rows is the fix, not
  // a reshuffle — reshuffling would break comparability with earlier eval runs.
  if (gold.length === 0 && n > 0) {
    warnings.push(`"${intent}" has 0 held-out rows, so npm run eval cannot measure it. Add more utterances.`);
  }
}

if (warnings.length) {
  console.log('');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) — fix the CSV and re-run:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
if (!usable.length) { console.error('\nNothing to write — no rows carry an intent_id yet.'); process.exit(1); }

// ── write ────────────────────────────────────────────────────────────────────
const existingFiles = existsSync(SEED_DIR)
  ? readdirSync(SEED_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  : [];

const planned = [];
for (const [intent, { train }] of byIntent) {
  const entityId = intent.startsWith('intent_') ? intent : `intent_${intent}`;
  const file = path.join(SEED_DIR, `${entityId}.json`);
  const flow = flowByIntent.get(intent);

  let doc;
  if (existsSync(file)) {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    if (!flow) { problems.push(`new intent "${intent}" has no target_flow — cannot create ${entityId}.json`); continue; }
    doc = {
      entity_id: entityId, type: 'intent', target_flow: flow,
      names: { en: intent.replace(/^intent_/, '').replace(/_/g, ' ') },
      examples: {}, status: 'draft', source: 'manual', version: 0,
    };
  }
  if (flow) doc.target_flow = flow;

  const before = Object.values(doc.examples ?? {}).flat().length;
  const merged = {};
  for (const lang of LANGS) {
    const fresh = train[lang] ?? [];
    const kept = has('merge') ? (doc.examples?.[lang] ?? []) : [];
    const all = [...new Set([...kept, ...fresh])];
    if (all.length) merged[lang] = all;
  }
  doc.examples = merged;
  doc.version = (doc.version ?? 0) + 1;
  doc.updated_at = new Date().toISOString();
  doc.languages_present = LANGS.filter((l) => merged[l]?.length);
  doc.source = 'mixed';
  doc.attributes = {
    ...(doc.attributes ?? {}),
    review_note: `Examples from real Laila logs via ${path.basename(input)} (${new Date().toISOString().slice(0, 10)}). ${HOLDOUT * 100}% of labelled rows held out to eval/gold/gold.jsonl.`,
  };

  planned.push({ file, doc, before, after: Object.values(merged).flat().length });
}

const goldRows = [];
for (const [intent, { gold }] of byIntent) {
  const flow = flowByIntent.get(intent);
  for (const r of gold) {
    goldRows.push({
      query: r.utterance,
      language: r.language,
      expected_flow: flow ?? null,
      notes: `held-out routing item from ${path.basename(input)}${r.notes ? ` — ${r.notes}` : ''}`,
    });
  }
}

console.log(`\n${planned.length} intent file(s), ${goldRows.length} gold item(s)`);
const created = [];
for (const p of planned) {
  const isNew = !existingFiles.includes(path.basename(p.file));
  const verb = isNew ? 'create' : (has('merge') ? 'merge' : 'REPLACE');
  if (isNew) created.push(path.basename(p.file, '.json'));
  console.log(`  ${verb.padEnd(8)} ${path.relative(ROOT_DIR, p.file)}  (${p.before} → ${p.after} examples)`);
}
// A near-duplicate label ("knowledge_query" alongside an existing "knowledge") splits one
// intent's examples across two entities and weakens both. Cheap to catch by eye here; very
// annoying to notice later, after the eval numbers have already moved.
if (created.length && existingFiles.length) {
  console.log(`\n  ℹ creating ${created.length} NEW intent(s): ${created.join(', ')}`);
  console.log(`    existing: ${existingFiles.map((f) => path.basename(f, '.json')).join(', ')}`);
  console.log('    If a new one is really the same intent as an existing one, relabel the CSV');
  console.log('    rather than splitting one intent across two entities.');
}

if (has('dry-run')) {
  console.log('\nDry run — nothing written. Drop --dry-run to apply.');
  process.exit(0);
}

for (const p of planned) writeFileSync(p.file, JSON.stringify(p.doc, null, 2) + '\n', 'utf8');

// Gold rows are APPENDED under a dated banner: the file already holds hand-written retrieval
// items (expected_chunk) that this script knows nothing about and must not clobber.
if (goldRows.length) {
  const banner = `# --- routing items from ${path.basename(input)}, added ${new Date().toISOString().slice(0, 10)} ---`;
  const existing = existsSync(GOLD_FILE) ? readFileSync(GOLD_FILE, 'utf8').replace(/\s*$/, '') : '';
  const body = goldRows.map((g) => JSON.stringify(g)).join('\n');
  writeFileSync(GOLD_FILE, `${existing}\n${banner}\n${body}\n`, 'utf8');
}

console.log(`\nWrote ${planned.length} intent file(s) and appended ${goldRows.length} gold item(s).`);
console.log('\nNEXT:');
console.log('  npm run ingest            # re-embed the new examples');
console.log('  npm run eval              # see where routing landed');
console.log('  npm run eval -- --sweep   # then set ROUTE_TAU_HIGH / ROUTE_MARGIN in .env');
