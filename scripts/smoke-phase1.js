// Phase 1 smoke test — exercises every endpoint the way Druid would (UTF-8 clean).
import { CONFIG } from '../src/lib/config.js';

const BASE = 'http://127.0.0.1:8090';
const AUTH = CONFIG.serviceToken ? { authorization: `Bearer ${CONFIG.serviceToken}` } : {};

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...AUTH }, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

const show = (label, obj) => console.log(`\n=== ${label}\n${JSON.stringify(obj, null, 1).slice(0, 1200)}`);

// 1. health
const h = await fetch(BASE + '/healthz').then((r) => r.json());
show('healthz', h);

// 2. console served?
const html = await fetch(BASE + '/').then((r) => r.text());
console.log(`\n=== console: ${html.includes('Sandbox') ? 'OK' : 'MISSING'} (${html.length} bytes)`);

// 3. retrieve, Arabic
const r1 = await post('/v1/retrieve', { text: 'اكو رسوم اذا اشتركت بكومبو ثلث مرات بنفس الشهر؟' });
show('retrieve ar (top chunk + understanding)', {
  top: r1.data.chunks?.[0], grounded_facts: r1.data.grounded_facts,
  qu: r1.data.query_understanding, latency: r1.data.latency_ms,
});

// 4. multi-turn follow-up → gated rewrite (docs/12)
const r2 = await post('/v1/retrieve', {
  text: 'and how do I cancel it?',
  history: [
    { role: 'user', text: 'tell me about the combo bundle' },
    { role: 'assistant', text: 'Combo gives you 500 on-net minutes, 25 SMS, 300 MB for 5,000 IQD (4 weeks).' },
  ],
});
show('retrieve follow-up (rewrite expected)', {
  qu: r2.data.query_understanding, top: r2.data.chunks?.slice(0, 2).map((c) => ({ id: c.chunk_id, s: c.score })),
  latency: r2.data.latency_ms,
});

// 5. route with shadow mode (docs/08 §6)
const r3 = await post('/v1/route', { text: 'can you lend me some balance please', current_flow: 'btl_flow' });
show('route + shadow (old dispatcher said btl_flow)', r3.data);

// 6. answer, English (grounded numbers expected)
const r4 = await post('/v1/answer', { text: 'how much is the combo bundle and what do I get?' });
show('answer en', r4.data);

// 7. answer, Arabic follow-up with history (rewrite + grounded)
const r5 = await post('/v1/answer', {
  text: 'وشلون الغيها؟',
  history: [
    { role: 'user', text: 'شنو باقة كومبو؟' },
    { role: 'assistant', text: 'باقة كومبو: 500 دقيقة داخل الشبكة و300 ميغابايت لمدة 4 أسابيع بـ5,000 دينار.' },
  ],
});
show('answer ar follow-up', r5.data);

// 8. answer for something we don't know → deterministic not-found (no invention)
const r6 = await post('/v1/answer', { text: 'do you sell starlink satellite internet?' });
show('answer unknown-topic', { answer: r6.data.answer, grounded: r6.data.grounded, citations: r6.data.citations });
