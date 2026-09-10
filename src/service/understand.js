// Query understanding (docs/12, D8): detect language/script → (embedder normalizes) →
// GATED LLM rewrite of context-dependent follow-ups → retrieve on raw+rewrite merged.
// Deterministic steps always run (~ms); the LLM runs only when the cheap gate fires,
// and any rewrite failure falls back to the raw query — never blocks retrieval (§7).

import { chat, extractJson, llmConfigured } from '../lib/llm.js';
import { normalizeForSparse } from '../lib/normalize.js';
import { CONFIG } from '../lib/config.js';
import { retrieve } from './retrieve.js';

export const LANG_CODES = ['en', 'ar', 'ckb', 'kmr'];

const ARABIC_SCRIPT = /[؀-ۿ]/;
const SORANI_MARKERS = /[ەێۆڕڵ]/g; // letters Sorani uses constantly and Arabic never
const ARABIC_MARKERS = /[ثذصضطظةإأؤ]/g; // letters common in Arabic, absent in Kurdish orthography
const KMR_LATIN_MARKERS = /[çêîûşÇÊÎÛŞ]/;

export function detectLanguage(text) {
  if (ARABIC_SCRIPT.test(text)) {
    const sorani = (text.match(SORANI_MARKERS) ?? []).length;
    const arabic = (text.match(ARABIC_MARKERS) ?? []).length;
    return sorani > arabic ? 'ckb' : 'ar';
  }
  if (KMR_LATIN_MARKERS.test(text)) return 'kmr';
  return 'en'; // includes Arabizi/romanized Kurdish — never used as a hard filter (docs/12 §7)
}

// Cheap follow-up gate (docs/12 §3): pronoun/deictic reference or an elliptical short
// message, in any of the four languages. Only meaningful when history exists.
// NOTE: JS \b only knows ASCII word chars — it can never match at Arabic-script or
// accented-Latin (ê î û ç ş) edges, so those alternates use explicit edge guards instead.
const DEICTIC = [
  /\b(it|its|that|this|those|these|the same one?)\b/i,
  /(?:^|[^؀-ۿ])(هذا|هذه|هاي|هاذ|ذاك|نفسه|نفسها|بيه|بيها|الها|اله|منه|منها|عليه|عليها)(?![؀-ۿ])/,
  /(ئەوە|ئەمە|هەمان|لەوە|بۆی|لێی)/,
  /(?:^|[^a-zçêîûş])(ew|ev|wê|wî|vê|vî|heman)(?![a-zçêîûş])/i,
];
// "و"/"وە" are written attached to the next word (وشلون…), so no trailing guard on them.
const ELLIPTICAL_START = /^(and\b|also\b|but\b|what about\b|how about\b|و|بس(?![؀-ۿ])|شنو عن|وە|هەروەها|û\b|ka\b)/i;

export function isFollowUp(text, history) {
  if (!history?.length) return false;
  const words = text.trim().split(/\s+/).length;
  if (DEICTIC.some((re) => re.test(text))) return true;
  return words <= 6 && ELLIPTICAL_START.test(text.trim());
}

// Prompt tuned for small local models (probed against qwen2.5:3b-instruct, 2026-07-16,
// twice): a worked example is what makes it reliably resolve the reference instead of
// echoing — but the example must MATCH the follow-up's language. A static Arabic example
// made the model COPY the example verbatim into English rewrites, and an English-only
// example left Iraqi-Arabic rewrites garbled (anchor-rejected → raw, the old ar
// limitation). Language-matched examples fixed 4/5 Arabic probe cases; the 5th (intent
// copied from the example) is caught by the anchoring guard (its verb isn't in the
// conversation → reject → raw). ckb/kmr keep the English example (probed: harmless
// near-raw or correct rewrites). qwen2.5:7b was probed too and is worse: it drifts to
// Chinese/English (V0) or mixed-script garbage (with the ar example) — see
// scripts/probe-rewrite-7b.js.
export const REWRITE_SYSTEM = `You rewrite a customer's follow-up message into ONE standalone question, using the conversation for context.
Rules:
- Resolve pronouns/references ("it", "هذا", "ئەوە"…) to the concrete thing discussed.
- Write the standalone question in the SAME language, script and dialect as the follow-up message — copy its words where possible. Never translate.
- Do not answer the question. Do not add information that is not implied.
- Reply with ONLY this JSON: {"standalone_query": "..."}`;

const REWRITE_EXAMPLE = {
  en: `Example:
Conversation:
Customer: tell me about roaming
Laila: Roaming lets you use your Asiacell line abroad.
Follow-up message: how much is it?
Reply: {"standalone_query": "how much does roaming cost?"}`,
  ar: `Example:
Conversation:
Customer: شنو باقة سوبر نت؟
Laila: باقة سوبر نت تنطيك 10 غيغابايت شهرياً بـ10,000 دينار.
Follow-up message: وشلون اشترك بيها؟
Reply: {"standalone_query": "وشلون اشترك بباقة سوبر نت؟"}`,
};

export const rewritePrompt = (language) =>
  `${REWRITE_SYSTEM}\n\n${REWRITE_EXAMPLE[language] ?? REWRITE_EXAMPLE.en}`;

