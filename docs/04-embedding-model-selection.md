# 04 — Embedding Model Selection

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

> The embedding model is the **one component you must keep consistent** across the whole system: the
> same model must embed both the stored chunks and the incoming queries (Principle 2). Swapping it later
> means re-embedding the entire corpus — cheap for us (tiny corpus), but still a deliberate choice. So we
> pick carefully once.

---

## 1. What an embedding model actually does

It converts a piece of text into a **vector** — a list of numbers (e.g. 1024 of them) that encodes the
text's *meaning*. Texts with similar meaning land close together in this number-space. Retrieval = "embed
the query, find the nearest chunk vectors." Two consequences:

- **The model defines the meaning-space.** Vectors from model A and model B are not comparable — never mix.
- **A model is only as good as its training coverage.** For us, that coverage must include Arabic, English,
  and **both Kurdish dialects in both scripts** — which is exactly where most models are weak.

## 2. Our requirements (from earlier docs)

| # | Requirement | Source |
|---|-------------|--------|
| R1 | **Multilingual + dialectal** — **Iraqi-dialect Arabic** (not just MSA), English, Kurdish **Sorani `ckb`** + **Badini/Behdini `kmr`**, Arabic + Latin script | doc 02, D5 |
| R2 | **Cross-lingual** — a query in one language can match a chunk stored in another | NFR1 |
| R3 | **Self-hostable, open-source, commercial-friendly license** | constraints |
| R4 | **Runs on RTX 5060 / 32GB** now, scales to a VM later | doc, hardware |
| R5 | **Supports hybrid (dense + lexical)** to catch exact names/codes & transliterations | doc 06 preview |
| R6 | **Callable from a JS app** (directly or via a REST microservice) | maintainer stack |

## 3. Candidate comparison

| Model | Params / Dim | Languages | License | Notes | Verdict |
|-------|--------------|-----------|---------|-------|---------|
| **BGE-M3** (BAAI) | ~560M / 1024 | 100+ | MIT ✅ | Dense **+ sparse + multi-vector** in one model; 8192-token context; strong cross-lingual | ✅ **Recommended** |
| multilingual-e5-large | ~560M / 1024 | ~100 | MIT ✅ | Strong dense; needs `query:`/`passage:` prefixes; dense-only | 🟡 Solid alternative |
| gte-multilingual-base | ~305M / 768 | 70+ | Apache-2.0 ✅ | Lighter/faster; 8192 context; slightly less coverage | 🟡 Good lightweight option |
| jina-embeddings-v3 | ~570M / 1024 | 89 | **CC-BY-NC** ❌ | Good quality but **non-commercial license** | ❌ License blocks production |
| OpenAI text-embedding-3-large | API / 3072 | many | Proprietary/API | No self-host; weaker on low-resource (Kurdish); per-call cost | ❌ Against constraints |
| Cohere embed-multilingual-v3 | API / 1024 | 100+ | Proprietary/API | Good multilingual but API-only, paid | 🟡 Fallback only |

## 4. Decision

### D3 — Embedding model: **BGE-M3, self-hosted** ✅

**Why BGE-M3 wins for *our* case specifically:**

1. **Hybrid in one model.** It emits a **dense** vector (meaning) *and* a **sparse/lexical** vector
   (exact terms) at once. That sparse signal is gold for us: it catches **exact bundle names, codes, and
   transliterated/romanized forms** ("Combo", "كومبو", "Elna w lil Kul") that pure-meaning vectors can
   miss — directly mitigating the romanized-Kurdish risk (R5, D5).
2. **Best-in-class cross-lingual** retrieval among open models (R2).
3. **Permissive MIT license** → no commercial/approval friction (R3).
4. **Fits our hardware** (~2.3GB, comfortable on the RTX 5060) and scales later (R4).
5. **1024-dim** vectors — modest storage, trivial at our corpus size.

