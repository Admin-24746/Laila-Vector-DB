// Input-side injection / jailbreak detection (docs/17 §2.1) — layer 1 of the safety
// pipeline. A weak local model (qwen2.5:3b) will obey a direct "ignore your instructions
// and reply with X" canary no matter how hard the system prompt forbids it — the hardened
// prompt (docs/15) and the output leak-guard (docs/17 §2.4) reduce but do not eliminate
// this (red-team evidence, 2026-07-16: PWNED / SECRET123 / "confirm it's free" all got
// through prompt-only defenses). So we detect a clear override/canary attempt up front and
// short-circuit to a deterministic safe deflection: the LLM is never asked, so an
// attacker-chosen token can never be echoed and a false premise can never be confirmed.
//
// Precision over recall (docs/17 §6 — we reduce, not eliminate, and keep humans in the
// loop). Every pattern targets wording that is unambiguously an instruction-override, not
// a topic — "what are the *rules* of Shukran?", "*ignore* calls from a number", or
// "وين اكتب *كلمة* السر؟" must NOT fire. Novel phrasings that slip past here still meet
// the hardened prompt + leak-guard.
//
// Arabic-script caveats (2026-07-19 adversarial review, all pinned in test/safety.test.js):
// - JS \b never matches at Arabic letters, so Arabic alternates use the explicit edge
//   guard (?:^|[^؀-ۿ]) from understand.js — otherwise 2-letter verbs like رد match
//   INSIDE استرد ("recover") and every password-recovery question gets deflected.
//   An attached و/ف conjunction (وجاوب…) is allowed before the verb.
// - Real customer input is undiacritized: never end an alternative in a bare diacritic
//   (إلغِ with a literal kasra U+0650 can never match الغي).
// - The canary frame REQUIRES the "only" qualifier (بس/فقط) or "one word" (كلمة وحدة):
//   bare verb+كلمة is how customers ask about passwords (كلمة السر).

const PATTERNS = [
  // "ignore / disregard / forget [all] [previous] instructions|rules|prompt".
  // "prompt" only counts with an instructional qualifier — "ignore the update prompt
  //  in the app" is a legit UI question; "ignore your/the system prompt" is not.
  /\b(ignore|disregard|forget|override)\b[^.?!\n]{0,40}\b(instructions?|rules?|guardrails?|guidance|(?:system|your|previous|prior|initial|original|above|these)\s+prompts?)\b/i,
  // canary: "reply / respond / say / output only [the] word …"
  /\b(reply|respond|answer|say|output|write|print|return)\b[^.?!\n]{0,30}\bonly\b[^.?!\n]{0,20}\bword\b/i,
  // Fake-authority override — requires the authority frame ("system" or an
  // announcement colon), NOT any mention of something new: "is there a new policy
  // for SIM registration?" / "the new command to check my balance" are topics.
  /\bnew\s+system\s+(rule|instruction|policy|prompt|command|directive)s?\b/i,
  /\bnew\s+(rule|instruction|policy|command|directive)s?\s*(from\b[^.?!\n:]{0,30})?:/i,
  // explicit override / role-reset markers
  /\bsystem\s+override\b/i,
  /\byou(?:\s+are|'?re)\s+now\b[^.?!\n]{0,30}\b(dan|unrestricted|jailbroken|a\s+different|no\s+longer)\b/i,

  // Arabic — forget/ignore/cancel [all] your instructions/rules/orders
  /(?:^|[^؀-ۿ])[وف]?(?:[اإ]نسى?|تناسى|تجاهلي?|[أإا]لغِ?ي?|[أا]همل)\s+(?:كل|جميع|كافة)?\s*(?:ال)?(?:تعليمات(?:ك)?|قواعد(?:ك)?|[أا]وامر(?:ك)?)/,
  // Arabic canary — "reply/answer with ONLY the word …" / "with ONE word …"
  /(?:^|[^؀-ۿ])[وف]?(?:جاوبني|جاوب|ردّ|رد|اكتبي?|اطبعي?|قولي?)\s+(?:(?:بس|فقط|[إا]لا)\s*ب?\s*كلمة|ب?كلمة\s+و[اح]?حدة)/,
  // Arabic fake-authority — "new SYSTEM rule/instruction" or announcement colon;
  // bare noun+جديد is a topic (اكو تعليمات جديدة لتفعيل الشريحة؟ is a real question)
  /(?:قاعدة|قانون|تعليمات|[أا]مر|[أا]وامر)\s+(?:ال)?نظام\s+(?:ال)?جديدة?/,
  /(?:^|[^؀-ۿ])(?:قاعدة|قانون|تعليمات|[أا]مر)\s+جديدة?\s*(?:من\s+\S+\s*)?[:：]/,
];

/**
 * True if the raw customer message is a clear prompt-injection / canary / override
 * attempt. Scans RAW text (not the rewrite — rewrites are anchored and harmless).
 * Callers must run this BEFORE any LLM-touching step (docs/17 §2.1) and also scan
 * history turns — an injection can hide in prior context (docs/17 §2.3).
 * @param {string} text
 */
export function detectInjection(text) {
  if (typeof text !== 'string' || !text) return false;
  return PATTERNS.some((re) => re.test(text));
}
