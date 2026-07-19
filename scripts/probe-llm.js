// Diagnostic: why does qwen3:4b still think (and truncate) on the full answer prompt
// despite /no_think? Tests the soft switch vs Ollama's native `think` parameter, on both
// the OpenAI-compat endpoint and the native /api/chat. Run with the service up (:8090).

import { ANSWER_SYSTEM, languageName } from '../src/service/prompts.js';
import { CONFIG } from '../src/lib/config.js';

const OLLAMA = 'http://localhost:11434';
const MODEL = process.env.LLM_MODEL || 'qwen3:4b';
const QUESTION = 'how much is the combo bundle and what do I get?';

async function realSystemPrompt() {
  const res = await fetch('http://127.0.0.1:8090/v1/retrieve', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(CONFIG.serviceToken ? { authorization: `Bearer ${CONFIG.serviceToken}` } : {}),
    },
    body: JSON.stringify({ text: QUESTION, language: 'en' }),
  });
  const { chunks, grounded_facts } = await res.json();
  const context = chunks.map((r) => `- (${r.chunk_id}) ${r.text}`).join('\n');
  return ANSWER_SYSTEM
    .replace('{language}', languageName('en'))
    .replace('{retrieved_chunks}', context)
    .replace('{structured_facts}', JSON.stringify(grounded_facts));
}

function summarize(label, ms, { content, finishReason, thinking, evalCount }) {
  const hasThink = /<think>/.test(content ?? '');
  console.log(`\n=== ${label}`);
  console.log(`  time=${(ms / 1000).toFixed(1)}s finish=${finishReason} eval_count=${evalCount ?? '?'} <think>=${hasThink} thinking_field=${thinking != null}`);
  console.log(`  content[0..200]: ${JSON.stringify((content ?? '').slice(0, 200))}`);
}

async function openaiChat(label, messages, extra = {}) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: 900, ...extra }),
  });
  const data = await res.json();
  const c = data.choices?.[0];
  summarize(label, Date.now() - t0, {
    content: c?.message?.content,
    finishReason: c?.finish_reason,
    thinking: c?.message?.reasoning ?? c?.message?.reasoning_content,
    evalCount: data.usage?.completion_tokens,
  });
}

async function nativeChat(label, messages, think) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false, think, options: { temperature: 0.2, num_predict: 900 } }),
  });
  const data = await res.json();
  summarize(label, Date.now() - t0, {
    content: data.message?.content,
    finishReason: data.done_reason,
    thinking: data.message?.thinking,
    evalCount: data.eval_count,
  });
}

const system = await realSystemPrompt();
console.log(`system prompt length: ${system.length} chars`);
const user = { role: 'user', content: QUESTION };
const userNoThink = { role: 'user', content: `${QUESTION} /no_think` };
const sys = { role: 'system', content: system };

await openaiChat('A: OpenAI + full prompt + /no_think (current behaviour)', [sys, userNoThink]);
await openaiChat('B: OpenAI + full prompt, plain (control)', [sys, user]);
await openaiChat('C: OpenAI + full prompt + body {think:false}', [sys, user], { think: false });
await nativeChat('D: native /api/chat + full prompt + think:false', [sys, user], false);
await nativeChat('E: native /api/chat + full prompt + /no_think, think unset', [sys, userNoThink], undefined);
