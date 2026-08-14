# 29 — Implementation Plan & Environment

**Status:** ✅ Active · **Owner:** Yousif · **Created:** 2026-07-13 (build-gate opening)

> Docs 00–28 are the contract; this doc is the bridge to running code: where the code lives, which
> module implements which doc, how it's configured, and what this specific machine (Windows 11 laptop,
> RTX 5060) can and cannot run today. Per the repo's own incident-log lesson: **nothing below is
> described as done unless it is on disk and has been run.**

---

## 1. Where the code lives

Inside this same folder, next to the docs (docs are the contract; code sits beside it, all under the
existing `DevOps` git repo):

```
Vector DB/
├── docs/               the 30 design docs (this file is 29)
├── package.json        zero runtime dependencies — see §2
├── docker-compose.yml  Qdrant + TEI/BGE-M3 (needs Docker Desktop + WSL2, §6)
├── src/                the retrieval service + ingestion pipeline (JS, Node ≥ 20)
├── content/            entities + vocabularies (versioned knowledge, doc 07 §9)
│   ├── vocab.json      controlled vocabularies (doc 26) — DATA, not code
│   └── entities/       entity JSON files (SAMPLE set until the real seed-20 arrives)
├── eval/               gold set + harness output (doc 09)
└── test/               unit tests (node --test, no framework)
```

## 2. Stack decisions (alpha)

| Decision | Choice | Why |
|----------|--------|-----|
| Language | Plain Node.js ≥ 20, ESM, no TypeScript build step | Maintainer prefers JS (doc 01 §6); zero build friction |
| Runtime deps | **None.** `fetch` is built-in; Qdrant spoken to via its REST API directly; UUIDv5 via `node:crypto` | Tiny install, no supply-chain surface, works on a locked-down laptop |
| Test framework | `node --test` (built-in) | Zero deps, CI-ready (doc 23) |
| HTTP server | `node:http` + a 40-line router | 3 endpoints don't need a framework |
| Embedder | Pluggable via `EMBEDDER` env: `tei` (default; real) / `mock` (deterministic bag-of-tokens, for plumbing + tests) | TEI needs Docker (§6); development can't block on it |
| Routing score | Dense cosine (doc 06 patch) | τ thresholds stay auditable/calibratable |
| LLM features | **OFF** (rewrite gate, tie-breaker, `/answer`) per doc 08 §5b | No service credential exists yet |

> **`EMBEDDER=mock` is a plumbing tool, not a quality tool.** It makes retrieval *work* (shared tokens →
> similar vectors, and the sparse/lexical half is fully real), so pipeline/collection/hybrid/filter code
> can be exercised end-to-end — but **no quality number measured under mock means anything**. The doc-09
> bars are only meaningful under TEI/BGE-M3.

## 3. Module ↔ doc map

| Module | Implements |
|--------|-----------|
| `src/config.js` | env-driven config; thresholds τ_high/τ_low/margin (doc 06 §5, calibrated later per doc 09) |
| `src/normalize.js` | text normalization (doc 12 §2 steps 1–2; analyzer rules pinned in doc 06) |
| `src/langdetect.js` | deterministic language/script detector (doc 12 §4 patch) — runs on RAW text, before normalization |
| `src/sparse.js` | the pinned sparse analyzer → BM25-style sparse vectors (doc 06) |
| `src/uuid5.js` | UUIDv5 point IDs from chunk keys (doc 05 §4 constraint) |
| `src/schema.js` | entity validation against doc 25 + vocab (doc 26); referential checks (doc 07 §4) |
| `src/chunker.js` | section-aware, per-language chunks with contextual headers (doc 03); content hash (doc 07 §6) |
| `src/embedder.js` | `Embedder` interface (doc 04): TEI client + mock |
| `src/qdrant.js` | thin REST client: ensure-collection (dense 1024 cosine + sparse IDF), upsert, delete-by-entity, scroll, hybrid RRF query, dense query (doc 05/06) |
| `src/pipeline.js` | ingest: validate → hash-skip → chunk → embed → delete+upsert (doc 07) |
| `src/retrieve.js` | the ONE engine: normalize → detect → embed → hybrid search → same-language boost → assemble; `route()` with τ/margin/abstain (doc 06) |
| `src/server.js` | `POST /v1/route`, `POST /v1/retrieve`, `GET /health`; `/v1/answer` → 501 (doc 08) |
| `src/cli.js` | `init · ingest · query · route · eval · serve` (doc 20 alpha CLI) |
| `eval/harness.js` | Hit@k / MRR / per-language + routing accuracy / confusion / false-route + langdetect accuracy (doc 09) |

