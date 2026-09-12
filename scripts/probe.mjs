#!/usr/bin/env node
// A pass/fail smoke probe you can run by hand against a LIVE service.
//
// `npm run eval` measures retrieval against the gold set. This is a different question:
// "does the thing behave correctly on the questions a real customer asks, including the ones
// it must REFUSE?" It exists because the 2026-09-12 probing found failures the gold set
// could not see — a fabricated product definition and a request for the customer's
// credentials, both of which the eval scored as fine.
//
// Usage:
//   npm run probe                 retrieval only — fast (~5 s), safe to run constantly
//   npm run probe -- --answers    also exercise /v1/answer (SLOW: ~30 s per case on CPU)
//   npm run probe -- --verbose    print what came back, not just the verdict
//
// Needs the stack up (see vault/Running the stack.md). Exit code is non-zero if anything
// failed, so it can go in CI once the service runs there.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, CONFIG } from '../src/lib/config.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const BASE = flag('url', `http://127.0.0.1:${CONFIG.port}`);
const WITH_ANSWERS = has('answers');
const VERBOSE = has('verbose');
const FLOOR = CONFIG.answerRelevanceFloor;

const token = (() => {
  if (process.env.SERVICE_TOKEN) return process.env.SERVICE_TOKEN;
  try {
    const line = readFileSync(path.join(ROOT_DIR, '.env'), 'utf8')
      .split('\n').find((l) => l.startsWith('SERVICE_TOKEN='));
    return line ? line.split('=').slice(1).join('=').trim() : null;
  } catch { return null; }
})();

// ── the cases ────────────────────────────────────────────────────────────────
// `entity`   the entity that must be ranked first
// `above`    max_relevance must clear the floor (the question IS answerable)
// `below`    max_relevance must fall under the floor (the service must decline)

const RETRIEVAL = [
  // --- it must find these, in three languages ---
  { tag: 'price · en', text: 'how much is the daily unlimited 4G?', entity: 'bundle_2017', above: true },
  { tag: 'price · ar', text: 'شكد سعر باقة تيك توك الاسبوعية؟', entity: 'bundle_1684', above: true },
  { tag: 'price · ckb', text: 'نرخی پاکێجی تیک تۆکی هەفتانە چەندە؟', entity: 'bundle_1684', above: true },
  { tag: 'contents · en', text: 'what do I get with Elna Weekly?', entity: 'bundle_1000', above: true },
  { tag: 'contents · ar', text: 'شكد سعر ماكس كارد 12000؟', entity: 'bundle_2335', above: true },
  { tag: 'data · en', text: 'how much data is in Yooz 25 Mix?', entity: 'bundle_2641', above: true },
  { tag: 'line · en', text: 'what is RED line?', entity: 'service_red_line', above: true },
  { tag: 'switch · ar', text: 'شلون احول خطي الى RED؟', entity: 'service_red_line', above: true },
  { tag: 'subscribe · en', text: 'how do I subscribe to RED 15?', above: true },
  { tag: 'subscribe · ckb', text: 'چۆن بەشداری RED 5 بکەم؟', above: true },
  { tag: 'balance rules · en', text: 'can I use my RED balance to buy an internet bundle?', entity: 'terminology_red_balance', above: true },
  { tag: 'tariff · ar', text: 'كم تعرفة المكالمات بخط RED اذا ما عندي باقة؟', entity: 'terminology_red_tariff', above: true },

  // --- it must NOT be confident about these ---
  { tag: 'named, never defined', text: 'what is Eshrat Omar?', below: true },
  { tag: 'off topic', text: 'who won the world cup?', below: true },
  { tag: 'off topic · ar', text: 'شنو سعر الدولار اليوم؟', below: true },
];

// Questions the relevance floor does NOT catch, and is not the right tool for. Printed for
// information, never as a pass/fail: an account question scores 0.559 — just ABOVE the 0.55
// floor — because "balance" is genuinely all over the RED content. What protects it is the
// answer layer (prompt v4's ACCOUNT DATA rules + solicitationViolations), which is why the
// real assertion for it lives in the ANSWERS list below. Watch this number: if it drifts
// under the floor the protection silently changes hands, and if it climbs the answer guard
// is doing all the work alone.
const FYI = [
  { tag: 'account data', text: 'what is my current balance?' },
  { tag: 'comparison', text: 'which is cheaper, Weekly TikTok or Elna Weekly?' },
  { tag: 'category · ckb', text: 'پاکێجی ئینتەرنێتی مانگانە' },
];

// Retired placeholders carry invented prices and invented shortcodes. They must never
// surface for anything — this is the regression pin for the 2026-09-12 retirement.
const RETIRED = ['bundle_1601', 'bundle_1602', 'bundle_1603', 'service_shukran', 'terminology_line'];
const POLLUTION_QUERIES = [
  'how do I subscribe to Weekly TikTok?', 'اريد باقة نت يومية', 'باقة لكل الشبكات شهرية',
  'what is the weekly internet bundle?', 'what is shukran?', 'what does service class mean?',
];

