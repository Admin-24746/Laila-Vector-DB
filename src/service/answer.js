// /v1/answer engine: retrieved chunks + grounded_facts → LLM composition (docs/15)
// → number-grounding guardrail (docs/08 §3). The costliest error is a confidently wrong
// price/fee; every number in the answer must literally exist in the provided evidence.

import { chat } from '../lib/llm.js';
import { normalizeDigits } from '../lib/normalize.js';
import {
  ANSWER_SYSTEM, STRICT_RETRY_NOTE, NOT_FOUND, SAFE_FALLBACK, languageName, ANSWER_PROMPT_VERSION,
  PROMPT_LEAK_MARKERS,
} from './prompts.js';

export { ANSWER_PROMPT_VERSION };

// Every digit-run in a text, separators stripped: "5,000 IQD" → "5000"; "*123*1#" → "123","1".
function numbersIn(text) {
  const cleaned = normalizeDigits(String(text)).replace(/(\d)[,.](?=\d{3}\b)/g, '$1');
  const found = new Set(cleaned.match(/\d+/g) ?? []);
  for (const w of magnitudeWordsIn(cleaned)) found.add(w);
  return found;
}

// Spelled-out magnitudes used to bypass the guardrail entirely: "five thousand" and
// "سبعة آلاف" contain no digit-run, so an invented price written in words was returned as
// `grounded: true`. Only MAGNITUDE words are matched — in this domain a price or data
// amount always carries one ("thousand", "ألف", "هەزار") — which keeps ordinary words like
// "one of the bundles" from tripping the guard. They are treated exactly like digit-runs:
// bound to the entity whose evidence contains them, so echoing the evidence stays legal
// while inventing "ten thousand" out of nothing does not.
const MAGNITUDE_LATIN = /\b(?:hundred|thousand|million|billion|sed|hezar|milyon)\b/gi;
// JS \b never matches at an Arabic-script boundary (the docs/12 edge-guard note), so the
// Arabic-script forms are matched bare.
const MAGNITUDE_ARABIC = /(?:مئة|مائة|ميه|آلاف|ألف|الف|ملايين|مليون|هەزار|سەد|ملیۆن)/g;

function magnitudeWordsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(MAGNITUDE_LATIN)) out.add(`word:${m[0].toLowerCase()}`);
  for (const m of String(text).matchAll(MAGNITUDE_ARABIC)) out.add(`word:${m[0]}`);
  return out;
}

// ── Per-entity number binding (docs/08 §3) ───────────────────────────────────
// The guardrail used to pool every retrieved number into ONE flat set, so a price
// BORROWED from another bundle in the same top-5 passed and was returned as
// `grounded: true` — the costliest error this endpoint can make. Numbers are now bound
// to the entity they came from, and a number may only be used while that entity is the
// one the answer is talking about.

/** Every surface form that identifies an entity in an answer: its per-language names + aliases. */
function entityIndex(results, facts) {
  const byEntity = new Map();
  for (const r of results) {
    const id = r.entity_id;
    if (!byEntity.has(id)) byEntity.set(id, { id, numbers: new Set(), labels: new Set() });
    const e = byEntity.get(id);
    for (const n of numbersIn(r.text)) e.numbers.add(n);
    for (const label of [r.payload?.name, ...(r.payload?.aliases ?? [])]) {
      if (typeof label === 'string' && label.trim().length >= 2) e.labels.add(foldLabel(label));
    }
  }
  // groundedFacts() describes the TOP entity only, so its numbers belong to that entity.
  // Look the key up directly rather than testing `topId &&` — a caller may legitimately
  // pass results with no entity_id, and `undefined` is a real key in this map.
  const top = byEntity.get(results[0]?.entity_id);
  if (top) for (const v of Object.values(facts)) if (v != null) for (const n of numbersIn(String(v))) top.numbers.add(n);
  return byEntity;
}

const foldLabel = (s) => normalizeDigits(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();

// Split on sentence enders AND on the connectives that separate clauses of a comparison
// ("Combo is 5,000 while Super Net is 10,000"), so each segment has one subject.
const SEGMENT_SPLIT = /(?<=[.!?؟।\n])|(?:\s+(?:while|whereas|but|and|أما|بينما|و?لكن|بەڵام)\s+)/i;

/**
 * Numbers in `answer` that no entity supports, or that are attributed to the WRONG entity.
 * Each segment is credited to the most recently named entity (falling back to the top
 * result, which is what the answer is about when it names nobody).
 * @returns {string[]} violation strings
 */
export function unsupportedNumbers(answer, results, facts) {
  const byEntity = entityIndex(results, facts);
  if (!byEntity.size) return [...numbersIn(answer)];

  const entities = [...byEntity.values()];
  const anyNumber = new Set(entities.flatMap((e) => [...e.numbers]));
  let active = entities.find((e) => e.id === results[0]?.entity_id) ?? entities[0];
  const violations = [];

  for (const segment of String(answer).split(SEGMENT_SPLIT)) {
    if (!segment) continue;
    const folded = foldLabel(segment);
    // Whichever known entity is named LAST in this segment owns the numbers after it.
    let bestAt = -1;
    for (const e of entities) {
      for (const label of e.labels) {
        const at = folded.lastIndexOf(label);
        if (at > bestAt) { bestAt = at; active = e; }
      }
    }
    for (const n of numbersIn(segment)) {
      if (active.numbers.has(n)) continue;
      const isWord = n.startsWith('word:');
      const shown = isWord ? n.slice(5) : n;
      violations.push(anyNumber.has(n)
        // Real, but it belongs to a DIFFERENT entity — the borrowed-price case.
        ? `misattributed_${isWord ? 'magnitude' : 'number'}: ${shown} is not a fact of ${active.id}`
        // A plain unsupported DIGIT stays a bare string: that is the shape callers and the
        // existing tests expect, and this is not the place to churn the contract.
        : (isWord ? `unsupported_magnitude: ${shown}` : n));
    }
  }
  return violations;
}

// Output leak-guard (docs/17 §2.4 last line): a distinctive prompt fragment in the answer
// means the model is echoing its instructions (extraction/jailbreak got through the
// hardened prompt). Deterministic — never trusts the model to police itself.
// Script sanity. None of the four supported languages uses CJK, so a CJK character means
// the small model drifted mid-sentence — observed 2026-09-10, an Arabic answer containing
// "بال不满意". `understand.js` already rejects CJK in a rewrite; the answer path had no
// equivalent guard, so the garbled text went straight to the customer. Latin is NOT flagged:
// brand names and shortcodes ("Asiacell", "Super Net", "NET10") are legitimately Latin in an
// Arabic answer, so the docs/21 native review judges that, not a regex.
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

export function scriptViolations(answer) {
  return CJK.test(answer) ? ['script_drift: CJK characters in a non-CJK answer'] : [];
}

export function promptLeakViolations(answer) {
  return PROMPT_LEAK_MARKERS
    .filter((m) => answer.includes(m))
    .map((m) => `prompt_leak: "${m.slice(0, 30)}…"`);
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

  // Guardrail (docs/08 §3 + docs/17 §2.4): verify every number, no prompt leakage,
  // and that a complete answer exists → one strict retry → safe fallback.
  const problems = (a) => {
    if (typeof a !== 'string') return [`llm_error: ${a.error}`];
    if (!a.trim()) return ['empty_answer'];
    return [...unsupportedNumbers(a, results, facts), ...promptLeakViolations(a), ...scriptViolations(a)];
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