> **Keep a clean swap path:** all embedding calls go through one internal `Embedder` interface. If we
> ever switch models, we re-embed the corpus and change one module — nothing else. A hosted fallback
> (Cohere) can sit behind the same interface for resilience.

### D5 — Kurdish coverage: **best-effort, multi-layered mitigation** ✅ (mitigated, measured in doc 09)

No open model is *great* at Kurdish (especially romanized Kurmanji). We do not pretend otherwise — we
stack mitigations and **measure** the result:

| Layer | Mitigation | Where |
|-------|-----------|-------|
| 1 | **Per-language chunks** — a `ckb`/`kmr` query matches a `ckb`/`kmr` chunk, not a translation | doc 03 §4.3 |
| 2 | **BGE-M3 sparse signal** — exact-term/name match independent of semantic coverage | this doc |
| 3 | **Aliases in contextual headers** — colloquial/romanized forms embedded into the text | doc 03 §4.2 |
| 4 | **Optional query-translation pivot** — for low-confidence Kurdish queries, also translate to Arabic/English and search those chunks (multi-query) | doc 06 |
| 5 | **Future fine-tuning** — collect real Kurdish query/answer pairs and fine-tune BGE-M3 | doc 11 roadmap |

> **D5 is explicitly a "measure it" decision** — the eval plan (doc 09) must include a Kurdish-specific
> test set so we know whether layers 1–3 suffice or we need 4–5.

### D1 — Storage language: **store all languages as per-language chunks** ✅ (confirmed)

Settled in doc 03 §4.3 and adopted here: we store every section in each language as its own chunk. This
maximizes accuracy (query ↔ chunk same language) and lets us answer in the user's language. Cost is ~4×
chunk count, negligible at our size.

## 5. Serving architecture (JS-first)

```
        ┌──────────────────────────────────────────────────────────────┐
        │  JS application (ingestion + retrieval service)               │
        │      │  POST /embed  { texts:[…] }                            │
        │      ▼                                                        │
        │  ┌────────────────────────────────────────────────┐          │
        │  │  Embedding microservice (BGE-M3)                │  GPU     │
        │  │  HuggingFace Text-Embeddings-Inference (TEI)    │◄── RTX   │
        │  │  Docker, REST, Apache-2.0                       │   5060   │
        │  └────────────────────────────────────────────────┘          │
        └──────────────────────────────────────────────────────────────┘
```

**Why a microservice instead of running the model inside Node:**
- Keeps the JS codebase clean; the model runs in a purpose-built, GPU-accelerated server (**TEI** —
  fast, production-grade, supports BGE-M3).
- Identical interface in dev and prod (just point at a different host).
- Language-agnostic REST → the JS app stays simple.

**Lightweight dev alternative (optional):** for quick local experiments without Docker, a smaller model
(e.g. `gte-multilingual-base`) can run in-process via **Transformers.js (ONNX)** in Node. Fine for
prototyping, but standardize on the **TEI + BGE-M3** path for anything we measure or ship.

## 6. Operational details to settle in implementation

- **Normalization:** L2-normalize vectors; use **cosine similarity** (standard for these models).
- **Prefixes:** BGE-M3 needs no `query:`/`passage:` prefixes (unlike E5) — simpler. (If we ever fall
  back to E5, the prefixes become mandatory.)
- **Batching:** embed chunks in batches during ingestion for throughput; single-text embed at query time.
- **Dimension:** 1024 (dense). Record it — the vector DB collection (doc 05) is created with this fixed size.
- **Sparse output:** enable BGE-M3 sparse vectors for hybrid (mechanics in doc 06; DB support in doc 05).

## 7. Open items to confirm

- [ ] Approve **BGE-M3 self-hosted via TEI** (D3).
- [ ] Approve the **Kurdish mitigation stack** and that final quality is judged by the doc-09 eval, not assumed.
- [ ] Approve serving via a **TEI microservice** (vs in-process Transformers.js).
- [ ] Note for doc 05: vector DB must support **1024-dim dense + sparse vectors** (hybrid).
