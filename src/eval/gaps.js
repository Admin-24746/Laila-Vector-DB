// Feedback loop — the content-gap list (docs/13 §2/§4): mine the service audit logs for
// the signals that say "we don't know this" or "we weren't sure", cluster near-duplicates,
// rank by frequency. Output feeds authoring (docs/07 §9) and new gold items (docs/09).
// Usage: npm run gaps

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../lib/config.js';
import { normalizeForSparse } from '../lib/normalize.js';

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const RUNS_DIR = path.join(ROOT_DIR, 'eval', 'runs');

function readJsonl(file) {
  const p = path.join(LOG_DIR, file);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

// Near-duplicate clustering by aggressive normalization (docs/13 §2 "repeated misses")
function cluster(records, keyFn = (r) => r.text) {
  const groups = new Map();
  for (const r of records) {
    const key = normalizeForSparse(keyFn(r) ?? '');
    if (!key) continue;
    const g = groups.get(key) ?? { example: keyFn(r), count: 0, records: [] };
    g.count++;
    g.records.push(r);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const service = readJsonl('service.jsonl');
const shadow = readJsonl('shadow.jsonl');

const retrieves = service.filter((r) => r.endpoint === '/v1/retrieve');
const routes = service.filter((r) => r.endpoint === '/v1/route');
const answers = service.filter((r) => r.endpoint === '/v1/answer');

const report = {
  ts: new Date().toISOString(),
  window: { calls: service.length, from: service[0]?.ts ?? null, to: service.at(-1)?.ts ?? null },

  // "We don't know this" — content gaps (docs/13 §2)
  zero_result_retrievals: cluster(retrieves.filter((r) => !r.top)),

  // "We weren't sure" — weak/missing intent examples
  routing_abstains: cluster(routes.filter((r) => r.action !== 'route')).map((g) => ({
    ...g,
    records: undefined,
    languages: [...new Set(g.records.map((r) => r.language))],
    suggested: [...new Set(g.records.map((r) => r.suggested_flow))],
    avg_confidence: +(g.records.reduce((s, r) => s + (r.confidence ?? 0), 0) / g.count).toFixed(3),
  })),

  // Guardrail blocks / ungrounded answers — bad or missing data (docs/13 §2)
  ungrounded_answers: cluster(answers.filter((r) => r.grounded === false)),
  guardrail_retries: answers.filter((r) => r.guardrail?.retried).length,

  // Shadow mode (docs/08 §6): router vs old dispatcher
  shadow: {
    total: shadow.length,
    agreement_rate: shadow.length
      ? +(shadow.filter((r) => r.agrees).length / shadow.length).toFixed(3)
      : null,
    disagreements: cluster(shadow.filter((r) => !r.agrees)).map((g) => ({
      example: g.example,
      count: g.count,
      old_flow: [...new Set(g.records.map((r) => r.current_flow))],
      ours: [...new Set(g.records.map((r) => r.suggested_flow))],
    })),
  },
};

for (const g of report.zero_result_retrievals) delete g.records;
for (const g of report.ungrounded_answers) delete g.records;

console.log(`Gap report — ${report.window.calls} logged calls (${retrieves.length} retrieve, ${routes.length} route, ${answers.length} answer, ${shadow.length} shadow)\n`);

const section = (title, rows, fmt) => {
  console.log(`── ${title} (${rows.length}) ${'─'.repeat(Math.max(1, 46 - title.length))}`);
  for (const r of rows.slice(0, 15)) console.log('  ' + fmt(r));
  if (!rows.length) console.log('  (none)');
  console.log('');
};

section('Content gaps: zero-result retrievals', report.zero_result_retrievals,
  (g) => `${String(g.count).padStart(3)}×  "${g.example}"`);
section('Routing abstains (clarify/fallback)', report.routing_abstains,
  (g) => `${String(g.count).padStart(3)}×  "${g.example}"  → suggested ${g.suggested.join('/')} @ ${g.avg_confidence}`);
section('Ungrounded answers (guardrail served fallback)', report.ungrounded_answers,
  (g) => `${String(g.count).padStart(3)}×  "${g.example}"`);
if (report.shadow.total) {
  console.log(`── Shadow routing ─ agreement ${(report.shadow.agreement_rate * 100).toFixed(1)}% of ${report.shadow.total}`);
  for (const d of report.shadow.disagreements.slice(0, 15)) {
    console.log(`  ${String(d.count).padStart(3)}×  "${d.example}"  old ${d.old_flow.join('/')} vs ours ${d.ours.join('/')}`);
  }
  console.log('');
}

console.log('Triage (docs/13 §4): missing knowledge → author entity · abstain cluster → add intent examples');
console.log('· ungrounded → fix data · confirmed misses → add to eval/gold/gold.jsonl (regression protection)');

mkdirSync(RUNS_DIR, { recursive: true });
const file = path.join(RUNS_DIR, `gaps-${report.ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nReport saved: ${path.relative(ROOT_DIR, file)}`);
