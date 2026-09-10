// Offline eval harness (docs/09): metrics A (retrieval Hit@k/MRR per language) and
// B (routing accuracy, confusion matrix, false-route, abstain) against eval/gold/gold.jsonl.
// Exact-match against labels — fast, free, no LLM. Metric C (answer quality) is Phase 1+.
// Usage: npm run eval [-- --sweep]   (--sweep grid-searches τ_high/margin, docs/09 §4)

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, ROOT_DIR } from '../lib/config.js';
import { retrieve } from '../service/retrieve.js';
import { decide } from '../service/route.js';
import { qdrantHealthy } from '../lib/qdrant.js';
import { embedderHealthy } from '../lib/embedder.js';

const GOLD_FILE = path.join(ROOT_DIR, 'eval', 'gold', 'gold.jsonl');
const RUNS_DIR = path.join(ROOT_DIR, 'eval', 'runs');
const SWEEP = process.argv.includes('--sweep');
const CLARIFY = '__clarify__';

// Prototype-gate bars (docs/09 §5)
const BARS = { hit5: 0.85, hit5Kurdish: 0.70, routingAccuracy: 0.85, falseRouteRate: 0.05 };

const pct = (x) => (x == null ? '  n/a' : `${(100 * x).toFixed(1)}%`);
const isKurdish = (lang) => lang === 'ckb' || lang === 'kmr';

