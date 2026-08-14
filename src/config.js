// Central config (docs/29 §4). Everything env-driven with safe defaults.
export const config = {
  qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
  teiUrl: process.env.TEI_URL ?? "http://localhost:8080",
  embedder: process.env.EMBEDDER ?? "tei", // "tei" | "mock"
  collection: process.env.COLLECTION ?? "laila_knowledge",
  port: Number(process.env.PORT ?? 7100),
  serviceToken: process.env.SERVICE_TOKEN ?? null,

  // Routing thresholds (doc 06 §5). Placeholders until doc-09 calibration —
  // conservative on purpose: favour clarifying over misrouting.
  tauHigh: Number(process.env.TAU_HIGH ?? 0.82),
  tauLow: Number(process.env.TAU_LOW ?? 0.65),
  margin: Number(process.env.MARGIN ?? 0.08),

  // Same-language soft boost (doc 12 §4): small, tie-breaking — never a filter.
  langBoost: Number(process.env.LANG_BOOST ?? 0.05),

  denseDim: 1024, // BGE-M3 (doc 04 §6). The mock embedder emits the same dim.
};
