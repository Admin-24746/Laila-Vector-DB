// The one Embedder interface (doc 04: "all embedding calls go through one
// internal Embedder interface"). Two implementations:
//   tei  — real: HuggingFace Text-Embeddings-Inference serving BGE-M3 (docker-compose)
//   mock — deterministic bag-of-hashed-tokens; shared tokens → similar vectors.
//          PLUMBING ONLY: no quality number under mock means anything (doc 29 §2).
import { config } from "./config.js";
import { analyze } from "./normalize.js";
import { termHash } from "./sparse.js";

function l2normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

function createTeiEmbedder({ url, dim }) {
  return {
    name: "tei/bge-m3",
    dim,
    async embed(texts) {
      const res = await fetch(`${url}/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: texts, normalize: true, truncate: true }),
      });
      if (!res.ok) throw new Error(`TEI /embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const vectors = await res.json();
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error(`TEI returned ${vectors?.length} vectors for ${texts.length} inputs`);
      }
      return vectors;
    },
  };
}

// Each token deterministically lights up 8 pseudo-random dimensions; texts that
// share tokens share dimensions → positive cosine. Enough to drive the pipeline.
function createMockEmbedder({ dim }) {
  return {
    name: "mock/bag-of-tokens (plumbing only)",
    dim,
    async embed(texts) {
      return texts.map((text) => {
        const vec = new Array(dim).fill(0);
        for (const token of analyze(text)) {
          let h = termHash(token);
          for (let i = 0; i < 8; i++) {
            h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
            const idx = h % dim;
            vec[idx] += ((h >>> 16) & 1) === 1 ? 1 : -1;
          }
        }
        return l2normalize(vec);
      });
    },
  };
}

export function createEmbedder(overrides = {}) {
  const opts = { kind: config.embedder, url: config.teiUrl, dim: config.denseDim, ...overrides };
  if (opts.kind === "tei") return createTeiEmbedder(opts);
  if (opts.kind === "mock") return createMockEmbedder(opts);
  throw new Error(`unknown EMBEDDER "${opts.kind}" (expected tei | mock)`);
}
