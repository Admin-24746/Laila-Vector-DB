#!/usr/bin/env node
// FEBRA product export → data/seed/bundles/*.json (content-kit/seed-20-worksheet.md Part A).
//
// The worksheet's job is to replace the invented seed with the real catalogue. The FEBRA
// export is the only real bundle data we have on this machine, but it is a bot-flow
// artefact: the English rows carry id/price/validity/description, the per-language prompt
// files carry Arabic and Sorani copy keyed by BundleID, and several rows are damaged
// (a mis-escaped CSV cell, blank ids, two products sharing one id).
//
// So this is an import with a gate, not a copy. A row becomes an entity only when its
// identity and every required number can be READ from the export. Anything else lands in
// the report for a human, because a guessed number is a future wrong answer to a customer.
// Nothing it writes is `verified`: every entity is `status: "draft"` with a review_note
// naming what is still missing.
//
// Usage:
//   node scripts/febra-to-seed.mjs [--src <dir>] [--dry-run] [--report <file>]
//
//   --src        FEBRA PROJECT directory (default: ../febra/FEBRA PROJECT next to the repo)
//   --dry-run    print the report, write nothing (do this first)
//   --report     also write the report as markdown (default: content-kit/febra-import-report.md)

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../src/lib/config.js';
import { parsePromptBlocks, parseNamedBlocks, febraToEntities, linesToServices } from '../src/lib/febra.js';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes(`--${n}`);

const DEFAULT_SRC = path.resolve(ROOT_DIR, '..', 'febra', 'FEBRA PROJECT');
const SRC = path.resolve(flag('src', DEFAULT_SRC));
const OUT_DIR = path.join(ROOT_DIR, 'data', 'seed', 'bundles');
const SERVICE_DIR = path.join(ROOT_DIR, 'data', 'seed', 'services');
const REPORT = path.resolve(flag('report', path.join(ROOT_DIR, 'content-kit', 'febra-import-report.md')));
const DRY = has('dry-run');

if (!existsSync(SRC)) {
  console.error(`FEBRA export directory not found: ${SRC}\npass --src <dir>`);
  process.exit(1);
}

const read = (file) => {
  const full = path.join(SRC, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
};
const readJson = (file) => {
  const text = read(file);
  if (text == null) { console.error(`missing ${file} in ${SRC}`); process.exit(1); }
  return JSON.parse(text);
};
// The prompt files are optional per family: Yooz has Arabic copy but no Sorani block list,
// and a missing file must degrade to "no translation" rather than kill the import.
const blocksOf = (file) => {
  const text = read(file);
  if (text == null) return null;
  const blocks = parsePromptBlocks(text);
  return blocks.size ? blocks : null;
};
const translations = (files) => Object.fromEntries(
  Object.entries(files).map(([lang, file]) => [lang, blocksOf(file)]).filter(([, b]) => b),
);

// ckb, not a generic "ku": the Kurdish in these files is Sorani. Badini (kmr) is absent
// from the export entirely and is left blank rather than machine-translated (docs/21).
const FAMILIES = [
  {
    family: 'ATL',
    rows: readJson('bundles_ATL_FEBRA_En.json'),
    serviceClasses: [],
    translations: translations({ ar: 'ATL FEBRA Ar', ckb: 'ATL FEBRA Ku' }),
  },
  {
    family: 'Yooz',
    rows: readJson('bundles_Yooz_FEBRA_En.json'),
    // docs/28: Yooz bundles need a Yooz line — that is an eligibility fact, not a guess.
    serviceClasses: ['yooz'],
    translations: translations({ ar: 'Yooz FEBRA Ar', ckb: 'Yooz FEBRA Ku.js' }),
  },
];

// The RED plans go down a different path: they have no bundleId, and a tariff on a line is
// a service rather than a bundle. Their blocks are keyed by the (brand, untranslated) name.
const LINE_ROWS = readJson('bundles_Line_FEBRA_En.json');
const LINE_NAMES = LINE_ROWS.map((r) => String(r.name ?? '').replace(/\*+/g, '').replace(/[:：]\s*$/, '').trim());
const namedBlocksOf = (file) => {
  const text = read(file);
  if (text == null) return null;
  const blocks = parseNamedBlocks(text, LINE_NAMES);
  return blocks.size ? blocks : null;
};
const lineTranslations = Object.fromEntries(
  Object.entries({ ar: 'Line FEBRA Ar', ckb: 'Line FEBRA Ku' })
    .map(([lang, file]) => [lang, namedBlocksOf(file)]).filter(([, b]) => b),
);

const bundles = febraToEntities(FAMILIES);
const services = linesToServices(LINE_ROWS, { translations: lineTranslations });

const entities = bundles.entities;
const serviceEntities = services.entities;
const skipped = [...bundles.skipped, ...services.skipped];
const notes = [...bundles.notes, ...services.notes];

// ── what already exists ──────────────────────────────────────────────────────
const existing = new Set(
  existsSync(OUT_DIR)
    ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.replace(/\.json$/, ''))
    : [],
);
const overwrites = entities.filter((e) => existing.has(e.entity_id));
const invented = [...existing].filter((id) => !entities.some((e) => e.entity_id === id));

// ── report ───────────────────────────────────────────────────────────────────
const byFamily = (name) => entities.filter((e) => e.attributes.febra_family === name).length;
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

say(`# FEBRA import report — ${new Date().toISOString().slice(0, 10)}`);
say();
say(`Source: \`${SRC}\``);
say(`Generated by \`npm run bundles:import\`${DRY ? ' (--dry-run: nothing written)' : ''}.`);
say();
const totalRows = FAMILIES.reduce((n, f) => n + f.rows.length, 0) + LINE_ROWS.length;
say(`**${entities.length + serviceEntities.length} of ${totalRows} rows imported**`
  + ` — ${byFamily('ATL')} ATL bundles, ${byFamily('Yooz')} Yooz bundles,`
  + ` ${serviceEntities.length} RED plans (as services).`);
