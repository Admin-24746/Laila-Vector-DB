// Text normalization (docs/06 §2 step 1; digit rules from docs/25 §4).
// Two levels:
//   - normalizeForEmbedding: light — keep the text natural for BGE-M3 (dense meaning).
//   - normalizeForSparse: aggressive folding — forgiving lexical/exact-term matching only,
//     never used for display or embedding.

const ARABIC_INDIC_DIGITS = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g; // harakat, superscript alef, quranic marks
const TATWEEL = /ـ/g;

export function normalizeDigits(s) {
  return s.replace(/[٠-٩۰-۹]/g, (d) => ARABIC_INDIC_DIGITS[d] ?? d);
}

export function normalizeForEmbedding(s) {
  return normalizeDigits(String(s).normalize('NFC'))
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Folds that bridge Arabic/Kurdish keyboard + script confusion (ه↔ة↔ە, ي↔ی, ك↔ک …).
// Recall-oriented: on a small corpus, catching a mistyped letter beats letter purity.
const SPARSE_FOLDS = [
  [/[أإآٱ]/g, 'ا'],
  [/ئ/g, 'ا'],
  [/ء/g, ''],
  [/ى/g, 'ي'],
  [/ی/g, 'ي'],
  [/[ةە]/g, 'ه'],
  [/ک/g, 'ك'],
  [/ڕ/g, 'ر'],
  [/ڵ/g, 'ل'],
  [/[ۆؤ]/g, 'و'],
];

export function normalizeForSparse(s) {
  let t = normalizeForEmbedding(s).toLowerCase();
  for (const [re, to] of SPARSE_FOLDS) t = t.replace(re, to);
  return t;
}

export function tokenizeForSparse(s) {
  const tokens = normalizeForSparse(s).match(/[\p{L}\p{N}]+/gu) ?? [];
  // Single non-digit letters carry no lexical signal
  return tokens.filter((t) => t.length >= 2 || /\d/.test(t));
}
