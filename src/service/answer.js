// /v1/answer engine: retrieved chunks + grounded_facts → LLM composition (docs/15)
// → number-grounding guardrail (docs/08 §3). The costliest error is a confidently wrong
// price/fee; every number in the answer must literally exist in the provided evidence.

import { chat } from '../lib/llm.js';
import { normalizeDigits } from '../lib/normalize.js';
import {
  ANSWER_SYSTEM, STRICT_RETRY_NOTE, NOT_FOUND, SAFE_FALLBACK, languageName, ANSWER_PROMPT_VERSION,
} from './prompts.js';

export { ANSWER_PROMPT_VERSION };

// Every digit-run in a text, separators stripped: "5,000 IQD" → "5000"; "*123*1#" → "123","1".
function numbersIn(text) {
  const cleaned = normalizeDigits(String(text)).replace(/(\d)[,.](?=\d{3}\b)/g, '$1');
  return new Set(cleaned.match(/\d+/g) ?? []);
}

function allowedNumbers(results, facts) {
  const allowed = new Set();
  for (const r of results) for (const n of numbersIn(r.text)) allowed.add(n);
  for (const v of Object.values(facts)) if (v != null) for (const n of numbersIn(String(v))) allowed.add(n);
  return allowed;
}

export function unsupportedNumbers(answer, results, facts) {
  const allowed = allowedNumbers(results, facts);
  return [...numbersIn(answer)].filter((n) => !allowed.has(n));
}

function buildSystem({ results, facts, language }) {
  const context = results.map((r) => `- (${r.chunk_id}) ${r.text}`).join('\n') || '(empty)';
  const factsJson = Object.keys(facts).length ? JSON.stringify(facts) : '(none)';
  return ANSWER_SYSTEM
    .replace('{language}', languageName(language))
    .replace('{retrieved_chunks}', context)
    .replace('{structured_facts}', factsJson);
}

/**
 * @returns {Promise<{answer:string, grounded:boolean, citations:string[], guardrail:{retried:boolean, blocked:boolean, violations:string[]}}>}
 */
export async function composeAnswer({ question, results, facts, language }) {
  const citations = results.map((r) => r.chunk_id);

  if (!results.length) {
    // Grounding rule (docs/06 §4): nothing retrieved → say so, never invent. No LLM needed.
    return {
      answer: NOT_FOUND[language] ?? NOT_FOUND.en,
      grounded: true,
      citations: [],
      guardrail: { retried: false, blocked: false, violations: [] },
    };
  }

  const system = buildSystem({ results, facts, language });
  const attempt = async (sys, opts) => {
    try {
      return await chat([{ role: 'system', content: sys }, { role: 'user', content: question }], opts);
    } catch (err) {
      return { error: err.message }; // LLM failure/truncation → guardrail violation, not a 500
    }
  };

  // Guardrail (docs/08 §3): verify every number (and that a complete answer exists)
  // → one strict retry → safe fallback.
  const problems = (a) => {
    if (typeof a !== 'string') return [`llm_error: ${a.error}`];
    if (!a.trim()) return ['empty_answer'];
    return unsupportedNumbers(a, results, facts);
  };

  let answer = await attempt(system, { temperature: 0.2 });
  let violations = problems(answer);
  let retried = false;
  if (violations.length) {
    retried = true;
    answer = await attempt(system + STRICT_RETRY_NOTE, { temperature: 0 });
    violations = problems(answer);
  }
  if (violations.length) {
    return {
      answer: SAFE_FALLBACK[language] ?? SAFE_FALLBACK.en,
      grounded: false,
      citations,
      guardrail: { retried, blocked: true, violations },
    };
  }
  return { answer, grounded: true, citations, guardrail: { retried, blocked: false, violations: [] } };
}
