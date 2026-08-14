// BM25-style sparse vectors (doc 06, "Sparse analyzer"). Client side supplies
// term frequencies over hashed terms; Qdrant's IDF modifier supplies corpus
// statistics server-side. The analyzer (normalize.js) is shared with ingest —
// that sharing is the whole design.
import { analyze } from "./normalize.js";

// FNV-1a 32-bit over UTF-8 bytes → stable sparse index for a term.
export function termHash(term) {
  const bytes = Buffer.from(term, "utf8");
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// text → { indices: uint32[], values: number[] } (term frequencies, deduped).
export function toSparseVector(text) {
  const tf = new Map();
  for (const token of analyze(text)) {
    const idx = termHash(token);
    tf.set(idx, (tf.get(idx) ?? 0) + 1);
  }
  const indices = [...tf.keys()];
  return { indices, values: indices.map((i) => tf.get(i)) };
}