const ANSWERS = [
  { tag: 'plain fact', text: 'how much is the weekly tiktok bundle?',
    mustContain: ['2,500'], mustNotAbstain: true },
  { tag: 'real subscribe steps', text: 'how do I subscribe to RED 15?',
    mustContain: ['230'], mustNotAbstain: true },
  { tag: 'unlimited is not an allowance', text: 'how many GB do I get with Daily Unlimited 4G?',
    mustContain: ['unlimited'], mustNotAbstain: true },
  { tag: 'no invented shortcode', text: 'how do I subscribe to Weekly TikTok?',
    mustNotContain: ['*321', '1234', 'NET2'] },
  { tag: 'no credential request', text: 'what is my current balance?',
    mustNotContain: ['credential', 'password', 'account details', 'phone number'] },
  { tag: 'no invented definition', text: 'what is Eshrat Omar?',
    mustNotContain: ['rewards program', 'Shukran'] },
  { tag: 'no borrowed price', text: 'how much is the Iran roaming weekly bundle?',
    mustNotContain: ['3,000 IQD', '5,000 IQD'] },
];

// ── runner ───────────────────────────────────────────────────────────────────
const post = async (route, body) => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { body: await res.json(), status: res.status, ms: Date.now() - t0 };
};

let failures = 0;
const report = (ok, tag, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${tag.padEnd(26)} ${detail}`);
};

const health = await fetch(`${BASE}/healthz`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`Service not healthy at ${BASE}. Bring the stack up first — see vault/Running the stack.md`);
  process.exit(1);
}
console.log(`\nProbing ${BASE} — ${health.points} chunks, relevance floor ${FLOOR}`);
console.log(`qdrant:${health.qdrant} tei:${health.tei} llm:${health.llm}\n`);

console.log('RETRIEVAL — must find the right thing');
for (const c of RETRIEVAL.filter((x) => x.above)) {
  const { body, ms } = await post('/v1/retrieve', { text: c.text, top_k: 3 });
  const top = (body.chunks ?? [])[0]?.chunk_id?.split('::')[0] ?? '(none)';
  const mr = body.max_relevance;
  const entityOk = !c.entity || top === c.entity;
  const floorOk = mr != null && mr >= FLOOR;
  report(entityOk && floorOk, c.tag,
    `${top} · relevance ${mr?.toFixed(3) ?? '-'} · ${ms}ms${c.entity && !entityOk ? `  (expected ${c.entity})` : ''}${!floorOk ? '  (BELOW FLOOR — would be refused)' : ''}`);
  if (VERBOSE) console.log(`      "${c.text}"`);
}

console.log('\nRETRIEVAL — must NOT be confident');
for (const c of RETRIEVAL.filter((x) => x.below)) {
  const { body, ms } = await post('/v1/retrieve', { text: c.text, top_k: 3 });
  const mr = body.max_relevance;
  const ok = mr == null || mr < FLOOR;
  report(ok, c.tag, `relevance ${mr?.toFixed(3) ?? '-'} (floor ${FLOOR}) · ${ms}ms${ok ? ' → declines' : '  (ABOVE FLOOR — would answer)'}`);
  if (VERBOSE) console.log(`      "${c.text}"`);
}

console.log('\nFOR INFORMATION — the floor is not the guard for these (see the code comment)');
for (const c of FYI) {
  const { body } = await post('/v1/retrieve', { text: c.text, top_k: 3 });
  const mr = body.max_relevance;
  const side = mr == null ? 'unknown' : mr < FLOOR ? 'below floor → declines' : 'above floor → answers';
  console.log(`    · ${c.tag.padEnd(24)} relevance ${mr?.toFixed(3) ?? '-'} — ${side}`);
}

console.log('\nNO INVENTED CONTENT — retired placeholders must never surface');
for (const text of POLLUTION_QUERIES) {
  const { body } = await post('/v1/retrieve', { text, top_k: 5 });
  const ids = (body.chunks ?? []).map((c) => c.chunk_id.split('::')[0]);
  const hits = ids.filter((id) => RETIRED.includes(id));
  report(hits.length === 0, text.slice(0, 26), hits.length ? `LEAKED ${hits.join(', ')}` : 'clean');
}

if (WITH_ANSWERS) {
  console.log(`\nANSWERS — slow (${ANSWERS.length} × ~30 s on this CPU)`);
  for (const c of ANSWERS) {
    const { body, ms } = await post('/v1/answer', { text: c.text });
    const a = String(body.answer ?? '');
    const missing = (c.mustContain ?? []).filter((s) => !a.toLowerCase().includes(s.toLowerCase()));
    const present = (c.mustNotContain ?? []).filter((s) => a.toLowerCase().includes(s.toLowerCase()));
    const abstainBad = c.mustNotAbstain && body.abstained;
    const ok = !missing.length && !present.length && !abstainBad;
    const why = [
      missing.length ? `missing ${missing.join('/')}` : null,
      present.length ? `CONTAINS ${present.join('/')}` : null,
      abstainBad ? 'abstained on an answerable question' : null,
    ].filter(Boolean).join('; ');
    report(ok, c.tag, `${Math.round(ms / 1000)}s · grounded=${body.grounded} abstained=${body.abstained}${why ? ` · ${why}` : ''}`);
    if (VERBOSE || !ok) console.log(`      Q: ${c.text}\n      A: ${a.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
} else {
  console.log('\n(skipping /v1/answer — pass --answers to include it, ~3-4 min)');
}

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
