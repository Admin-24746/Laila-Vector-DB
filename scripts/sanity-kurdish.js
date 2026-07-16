// Phase 0 checks from docs/11: verify the BGE-M3 license and eyeball Kurdish retrieval
// behaviour (D5 — "measure, don't assume"). Run after `npm run ingest`.

import { retrieve } from '../src/service/retrieve.js';

console.log('── BGE-M3 license check ─────────────────────────');
try {
  const res = await fetch('https://huggingface.co/api/models/BAAI/bge-m3', {
    signal: AbortSignal.timeout(10_000),
  });
  const meta = await res.json();
  const license = meta.cardData?.license ?? meta.license ?? '(not reported)';
  console.log(`huggingface.co/BAAI/bge-m3 → license: ${license}`);
  console.log(license === 'mit'
    ? '✅ MIT — commercial self-hosting is fine (docs/04 R3).'
    : `⚠️ Expected "mit" (docs/04) — verify manually at https://huggingface.co/BAAI/bge-m3`);
} catch {
  console.log('(offline) docs/04 records BGE-M3 as MIT — verify once at https://huggingface.co/BAAI/bge-m3');
}

const QUERIES = [
  ['ckb', 'چۆن کۆمبۆ هەڵدەوەشێنمەوە؟'],
  ['ckb', 'پاکێجی ئینتەرنێتی مانگانە'],
  ['kmr', 'Çawa Combo betal bikim?'],
  ['kmr (romanized, no diacritics)', 'cawa combo betal bikim'],
  ['kmr (romanized)', 'chend e pakeja internet a hefteyi'],
];

console.log('\n── Kurdish retrieval sanity (top 3 each) ────────');
for (const [label, query] of QUERIES) {
  const results = await retrieve(query, { topK: 3, mode: 'hybrid' });
  console.log(`\n[${label}] "${query}"`);
  if (!results.length) console.log('  (no results)');
  for (const r of results) {
    console.log(`  ${r.score.toFixed(3)}  ${r.chunk_id}`);
    console.log(`         ${r.text.slice(0, 90)}${r.text.length > 90 ? '…' : ''}`);
  }
}
console.log('\nJudge by eye: does the right entity/section rank first for each? The measured');
console.log('answer comes from `npm run eval` (Kurdish slice bars, docs/09 §5).');
