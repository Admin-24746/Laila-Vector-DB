// Thin Qdrant REST client (doc 05). Zero dependencies — the API is plain JSON.
// Collection: named dense vector (1024, cosine) + named sparse vector with the
// server-side IDF modifier (BM25-style scoring, doc 06).
import { config } from "./config.js";

async function q(method, path, body, { url = config.qdrantUrl } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Qdrant ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

export function createQdrant({ url = config.qdrantUrl, collection = config.collection, dim = config.denseDim } = {}) {
  const c = `/collections/${collection}`;
  return {
    collection,

    async ping() {
      const info = await q("GET", "/", undefined, { url });
      return info?.version ?? "unknown";
    },

    async ensureCollection() {
      try {
        await q("GET", c, undefined, { url });
        return { created: false };
      } catch { /* 404 → create */ }
      await q("PUT", c, {
        vectors: { dense: { size: dim, distance: "Cosine" } },
        sparse_vectors: { lexical: { modifier: "idf" } },
      }, { url });
      return { created: true };
    },

    async upsertPoints(points) {
      // points: [{ id, dense, sparse:{indices,values}, payload }]
      await q("PUT", `${c}/points?wait=true`, {
        points: points.map((p) => ({
          id: p.id,
          vector: { dense: p.dense, lexical: p.sparse },
          payload: p.payload,
        })),
      }, { url });
      return points.length;
    },

    async deleteByEntityId(entityId) {
      await q("POST", `${c}/points/delete?wait=true`, {
        filter: { must: [{ key: "entity_id", match: { value: entityId } }] },
      }, { url });
    },

    // Fetch one stored content_hash per entity for change detection (doc 07 §6).
    async getEntityHash(entityId) {
      const res = await q("POST", `${c}/points/scroll`, {
        filter: { must: [{ key: "entity_id", match: { value: entityId } }] },
        limit: 1,
        with_payload: ["content_hash"],
      }, { url });
      return res?.result?.points?.[0]?.payload?.content_hash ?? null;
    },

    async countPoints() {
      const res = await q("POST", `${c}/points/count`, { exact: true }, { url });
      return res?.result?.count ?? 0;
    },

    // Hybrid: dense + lexical prefetch, RRF fusion (doc 06 §2 step 4).
    async queryHybrid({ dense, sparse, filter, limit }) {
      const prefetchLimit = Math.max(limit * 4, 20);
      const res = await q("POST", `${c}/points/query`, {
        prefetch: [
          { query: dense, using: "dense", filter, limit: prefetchLimit },
          { query: sparse, using: "lexical", filter, limit: prefetchLimit },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      }, { url });
      return res?.result?.points ?? [];
    },

    // Dense-only: cosine scores, used by routing so τ thresholds stay meaningful (doc 06).
    async queryDense({ dense, filter, limit }) {
      const res = await q("POST", `${c}/points/query`, {
        query: dense,
        using: "dense",
        filter,
        limit,
        with_payload: true,
      }, { url });
      return res?.result?.points ?? [];
    },
  };
}

// Build a Qdrant filter from retrieval options (doc 06 §2.2).
// Empty eligible_* arrays mean "everywhere / everyone" → OR is_empty.
// NOTE: valid_from/valid_to date filtering is TODO (needs a datetime payload
// index) — tracked in doc 29 §3.
export function buildFilter({ types, location, serviceClass } = {}) {
  const must = [];
  if (types?.length > 0) must.push({ key: "type", match: { any: types } });
  if (location) {
    must.push({ should: [
      { key: "eligible_locations", match: { value: location } },
      { is_empty: { key: "eligible_locations" } },
    ] });
  }
  if (serviceClass) {
    must.push({ should: [
      { key: "eligible_service_classes", match: { value: serviceClass } },
      { is_empty: { key: "eligible_service_classes" } },
    ] });
  }
  return must.length > 0 ? { must } : undefined;
}