say();

if (serviceEntities.length) {
  say('## Imported as services — the RED line plans');
  say();
  say('No `bundleId`, so these cannot be bundles — and a RED plan is a tariff on a line');
  say('rather than a bundle bought against one, so `service` is the right type anyway.');
  say('**They carry the only real subscription steps in the whole export.**');
  say();
  say('| entity | name | price | validity | subscribe | langs |');
  say('|---|---|---|---|---|---|');
  for (const e of serviceEntities) {
    say(`| \`${e.entity_id}\` | ${e.names.en} | ${e.price_iqd.toLocaleString('en-US')} |`
      + ` ${e.validity_days}d | ${e.how_to?.subscribe?.en ? '✅' : '—'} |`
      + ` ${e.languages_present.join(', ')} |`);
  }
  say();
}

say('## Imported as bundles');
say();
say('| entity | name | price | validity | data | langs |');
say('|---|---|---|---|---|---|');
for (const e of entities) {
  say(`| \`${e.entity_id}\` | ${e.names.en} | ${e.price_iqd.toLocaleString('en-US')} |`
    + ` ${e.validity_days}d | ${e.data_mb != null ? `${e.data_mb} MB` : '—'} |`
    + ` ${e.languages_present.join(', ')} |`);
}
say();

if (notes.length) {
  // Grouped by the caveat rather than by entity: "no kmr name" is true of all 50 and reads
  // as noise fifty times over, while the one row whose validity came from the wrong column
  // is what a reviewer actually needs to see. Every entity carries its own caveats in its
  // `attributes.review_note` regardless.
  const byNote = new Map();
  for (const { entity_id, notes: n } of notes) {
    for (const note of n) byNote.set(note, [...(byNote.get(note) ?? []), entity_id]);
  }
  say('## Imported with a caveat');
  say();
  for (const [note, ids] of [...byNote].sort((a, b) => a[1].length - b[1].length)) {
    say(`- **${ids.length === 1 ? ids[0] : `${ids.length} entities`}** — ${note}`);
    if (ids.length > 1) say(`  <br>${ids.map((i) => `\`${i}\``).join(', ')}`);
  }
  say();
}

say('## NOT imported — needs a human');
say();
say('Each of these is a real product we cannot represent honestly yet. None of it is a');
say('parser bug: the fact is absent or ambiguous in the export.');
say();
say('| family | bundleId | name | why |');
say('|---|---|---|---|');
for (const s of skipped) say(`| ${s.family} | ${s.bundleId || '—'} | ${s.name || '—'} | ${s.reason} |`);
say();

if (overwrites.length) {
  say(`## Overwrites existing seed files`);
  say();
  for (const e of overwrites) say(`- \`${e.entity_id}\` — replaced by the FEBRA row`);
  say();
}
if (invented.length) {
  say('## Left alone (not in the FEBRA export)');
  say();
  say('These are the placeholder entities. The gold set and `conflicts_with` still point at');
  say('them, so removing them here would break the eval — that is a separate, deliberate step.');
  say();
  for (const id of invented) say(`- \`${id}\``);
  say();
}

say('## What is still missing from every imported entity');
say();
say('- **`how_to.subscribe` on the 50 BUNDLES** — and it is not a transcription job. The ATL');
say('  prompt file tells the bot *"Use only the tool, don\'t provide information about the');
say('  subscription, renewal, stop or unsubscribe methods here, don\'t invent any steps"* —');
say('  the codes live behind a `User_Self_Subscription` tool, not in any document. Either');
say('  get them from product/BSS, or have `/v1/answer` hand subscription questions off.');
say('  The RED services above are the exception: their steps are in the source.');
say('- **`how_to.unsubscribe`** — absent for everything, including the RED plans.');
say('- **`aliases`** — needs real customer phrasings from the Laila logs, not invention.');
say('- **minutes / SMS** — the source says "500 mins , 500 SMS To all networks", which does');
say('  not map onto `minutes_onnet`/`minutes_offnet`. Left blank; the figures survive in the');
say('  description text, which is what gets embedded.');
say('- **kmr (Badini)** — absent from the export. Machine translation was not substituted.');
say('- **eligible_locations** — empty means everywhere; nobody has confirmed that.');
say();

// ── write ────────────────────────────────────────────────────────────────────
if (DRY) {
  console.log(`\n--dry-run: would write ${entities.length} bundles to ${path.relative(ROOT_DIR, OUT_DIR)}`
    + ` and ${serviceEntities.length} services to ${path.relative(ROOT_DIR, SERVICE_DIR)}`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SERVICE_DIR, { recursive: true });
  for (const e of entities) {
    writeFileSync(path.join(OUT_DIR, `${e.entity_id}.json`), `${JSON.stringify(e, null, 2)}\n`);
  }
  for (const e of serviceEntities) {
    writeFileSync(path.join(SERVICE_DIR, `${e.entity_id}.json`), `${JSON.stringify(e, null, 2)}\n`);
  }
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(`\nWrote ${entities.length} bundles to ${path.relative(ROOT_DIR, OUT_DIR)}`);
  console.log(`Wrote ${serviceEntities.length} services to ${path.relative(ROOT_DIR, SERVICE_DIR)}`);
  console.log(`Report: ${path.relative(ROOT_DIR, REPORT)}`);
  console.log('\nNext: npm run ingest:rebuild && npm run eval');
}
