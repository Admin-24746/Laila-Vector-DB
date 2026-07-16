# 05 — Vector Database Selection

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

> The vector DB stores the records from doc 03/04 — each record = **vector + chunk text + metadata** —
> and answers "find the chunks nearest to this query vector, optionally filtered." Unlike the embedding
> model, the DB is **easy to swap** (the data is portable), so this is a lower-stakes decision than it
> feels. We optimize for fit-to-constraints and operational simplicity.

---

## 1. What we need the DB to do (requirements)

| # | Requirement | Why | Source |
|---|-------------|-----|--------|
| V1 | Store **1024-dim dense + sparse** vectors and search both (**hybrid**) | BGE-M3 emits both; sparse catches names/romanized terms | doc 04 |
| V2 | **Metadata filtering** (location, service_class, language, date ranges) | Conditional rules; per-language chunks | doc 02/03 |
| V3 | **Upsert & delete by ID** | Update one entity = delete-by-id + reinsert (no full re-index) | doc 03 §6 |
| V4 | **Open-source, self-hostable, commercial license** | Avoid approval/funding friction | constraints |
| V5 | **First-class JS/TS client** | Maintainer stack is JS | constraints |
| V6 | **Trivial to run for prototype**, **clusterable for production** | Phase 1 → Phase 2 | doc 00 §7 |
| V7 | Handle **small corpus, high query concurrency** | Scale = QPS not data size | doc 00 Principle 4 |

## 2. Candidate comparison

| DB | Lang / License | Hybrid (dense+sparse) | Filtering | JS client | Ops effort | Fit |
|----|----------------|----------------------|-----------|-----------|-----------|-----|
| **Qdrant** | Rust / Apache-2.0 | ✅ Native sparse+dense, fusion API | ✅ Rich payload filters | ✅ Official `@qdrant/js-client-rest` | 🟢 Single binary/Docker; clusters later | ✅ **Recommended** |
| Weaviate | Go / BSD-3 | ✅ BM25 + dense hybrid | ✅ Good | ✅ Official | 🟡 Heavier, more concepts | 🟡 Strong alt |
| pgvector (Postgres) | C ext / PostgreSQL license | 🟡 Dense native; sparse/BM25 is DIY (tsvector/pgvectorscale) | ✅ Full SQL | ✅ via `pg` | 🟢 If you already run Postgres | 🟡 "Boring tech" alt |
| Milvus | Go/C++ / Apache-2.0 | ✅ | ✅ | ✅ | 🔴 Heavy (etcd/minio/pulsar) | ❌ Overkill at our size |
| Chroma | Python / Apache-2.0 | 🟡 Limited | ✅ | 🟡 Less prod-grade | 🟢 Easy dev | 🟡 Prototype-only |
| Redis Stack | C / RSALv2+SSPL | 🟡 Vector + filter; hybrid DIY | ✅ | ✅ | 🟢 (esp. if used as cache too) | 🟡 Niche |
| OpenSearch / ES | Java / Apache-2.0 (OS) | ✅ BM25 + kNN | ✅ | ✅ | 🔴 Heavy JVM ops | ❌ Too heavy here |

## 3. Decision

### D4 — Vector database: **Qdrant (self-hosted)** ✅

**Why Qdrant fits us best:**

1. **Native hybrid that matches BGE-M3 exactly.** Qdrant stores **named vectors** — a dense (1024-dim)
   *and* a sparse vector per record — and fuses their scores in one query. Doc 04's whole "dense +
   sparse" advantage plugs straight in with no custom glue (V1).
2. **Powerful payload filtering.** Filter by `location=baghdad`, `service_class`, `language`, and date
   ranges (`valid_from/valid_to`) *combined with* vector search in a single call (V2) — this is the
   engine behind the metadata-filtered retrieval in doc 06.
3. **Clean upsert/delete by ID.** Our deterministic chunk IDs (`entity_id::section::language`) map to
   Qdrant point IDs; updating one bundle is delete-by-filter (`entity_id=…`) + upsert (V3).
4. **Apache-2.0, single self-contained binary.** `docker run qdrant/qdrant` and you're live — ideal for
   the prototype (V4, V6).
5. **Official, well-maintained TS/JS client** — `@qdrant/js-client-rest` — so the JS app talks to it
   directly (V5).
6. **Small-corpus-in-RAM + scales out later.** Our whole corpus fits in memory → microsecond-to-low-ms
   search; for production it supports replication/sharding and quantization for high QPS (V6, V7).

> **Runner-up:** if you discover you're already standardizing on **PostgreSQL** for other reasons,
> **pgvector** is the "boring tech" choice — one less service to run — at the cost of building hybrid
> search yourself. If there's no existing Postgres mandate, Qdrant's turnkey hybrid wins.

## 4. How our data maps onto Qdrant

```
Collection: "laila_knowledge"
  vectors:
    dense  : size 1024, distance Cosine        ← BGE-M3 dense
    sparse : sparse vector                      ← BGE-M3 lexical / or BM25
  point:
    id      : "bundle_combo::fees_edgecases::en"
    vector  : { dense:[…1024…], sparse:{indices,values} }
    payload : {                                  ← all filterable metadata
      entity_id: "bundle_combo", type:"bundle", subtype:"btl",
      section:"fees_edgecases", language:"en",
      eligible_locations:["baghdad"], eligible_service_classes:["red"],
      valid_from:"2026-06-20", valid_to:"2099-12-31",
      price_iqd:5000, version:3, updated_at:"…",
      text: "[Combo Bundle · BTL] Subscribing 3× in one month adds a 2,500 IQD fee."
    }
```

- One **collection** holds all entity types (bundles, services, terminology); the `type`/`subtype`
  payload fields distinguish them and are filterable. (Extensible — new types need no new collection.)
- The **chunk text rides in the payload** so search returns it directly for the LLM (doc-04 explanation).

## 5. Caching & scaling (production)

- **Cache layer (recommended for Phase 2):** put a cache (e.g. Redis) *in front of* retrieval keyed by
  normalized query + filters. At "all of Iraq" volume, repeated questions dominate → most traffic never
  touches Qdrant. This is the main scaling lever (doc 00 Principle 4; detailed in doc 10).
- **HA path:** Qdrant clustering (replication + sharding) for the production VM; snapshots for backup.
  Not needed for the prototype.

## 6. What we deliberately avoid

- ❌ Heavy distributed stores (Milvus/ES/OpenSearch) — operational weight with no payoff at our corpus size.
- ❌ Running multiple collections per entity type — one collection + payload filters is simpler and extensible.
- ❌ Premature clustering — single-node Qdrant is plenty for Phase 1.

## 7. Open items to confirm

- [ ] Approve **Qdrant self-hosted** (D4).
- [ ] Decide sparse source: **BGE-M3 sparse vectors** vs **Qdrant/BM25 lexical** (finalized in doc 06 hybrid design).
- [ ] Confirm **single-collection + payload-type** model (vs collection-per-type).
- [ ] Note for doc 10: decide cache technology (Redis vs in-process) for Phase 2.