function loadGold() {
  return readFileSync(GOLD_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
    .map((l) => JSON.parse(l));
}

async function evalRetrieval(items) {
  const rows = [];
  for (const item of items) {
    const expected = item.expected_chunks ?? [item.expected_chunk];
    const results = await retrieve(item.query, { topK: 5, mode: 'hybrid' });
    const rank = results.findIndex((r) => expected.includes(r.chunk_id)) + 1; // 0 = miss
    rows.push({
      query: item.query, language: item.language, expected, rank,
      top: results.slice(0, 3).map((r) => ({ chunk_id: r.chunk_id, score: r.score })),
    });
    process.stdout.write(`\rRetrieval… ${rows.length}/${items.length}`);
  }
  process.stdout.write('\n');

  const agg = (subset) => subset.length === 0 ? null : {
    n: subset.length,
    hit3: subset.filter((r) => r.rank > 0 && r.rank <= 3).length / subset.length,
    hit5: subset.filter((r) => r.rank > 0 && r.rank <= 5).length / subset.length,
    mrr: subset.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / subset.length,
  };

  const byLang = {};
  for (const lang of [...new Set(rows.map((r) => r.language))].sort()) {
    byLang[lang] = agg(rows.filter((r) => r.language === lang));
  }
  return {
    rows,
    overall: agg(rows),
    kurdish: agg(rows.filter((r) => isKurdish(r.language))),
    byLang,
    misses: rows.filter((r) => r.rank === 0 || r.rank > 5),
  };
}

async function routeRaw(items) {
  const raw = [];
  for (const item of items) {
    const matches = await retrieve(item.query, { types: ['intent'], topK: 8, mode: 'dense' });
    raw.push({ item, matches });
    process.stdout.write(`\rRouting… ${raw.length}/${items.length}`);
  }
  process.stdout.write('\n');
  return raw;
}

export function scoreRouting(raw, thresholds) {
  let correct = 0;
  let falseRoutes = 0;
  const clarifyItems = { total: 0, correctAbstain: 0 };
  const confusion = {}; // expected → predicted → count
  const failures = [];

  for (const { item, matches } of raw) {
    const d = decide(matches, thresholds);
    const predicted = d.action === 'route' ? d.flow : d.action.toUpperCase();
    const expected = item.expected_flow;
    (confusion[expected] ??= {})[predicted] = (confusion[expected][predicted] ?? 0) + 1;

    if (expected === CLARIFY) {
      clarifyItems.total++;
      if (d.action !== 'route') { clarifyItems.correctAbstain++; correct++; }
      else {
        // An item that should have been clarified but was confidently routed IS a false
        // route — the exact failure the ≤0.05 gate exists to catch. This branch used to
        // `continue` before counting it, under-reporting the headline rate (audit item 2).
        falseRoutes++;
        failures.push({ query: item.query, expected, got: predicted, reason: d.reason });
      }
      continue;
    }
    if (d.action === 'route' && d.flow === expected) correct++;
    else {
      if (d.action === 'route') falseRoutes++; // confidently wrong — the worst case
      failures.push({ query: item.query, expected, got: predicted, reason: d.reason });
    }
  }

  return {
    n: raw.length,
    accuracy: correct / raw.length,
    falseRouteRate: falseRoutes / raw.length,
    abstainCorrect: clarifyItems.total ? clarifyItems.correctAbstain / clarifyItems.total : null,
    confusion,
    failures,
  };
}

function printConfusion(confusion) {
  const cols = [...new Set(Object.values(confusion).flatMap((r) => Object.keys(r)))].sort();
  const width = Math.max(18, ...cols.map((c) => c.length + 2));
  console.log(`\nConfusion matrix (rows = expected, cols = predicted):`);
  console.log(' '.repeat(22) + cols.map((c) => c.padStart(width)).join(''));
  for (const [expected, row] of Object.entries(confusion)) {
    console.log(expected.padEnd(22) + cols.map((c) => String(row[c] ?? '').padStart(width)).join(''));
  }
}

function sweep(raw) {
  console.log('\nThreshold sweep (τ_low = τ_high − 0.2):');
  console.log('τ_high  margin   accuracy  false-route  abstain-ok');
  const rows = [];
  for (let tauHigh = 0.5; tauHigh <= 0.91; tauHigh += 0.05) {
    for (const margin of [0, 0.02, 0.05, 0.1, 0.15]) {
      const t = { tauHigh, tauLow: tauHigh - 0.2, margin };
      const s = scoreRouting(raw, t);
      rows.push({ ...t, accuracy: s.accuracy, falseRouteRate: s.falseRouteRate, abstainCorrect: s.abstainCorrect });
      console.log(
        `${tauHigh.toFixed(2).padEnd(8)}${margin.toFixed(2).padEnd(9)}${pct(s.accuracy).padEnd(10)}${pct(s.falseRouteRate).padEnd(13)}${pct(s.abstainCorrect)}`,
      );
    }
  }
  const safe = rows.filter((r) => r.falseRouteRate <= BARS.falseRouteRate);
  const best = (safe.length ? safe : rows).sort((a, b) => b.accuracy - a.accuracy)[0];
  console.log(`\nBest under false-route ≤ ${BARS.falseRouteRate}: τ_high=${best.tauHigh.toFixed(2)} margin=${best.margin.toFixed(2)} → accuracy ${pct(best.accuracy)}, false-route ${pct(best.falseRouteRate)}`);
  console.log('Set ROUTE_TAU_HIGH / ROUTE_MARGIN in .env accordingly.');
  return rows;
}

async function main() {
  if (!(await qdrantHealthy()) || !(await embedderHealthy())) {
    throw new Error('Stack not reachable (Qdrant/TEI). Run: npm run stack:up && npm run ingest');
  }
  const gold = loadGold();
  const retrievalItems = gold.filter((g) => g.expected_chunk || g.expected_chunks);
  const routingItems = gold.filter((g) => g.expected_flow);
  console.log(`Gold set: ${gold.length} items (${retrievalItems.length} retrieval, ${routingItems.length} routing)\n`);

  const A = await evalRetrieval(retrievalItems);
  const raw = await routeRaw(routingItems);
  const B = scoreRouting(raw, CONFIG.route);

  console.log('\n══ A. Retrieval ═══════════════════════════════');
  console.log('slice        n    Hit@3   Hit@5    MRR');
  const line = (name, m) => m && console.log(
    `${name.padEnd(10)}${String(m.n).padStart(4)}   ${pct(m.hit3)}  ${pct(m.hit5)}  ${m.mrr.toFixed(3)}`,
  );
  line('overall', A.overall);
  line('kurdish', A.kurdish);
  for (const [lang, m] of Object.entries(A.byLang)) line(`  ${lang}`, m);
  if (A.misses.length) {
    console.log(`\nMisses (${A.misses.length}):`);
    for (const m of A.misses) {
      console.log(`  ✗ [${m.language}] "${m.query}"\n      expected ${m.expected.join(' | ')}\n      got      ${m.top.map((t) => `${t.chunk_id} (${t.score.toFixed(3)})`).join(', ')}`);
    }
  }

  console.log('\n══ B. Routing ═════════════════════════════════');
  console.log(`thresholds: τ_high=${CONFIG.route.tauHigh} τ_low=${CONFIG.route.tauLow} margin=${CONFIG.route.margin}`);
  console.log(`accuracy ${pct(B.accuracy)} · false-route ${pct(B.falseRouteRate)} · correct-abstain ${pct(B.abstainCorrect)}`);
  printConfusion(B.confusion);
  if (B.failures.length) {
    console.log(`\nRouting failures (${B.failures.length}):`);
    for (const f of B.failures) console.log(`  ✗ "${f.query}" expected ${f.expected} got ${f.got} — ${f.reason}`);
  }

  let sweepRows = null;
  if (SWEEP) sweepRows = sweep(raw);

  console.log('\n══ Prototype gate (docs/09 §5) ════════════════');
  const gate = [
    ['Hit@5 overall ≥ 0.85', A.overall?.hit5, BARS.hit5],
    ['Hit@5 Kurdish ≥ 0.70', A.kurdish?.hit5, BARS.hit5Kurdish],
    ['Routing accuracy ≥ 0.85', B.accuracy, BARS.routingAccuracy],
    ['False-route ≤ 0.05', B.falseRouteRate, BARS.falseRouteRate, true],
  ];
  for (const [label, value, bar, inverted] of gate) {
    const ok = value != null && (inverted ? value <= bar : value >= bar);
    console.log(`${ok ? '✅' : '❌'} ${label} — got ${pct(value)}`);
  }

  mkdirSync(RUNS_DIR, { recursive: true });
  const report = {
    ts: new Date().toISOString(),
    thresholds: CONFIG.route,
    retrieval: { overall: A.overall, kurdish: A.kurdish, byLang: A.byLang, misses: A.misses },
    routing: { ...B, failures: B.failures },
    sweep: sweepRows,
  };
  const file = path.join(RUNS_DIR, `${report.ts.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${path.relative(ROOT_DIR, file)}`);
}

// Only run the eval when this file is the entry point — importing it (e.g. from
// test/audit-round2.test.js to reach scoreRouting) must not fire a real eval at the stack.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`Eval failed: ${err.message}`);
    process.exit(1);
  });
}
