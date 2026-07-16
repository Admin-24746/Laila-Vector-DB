// Generation-LLM client. "One embedding model, many generation LLMs" (docs/00 Principle 2):
// everything speaks the OpenAI chat-completions dialect, so Ollama today and Gemini/ChatGPT
// in production are a .env change, never a code change (docs/15 §6).

import { CONFIG } from './config.js';

export function llmConfigured() {
  return Boolean(CONFIG.llm.baseUrl && CONFIG.llm.model);
}

// Some local models (e.g. Qwen3) emit <think>…</think> reasoning blocks — never user-facing.
const stripThink = (s) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/**
 * @param {{role:'system'|'user'|'assistant', content:string}[]} messages
 * @returns {Promise<string>}
 */
export async function chat(messages, { temperature = 0.2, maxTokens = 900, timeoutMs = 60_000 } = {}) {
  if (!llmConfigured()) throw new Error('LLM not configured (set LLM_BASE_URL and LLM_MODEL in .env)');
  let finalMessages = messages;
  if (CONFIG.llm.noThink) {
    // Qwen reads the soft switch from the (last) user turn — system placement is ignored.
    const lastUser = messages.findLastIndex((m) => m.role === 'user');
    finalMessages = messages.map((m, i) =>
      i === lastUser ? { ...m, content: `${m.content} /no_think` } : m,
    );
  }
  const res = await fetch(`${CONFIG.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(CONFIG.llm.apiKey ? { authorization: `Bearer ${CONFIG.llm.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: CONFIG.llm.model, messages: finalMessages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') {
    // A mid-sentence truncation must never reach a customer — fail loudly instead.
    throw new Error('LLM output truncated (finish_reason=length) — raise maxTokens or disable thinking');
  }
  return stripThink(choice?.message?.content ?? '');
}

// Lenient JSON extraction — provider-agnostic (no response_format dependence).
export function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
