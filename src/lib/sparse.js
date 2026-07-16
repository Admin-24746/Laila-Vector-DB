// Client-side lexical sparse vectors (docs/06 §2.1, prototype path).
// We supply term-frequency sparse vectors; Qdrant's `modifier: idf` on the collection
// applies IDF at query time — together ≈ BM25-style lexical scoring, no extra service.
// Phase-2 upgrade: swap for BGE-M3 native sparse output (same Qdrant plumbing).

import { tokenizeForSparse } from './normalize.js';

function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function sparseVector(text) {
  const tf = new Map();
  for (const token of tokenizeForSparse(text)) {
    const idx = fnv1a32(token);
    tf.set(idx, (tf.get(idx) ?? 0) + 1);
  }
  return { indices: [...tf.keys()], values: [...tf.values()] };
}
