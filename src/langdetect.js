// Deterministic language/script detector (doc 12 §4). Runs on RAW text, before
// normalization — normalization deliberately collapses Kurdish-signal letters
// like ە, so running it first would blind this detector.
//
// The output is only ever used as a SOFT ranking boost (doc 12), so a wrong
// guess costs a nudge, not the answer. confidence:"low" → no boost at all.

const ARABIC_BLOCK = /[؀-ۿݐ-ݿ]/g;
const LATIN_BLOCK = /[a-zA-ZÀ-ɏ]/g;

// Kurdish-specific letters within Arabic script (Sorani/Badini orthography).
const KURDISH_ARABIC = /[پچژگڤڵڕێۆە]/g;

// Kurmanji Latin signals: hatted vowels + ş/ç, and common function words.
const KURDISH_LATIN_CHARS = /[êîûşç]/gi;
const KURDISH_LATIN_WORDS = new Set([
  "ez", "tu", "em", "hûn", "hun", "min", "te", "we", "ku", "ji", "bi", "di",
  "de", "li", "çi", "chi", "çawa", "chawa", "dixwazim", "dikim", "heye",
  "nîne", "nine", "deynê", "deyne", "pakêj", "pakej",
]);

export function detectLanguage(raw) {
  const text = typeof raw === "string" ? raw : "";
  const arabicCount = (text.match(ARABIC_BLOCK) ?? []).length;
  const latinCount = (text.match(LATIN_BLOCK) ?? []).length;

  if (arabicCount === 0 && latinCount === 0) {
    return { language: null, script: null, confidence: "low" };
  }

  if (arabicCount >= latinCount) {
    const kurdishHits = (text.match(KURDISH_ARABIC) ?? []).length;
    if (kurdishHits > 0) {
      return {
        language: "ckb",
        script: "arabic",
        confidence: kurdishHits >= 2 ? "high" : "medium",
      };
    }
    // No Kurdish-specific letters: most likely Arabic, but short Sorani text
    // can lack them — hence never more than medium, and never a hard filter.
    return {
      language: "ar",
      script: "arabic",
      confidence: arabicCount >= 6 ? "medium" : "low",
    };
  }

  const words = text.toLowerCase().match(/[\p{L}À-ɏ]+/gu) ?? [];
  const kurdishWordHits = words.filter((w) => KURDISH_LATIN_WORDS.has(w)).length;
  const kurdishCharHits = (text.match(KURDISH_LATIN_CHARS) ?? []).length;
  if (kurdishWordHits + kurdishCharHits > 0) {
    return {
      language: "kmr",
      script: "latin",
      confidence: kurdishWordHits + kurdishCharHits >= 2 ? "high" : "medium",
    };
  }
  return {
    language: "en",
    script: "latin",
    confidence: latinCount >= 6 ? "medium" : "low",
  };
}
