// The single Embedder interface (docs/04 §4 "clean swap path").
// Every embedding in the system — ingestion and query time — goes through here,
// so swapping BGE-M3/TEI for anything else touches exactly this module.

import { CONFIG } from './config.js';
import { normalizeForEmbedding } from './normalize.js';

const BATCH_SIZE = 24;
const TIMEOUT_MS = 120_000;

async function teiEmbedBatch(texts) {
  const res = await fetch(`${CONFIG.teiUrl}/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: texts, normalize: true, truncate: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`TEI /embed failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** @param {string[]} texts @returns {Promise<number[][]>} 1024-dim dense vectors */
export async function embed(texts) {
  const cleaned = texts.map(normalizeForEmbedding);
  const out = [];
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    out.push(...(await teiEmbedBatch(cleaned.slice(i, i + BATCH_SIZE))));
  }
  return out;
}

export async function embedOne(text) {
  return (await embed([text]))[0];
}

export async function embedderHealthy() {
  try {
    const res = await fetch(`${CONFIG.teiUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
