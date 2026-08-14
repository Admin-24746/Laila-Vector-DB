// Text normalization — the analyzer rules pinned in doc 06 (§ "Sparse analyzer")
// and doc 12 §2 steps 1–2. This exact function runs at BOTH ingest and query time;
// if the two sides ever diverge, sparse matching silently dies. Change it only in
// lockstep with a full re-ingest.

// Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits → ASCII.
const DIGIT_MAP = {};
for (let i = 0; i <= 9; i++) {
  DIGIT_MAP[String.fromCharCode(0x0660 + i)] = String(i);
  DIGIT_MAP[String.fromCharCode(0x06f0 + i)] = String(i);
}

// Letter unification (doc 06): make Arabic and Kurdish-Arabic script agree on
// shared letters. Kurdish-specific letters (پ چ ژ گ ڤ ڵ ڕ ێ ۆ) are NOT touched.
// ە (Kurdish ae) folds to ه for MATCHING only — langdetect reads the raw text
// first, so the Kurdish signal is consumed before this collapse (doc 12 §4).
const LETTER_MAP = {
  "أ": "ا", // أ → ا
  "إ": "ا", // إ → ا
  "آ": "ا", // آ → ا
  "ٱ": "ا", // ٱ → ا
  "ة": "ه", // ة → ه
  "ە": "ه", // ە → ه
  "ھ": "ه", // ھ → ه
  "ى": "ي", // ى → ي
  "ی": "ي", // ی → ي
  "ک": "ك", // ک → ك
};

// Arabic diacritics (harakat etc.) + tatweel, stripped for matching.
const STRIP_RE = /[ً-ٰٟـ]/g;

export function normalizeText(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.normalize("NFKC");
  s = s.replace(STRIP_RE, "");
  s = s.replace(/[٠-٩۰-۹]/g, (c) => DIGIT_MAP[c]);
  s = s.replace(/[آأإٱةەھىیک]/g, (c) => LETTER_MAP[c]);
  s = s.toLowerCase(); // affects Latin; Arabic script has no case
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Tokenize on Unicode letter/digit runs (doc 06 analyzer step 3).
// Single-character tokens are dropped unless numeric (noise vs "5000" style facts).
export function tokenize(normalized) {
  const runs = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return runs.filter((t) => t.length > 1 || /\p{N}/u.test(t));
}

export function analyze(raw) {
  return tokenize(normalizeText(raw));
}
