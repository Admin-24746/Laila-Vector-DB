// Probe (docs/12 §7 follow-up): does qwen2.5:7b-instruct rewrite Iraqi-Arabic follow-ups
// well enough to pass the anchoring guard, where qwen2.5:3b garbles them and fails safe?
// Evidence-gathering only — changes no code. Run with Ollama up:
//   node scripts/probe-rewrite-7b.js
// Imports the REAL rewrite prompt + anchoring logic from src/service/understand.js so the
// comparison is always apples-to-apples with production.

import { rewritePrompt, detectLanguage, anchorRatio } from '../src/service/understand.js';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1';
const MODELS = ['qwen2.5:3b-instruct', 'qwen2.5:7b-instruct'];

// The known-failing smoke case + a couple more Iraqi-Arabic follow-ups.
const CASES = [
  {
    id: 'combo-cancel (smoke case)',
    text: 'وشلون الغيها؟',
    history: [
      { role: 'user', text: 'شنو باقة كومبو؟' },
      { role: 'assistant', text: 'باقة كومبو: 500 دقيقة داخل الشبكة و300 ميغابايت لمدة 4 أسابيع بـ5,000 دينار.' },
    ],
  },
  {
    id: 'combo-price-followup',
    text: 'وشكد سعرها؟',
    history: [
      { role: 'user', text: 'اكو باقة نت اسبوعية؟' },
      { role: 'assistant', text: 'إي، باقة النت الأسبوعية تنطيك 3 غيغابايت لمدة 7 أيام.' },
    ],
  },
  {
    id: 'roaming-deictic',
    text: 'هاي تشتغل بتركيا؟',
    history: [
      { role: 'user', text: 'اشلون اشغل التجوال؟' },
      { role: 'assistant', text: 'تكدر تفعل خدمة التجوال الدولي عن طريق الاتصال بـ*123#.' },
    ],
  },
];

async function rewrite(model, text, history) {
  const turns = history
    .map((t) => `${t.role === 'assistant' ? 'Laila' : 'Customer'}: ${t.text}`)
    .join('\n');
  const res = await fetch(`${OLLAMA}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: 'system', content: rewritePrompt(detectLanguage(text)) },
        { role: 'user', content: `Conversation:\n${turns}\n\nFollow-up message: ${text}` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? '';
  const m = raw.match(/\{[\s\S]*\}/);
  let q = null;
  try { q = m ? JSON.parse(m[0]).standalone_query : null; } catch { q = null; }
  return { raw, q, latencyModel: model };
}

const ARABIC_SCRIPT = /[؀-ۿ]/;
const CJK = /[぀-ヿ㐀-䶿一-鿿]/;

for (const c of CASES) {
  const corpus = `${c.text}\n${c.history.map((t) => t.text).join('\n')}`;
  console.log(`\n=== ${c.id}\n  follow-up: ${c.text}`);
  for (const model of MODELS) {
    const t0 = Date.now();
    let out;
    try {
      out = await rewrite(model, c.text, c.history);
    } catch (err) {
      console.log(`  ${model}: ERROR ${err.message}`);
      continue;
    }
    const ms = Date.now() - t0;
    if (typeof out.q !== 'string' || !out.q.trim()) {
      console.log(`  ${model} (${ms}ms): no JSON rewrite — raw: ${out.raw.slice(0, 80).replace(/\s+/g, ' ')}`);
      continue;
    }
    const ratio = anchorRatio(out.q, corpus);
    const crossScript = ARABIC_SCRIPT.test(c.text) && !ARABIC_SCRIPT.test(out.q);
    const cjk = CJK.test(out.q);
    const verdict = crossScript ? 'REJECT cross-script'
      : cjk ? 'REJECT CJK drift'
        : ratio >= 0.6 ? `ACCEPT (anchor ${ratio.toFixed(2)})`
          : `REJECT (anchor ${ratio.toFixed(2)} < 0.60)`;
    console.log(`  ${model} (${ms}ms): ${out.q}`);
    console.log(`     → ${verdict}`);
  }
}
console.log('\nInterpretation: ACCEPT = the anchoring guard would keep this rewrite and use it for');
console.log('retrieval. If 7b ACCEPTs the smoke case where 3b REJECTs, that justifies routing the');
console.log('rewrite call (only) to 7b — the fix noted in the README known-limitations section.');