const CJK = /[぀-ヿ㐀-䶿一-鿿]/;
const LATIN_LETTER = /[a-z]/i;
const TOKEN_SPLIT = /[\s؟?!.,،:؛;'"()\[\]{}«»…-]+/;

// Anchoring guard: a rewrite only resolves references, so nearly all of its words must
// already occur in the conversation. Rejects hallucinated/garbled rewrites (observed:
// qwen2.5:3b mangles Iraqi Arabic or substitutes a different question entirely).
// Both sides are orthography-folded (normalizeForSparse: أ→ا, ى→ي, ة→ه…) so a correct
// rewrite that shifts dialect spelling (ألغى vs الغيها) still anchors — probed 2026-07-16:
// raw matching rejected 7B's semantically-correct combo-cancel rewrite at 0.50.
// Longest clitic run tolerated when matching a rewrite token to a conversation token:
// Arabic/Kurdish proclitics (و ب ل ك ف ال, and combinations like وال) and enclitics
// (ها ه ي ك) attach to the word, so `بباقة` must still anchor to `باقة`.
const AFFIX_MAX = 3;

const tokenize = (s) => normalizeForSparse(s).split(TOKEN_SPLIT).filter((t) => t.length >= 2);

/**
 * Does a rewrite token occur in the conversation as a WORD (allowing attached clitics)?
 * The old test was `hay.includes(t)` against the whole conversation as one string — a
 * free substring match, under which the hallucinated rewrite "sub scribe to bun" scored
 * a perfect 1.00 against a corpus merely containing "subscribe" and "bundle", and sailed
 * through the 0.6 guard (audit 2026-08-22 item 5). Latin script has no clitics, so it
 * requires an exact (orthography-folded) token match.
 */
function tokenAnchored(t, corpusTokens) {
  if (corpusTokens.has(t)) return true;
  if (!ARABIC_SCRIPT.test(t) || t.length < 3) return false;
  for (const c of corpusTokens) {
    if (!ARABIC_SCRIPT.test(c) || c.length < 3) continue;
    const [short, long] = t.length <= c.length ? [t, c] : [c, t];
    if (long.length - short.length > AFFIX_MAX) continue;
    if (long.startsWith(short) || long.endsWith(short)) return true;
  }
  return false;
}

export function anchorRatio(clean, corpus) {
  const tokens = tokenize(clean);
  if (!tokens.length) return 0;
  const corpusTokens = new Set(tokenize(corpus));
  return tokens.filter((t) => tokenAnchored(t, corpusTokens)).length / tokens.length;
}

const isAnchored = (clean, corpus) => anchorRatio(clean, corpus) >= 0.6;

async function rewriteFollowUp(text, history, language) {
  const turns = history.slice(-6)
    .map((t) => `${t.role === 'assistant' ? 'Laila' : 'Customer'}: ${t.text ?? t.content ?? ''}`)
    .join('\n');
  const out = await chat([
    { role: 'system', content: rewritePrompt(language) },
    { role: 'user', content: `Conversation:\n${turns}\n\nFollow-up message: ${text}` },
  ], { temperature: 0, maxTokens: 400, timeoutMs: CONFIG.llm.rewriteTimeoutMs, model: CONFIG.llm.rewriteModel ?? undefined });
  const q = extractJson(out)?.standalone_query;
  if (typeof q !== 'string') return null;
  const clean = q.trim();
  // Sanity: reject empty, unchanged, or suspiciously long rewrites
  if (!clean || clean === text.trim() || clean.length > text.length + 120) return null;
  // Script guard: small models sometimes ignore the same-language rule and drift into
  // Chinese or translate. A cross-script rewrite hurts retrieval more than no rewrite —
  // reject and fall back to the raw query (docs/12 §7).
  if (CJK.test(clean)) return null;
  if (ARABIC_SCRIPT.test(text) && !ARABIC_SCRIPT.test(clean)) return null;
  if (!ARABIC_SCRIPT.test(text) && LATIN_LETTER.test(text) && !LATIN_LETTER.test(clean)) return null;
  if (!isAnchored(clean, `${text}\n${turns}`)) return null;
  return clean;
}

/**
 * @param {string} text raw customer message
 * @param {{role:string,text?:string,content?:string}[]} history recent turns (passed by Druid, docs/08)
 * @param {string} [languageHint] explicit language code, else auto-detect
 */
export async function understandQuery(text, history = [], languageHint) {
  const language = LANG_CODES.includes(languageHint) ? languageHint : detectLanguage(text);
  let rewritten = null;
  if (llmConfigured() && isFollowUp(text, history)) {
    try {
      rewritten = await rewriteFollowUp(text, history, language);
    } catch {
      rewritten = null; // LLM slow/down → raw query (docs/12 §7)
    }
  }
  return { raw: text, rewritten, language };
}

// Merge fallback (docs/12 §3): when a rewrite happened, retrieve with BOTH raw and
// rewritten queries and merge by best score — safer than betting on one.
export async function mergedRetrieve(understood, opts = {}) {
  if (!understood.rewritten) return retrieve(understood.raw, opts);
  const [rawResults, rewrittenResults] = await Promise.all([
    retrieve(understood.raw, opts),
    retrieve(understood.rewritten, opts),
  ]);
  const byChunk = new Map();
  for (const r of [...rawResults, ...rewrittenResults]) {
    const existing = byChunk.get(r.chunk_id);
    if (!existing || r.score > existing.score) byChunk.set(r.chunk_id, r);
  }
  return [...byChunk.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK ?? 5);
}