Deviations from doc examples, made deliberately:
- `grounded_facts` is returned **per entity** (`{ bundle_1601: { price_iqd: 5000 } }`), not flat — flat
  is ambiguous the moment top-k spans two bundles. Doc 08's example was illustrative.
- Date-window filtering (`valid_from`/`valid_to`) is **TODO** — needs a Qdrant datetime payload index;
  sample content carries no promo windows. Tracked here so it isn't silently forgotten.
- Ingest accepts `status: draft` with a warning in alpha (single collection = sandbox); the
  staging→promote split (doc 20) arrives with the second collection.

## 4. Configuration (env vars)

```
QDRANT_URL   default http://localhost:6333
TEI_URL      default http://localhost:8080
EMBEDDER     tei | mock          (default tei)
COLLECTION   default laila_knowledge
PORT         default 7100        (service port; 8080 is TEI's)
SERVICE_TOKEN  optional — if set, /v1/* require Authorization: Bearer <token> (doc 08 §5)
TAU_HIGH / TAU_LOW / MARGIN   routing thresholds (defaults 0.82 / 0.65 / 0.08 — placeholders until doc-09 calibration)
```

## 5. This machine, measured 2026-07-13 (updated same evening after the install)

| Component | Status |
|-----------|--------|
| Node | **v24.17.0 ✓** |
| npm | 11.13.0 ✓ |
| WSL2 | **✓ 2.7.10 installed 2026-07-13** (kernel 6.18.33.2-2; no reboot was needed) |
| Docker | **✓ Desktop 4.81.0, engine 29.6.1 (linux/WSL2) verified running** |
| TEI image | ⏳ pull was in flight at session end — `docker compose up -d` resumes it |
| GPU | RTX 5060 (Blackwell) — **still unverified for TEI**; first `docker compose logs tei` will answer it |

Qdrant also ships a native Windows binary (`qdrant_bin/`, gitignored) — that was the original
no-Docker path and remains the fallback. PATH gotcha for shells older than the install: prepend
`C:\Program Files\Docker\Docker\resources\bin` or pulls fail on `docker-credential-desktop`.

## 6. Getting to real embeddings (the one setup task)

1. Install **WSL2** (`wsl --install`, reboot) then **Docker Desktop** with the WSL2 backend and GPU support.
2. `docker compose up` in this folder — starts Qdrant + TEI with `BAAI/bge-m3`.
3. **Verify the RTX 5060 specifically:** it's a new-generation (Blackwell) card — if the pinned TEI
   image lacks kernels for it, try the latest TEI tag; worst case run TEI CPU-only for the prototype
   corpus (slower ingest, identical results).
4. Then run the doc-11 Phase-0 spike: license ✓ (BGE-M3 is MIT), and **sample Kurdish retrieval
   behaviour** via `node src/cli.js eval` on the gold set's Kurdish slice.

## 7. Phase-0 checklist (doc 11), restated against reality

- [x] Design docs complete + consistency-reviewed (2026-07-13)
- [x] Code scaffold: pipeline, engine, server, CLI, eval harness, tests
- [x] Qdrant running locally (native Windows binary) + end-to-end ingest/query/route under mock embedder
- [x] Docker Desktop + WSL2 installed & engine verified (2026-07-13, no reboot needed)
- [ ] TEI/BGE-M3 container up; GPU-vs-CPU on the RTX 5060 answered (runbook: HANDOVER §8)
- [ ] **Seed-20 real entities** authored (owner data — replaces `content/entities/` samples)
- [ ] Gold set expanded to ~150–300 real items incl. Kurdish slice (doc 09 §3)
- [ ] First real eval run → numbers vs prototype bars; calibrate τ thresholds
- [ ] Native-speaker review of ar/ckb/kmr sample content & templates (doc 21)

**Phase-0 exit (doc 11):** ingestion runs end-to-end on the seed set; eval harness produces numbers —
*under TEI/BGE-M3, not mock.*
