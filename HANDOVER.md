# Handover — Laila Knowledge Base (Vector DB)

> # ⛔ SUPERSEDED — DO NOT FOLLOW THE RUNBOOK IN THIS FILE
>
> **Read [`README.md`](README.md) instead.** This document describes the *original*
> implementation (`src/*.js`, port 7100, `content/entities/`, `EMBEDDER=mock`). That tree was
> replaced by `src/lib/` + `src/service/` + `data/seed/`, and commit `bd84b2e` (2026-08-14)
> merged the old one back into the repo alongside the new one.
>
> ### ✅ The legacy tree was DELETED on 2026-09-10 — the hazard below is now historical.
>
> The 13 `src/*.js` files and their four test files are gone. What had blocked the deletion
> was that `test/integration.qdrant.test.js` — the project's only integration coverage —
> imported the dead modules; it was rewritten onto the current pipeline first, and the unit
> coverage that was worth keeping moved to `test/lib-primitives.test.js`. **`content/` was
> deliberately NOT deleted**: it is hand-authored entity data, and nothing but the removed
> code read it. Migrate anything useful into `data/seed/`, then delete it.
>
> The rest of this banner records *why* the runbook below must not be followed — every
> command in it still targets modules that no longer exist. Verified 2026-08-21:
>
> - Both trees default to the **same Qdrant collection** (`laila_knowledge`).
> - The two sparse analyzers hash the same Arabic token to **different indices** (FNV-1a over
>   UTF-8 bytes vs UTF-16 code units) — **0 of 5 dimensions overlap**, so lexical retrieval for
>   Arabic and Kurdish silently dies.
> - The two point-ID functions disagree, so chunks **duplicate** instead of overwriting.
> - The legacy chunker writes `payload.chunk_key`; the live service reads `payload.chunk_id`.
> - `§5` and `§8` tell you to ingest with `EMBEDDER=mock`, writing plumbing-only vectors into
>   the collection customers are served from. Three entity IDs overlap between the two data
>   sets (`bundle_1601`, `intent_loan`, `terminology_line`), and legacy ingest deletes by
>   `entity_id` first.
>
> Also stale here: `qdrant_bin/` and `qdrant_storage/` are described in §7 as "gitignored
> already" — they are **committed** (see README). And the native `qdrant.exe` writes to
> `./storage`, not `./qdrant_storage`; `qdrant_storage/` is a stale 2026-08-11 database. Paths under
> `$env:USERPROFILE\Desktop\DevOps\Vector DB` are from the previous machine; the project now
> lives at `D:\Projects\DevOps\Vector DB`.
>
> Kept for history: the design-decision record (§4) and the open-issues list (§6) are still
> useful reading. The commands are not.

Last updated: 2026-07-13 (evening — after the Docker/WSL2 install)
Scope: everything under `Vector DB/` — 30 design docs + the alpha implementation.
Rule inherited from this repo's scraper incident log: **nothing in this file is called
"done" unless it is on disk, was actually run, and the commit is named.**

## Where we left off

**The design is complete, the gate is open, the alpha runs end-to-end (44/44 tests), and
as of this evening WSL2 + Docker Desktop are INSTALLED and the engine is VERIFIED running
— but the TEI/BGE-M3 image download was still in flight when the session ended.** So the
system has still only ever run with the MOCK embedder and FICTIONAL sample data. The next
session's first job is §8 step 1: finish the TEI bring-up and produce the project's
**first real quality number**.

Installed and verified today (no reboot was needed — the hypervisor was already running):

| Component | Version | Proof |
|-----------|---------|-------|
| VirtualMachinePlatform | enabled | `dism` exit 0 |
| WSL | 2.7.10 (kernel 6.18.33.2-2) | `wsl --version` |
| Docker Desktop | 4.81.0, engine 29.6.1, OSType linux | `docker info` |
| qdrant/qdrant image | pulled (270 MB) | `docker images` |
| TEI image (`text-embeddings-inference:latest`) | ⏳ **pull was in flight at session end** | re-run `docker compose up -d` — it resumes |

**Gotcha hit today (already worked around, will bite fresh shells only until re-login):**
shells opened before the install don't have Docker on PATH, and pulls fail with
`docker-credential-desktop: executable file not found`. Fix inside an old shell:
`$env:PATH = "C:\Program Files\Docker\Docker\resources\bin;" + $env:PATH`. New shells are fine.

If you are picking this up cold, this is the mock-mode smoke run (works regardless of TEI):

```powershell
cd "$env:USERPROFILE\Desktop\DevOps\Vector DB"
docker compose up -d qdrant       # vector DB on :6333  (fallback: .\qdrant_bin\qdrant.exe)
$env:EMBEDDER = "mock"
node src/cli.js init                            # create the collection
node src/cli.js ingest content/entities         # validate -> chunk -> embed -> upsert (99 chunks)
node src/cli.js query "extra fee if I subscribe to Elna w lil Kul 3 times?"
node src/cli.js route "سلفوني رصيد"             # -> loan_flow, with an auditable reason
node src/cli.js eval eval/gold.sample.jsonl     # doc-09 metrics report
npm test                                        # 44 tests incl. end-to-end vs real Qdrant
node src/cli.js serve                           # HTTP service on :7100
```

## 1. Status board (verify, don't believe)

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | 30 design docs (00–29) | ✅ Complete, consistency-reviewed | `docs/`, commit `84cd1f2` |
| 2 | Build gate (docs 00–07 review) | ✅ **OPENED 2026-07-13** by owner | `docs/README.md` |
| 3 | Doc fixes from the review (Qdrant IDs, sparse analyzer, LLM-OFF, soft language boost, doc-16 contradiction, `ar`/`kmr` naming) | ✅ All patched | `84cd1f2` |
| 4 | Alpha implementation (pipeline, engine, server, CLI, eval) | ✅ Built, 44/44 tests green | `d1c2f1c` |
| 5 | Qdrant running locally | ✅ v1.18.2 — ran native today; docker image now pulled too (compose is the primary path, `qdrant_bin/` the fallback) | `qdrant_bin/` (gitignored) |
| 6 | End-to-end verified (ingest → hybrid query → filters → routing → HTTP) | ✅ Observed, under `EMBEDDER=mock` | §5 below |
| 7 | WSL2 + Docker Desktop | ✅ **Installed & engine verified 2026-07-13** (WSL 2.7.10, Docker 4.81.0, no reboot needed) | §8 step 1 |
| 7b | Real embeddings (TEI + BGE-M3) | ⏳ **TEI image pull was in flight at session end; never yet started** — GPU-vs-CPU on the RTX 5060 still unverified | §6 issue 1, §8 step 1 |
| 8 | Real content (seed-20 bundles/services) | ❌ Samples are fictional | §6 issue 2 |
| 9 | Quality numbers vs doc-09 bars | ❌ **Not measured** — mock numbers are plumbing proof only | §6 issue 1 |
| 10 | Service-side LLM (rewrite, tie-breaker, `/answer`) | ⛔ OFF by design until a credential exists | doc 08 §5b |

Commits so far (newest first):

| Commit | What |
|--------|------|
| `f600419` | gitignore the `.qdrant-initialized` marker |
| `d1c2f1c` | the whole alpha implementation + tests + sample content |
| `84cd1f2` | doc consistency patches; build gate opened; doc 29 created |

## 2. What the implementation is

Zero-runtime-dependency Node ≥ 20 (deliberate — doc 29 §2: tiny install, no supply chain,
works on a locked-down laptop). `npm install` installs nothing. The docs are the contract;
`docs/29` maps every module to the doc it implements. Summary:

```
src/normalize.js    the pinned analyzer normalization (doc 06/12) — SHARED by ingest & query;
                    changing it requires a full re-ingest, or sparse matching silently dies
src/langdetect.js   deterministic ar/ckb/kmr/en detector — runs on RAW text, result is only
                    ever a soft ranking boost, never a filter (doc 12)
src/sparse.js       BM25-style sparse vectors (client TF + Qdrant server-side IDF)
src/uuid5.js        chunk_key -> UUIDv5 point IDs (Qdrant rejects string IDs; doc 05 §4)
src/schema.js       doc-25 validation gate against content/vocab.json (doc 26)
src/chunker.js      section-aware per-language chunks + contextual headers (doc 03)
src/embedder.js     one Embedder interface: tei (real) | mock (plumbing only)
src/qdrant.js       thin REST client: dense 1024 cosine + sparse IDF, hybrid RRF query
src/pipeline.js     validate -> content-hash skip -> chunk -> embed -> delete+upsert (doc 07)
src/retrieve.js     the ONE engine: knowledge (hybrid) + routing (dense cosine, τ/margin/abstain)
src/server.js       POST /v1/route, /v1/retrieve, GET /health; /v1/answer -> 501 (LLM-OFF)
src/cli.js          init · ingest · query · route · eval · serve
eval/harness.js     Hit@k, MRR, per-language, routing accuracy/confusion/false-route, langdetect
```

Env vars: `QDRANT_URL` `TEI_URL` `EMBEDDER=tei|mock` `COLLECTION` `PORT` (7100)
`SERVICE_TOKEN` `TAU_HIGH` `TAU_LOW` `MARGIN` — defaults in `src/config.js`.

## 3. The docs (read in this order when returning)

| Doc | One-line purpose |
|-----|------------------|
| `README.md` | Index, decision register D1–D18, build-gate record — **start here** |
| 00–01 | Problem, vision, three-bucket model; requirements & scope |
| 02 | Entity model (open/extensible schema; `type:intent` routing records) |
| 03 ⭐ | Chunking: section-aware, per-language, contextual headers, `{entity}::{section}::{lang}` |
| 04 | BGE-M3 self-hosted via TEI; Kurdish mitigation stack (D5 = measure it) |
| 05 | Qdrant; collection layout; **UUIDv5 point-ID constraint** |
| 06 | Retrieval pipeline; hybrid; **pinned sparse analyzer**; routing τ/margin/abstain |
| 07 | Ingestion: normalize → validate → hash-skip → upsert; reconciliation |
| 08 | Druid contract (`/route` `/retrieve` `/answer`); grounding guardrail; **§5b LLM-OFF alpha** |
| 09 | Eval: metrics, gold set, acceptance bars, regression gate |
| 10 | Security/scaling/ops; **real traffic ≈220k msgs/day** measured via the scraper |
| 11 | Phased roadmap with exit criteria |
| 12 | Query understanding; **language = soft boost, never filter**; gated rewrite (OFF) |
| 13 | Feedback loop (passive logging → weekly triage) |
| 14 🟡 | Flow/intent catalogue — **needs your real flow list** |
| 15 | Prompt design (persona, grounding, neutrality) |
| 16 | Roaming model (confirmed: packs + PAYG, per-country) |
| 17 | Safety: abuse & prompt-injection defenses |
| 18 🟡 | Image recognition — **needs your image categories** |
| 19 🟡 | Error catalogue — **needs your error sources** (ties to the scraper findings) |
| 20 | Content CRUD + staging→auto-test→promote (staging collection not built yet) |
| 21 | Authoring style guide (+ test questions per entity) |
| 22 | Business KPIs & dashboards |
| 23 | Software testing & CI layers |
| 24 | Human-handoff design |
| 25 | Data dictionary: field-by-field schema, D16 IDs, D18 units |
| 26 🟡 | Controlled vocabularies — **service_class list is a placeholder (red, yooz)** |
| 27 🟡 | Data sourcing map — **which APIs you can actually reach: unconfirmed** |
| 28 🟡 | Domain glossary — **terms are best-guesses, unvalidated** |
| 29 | Implementation plan, module↔doc map, environment reality, Phase-0 checklist |

## 4. Design decisions made DURING implementation (not obvious from docs alone)

1. **Intent utterances embed VERBATIM — no contextual header.** The e2e test caught this:
   headers diluted "سلفوني رصيد" from cosine 1.0 to 0.53 and the router refused to route.
   Doc 02 §2b always showed raw utterances; the chunker now honours it. (`src/chunker.js`)
2. **`grounded_facts` is per-entity** (`{bundle_1601:{price_iqd:5000}}`), not flat as in
   doc 08's illustrative example — flat is ambiguous when top-k spans two bundles.
3. **Routing scores are dense cosine** (not RRF fusion scores) so τ thresholds stay
   meaningful and calibratable. Knowledge retrieval uses hybrid RRF.
4. **Alpha ingests `status:draft` with a warning** (single collection = sandbox);
   `--require-verified` exists for later. The staging/live split (doc 20) is not built yet.

## 5. Verification evidence (all observed 2026-07-13, `EMBEDDER=mock`)

- `npm test` → **44 pass / 0 fail**, including integration vs real Qdrant: fresh collection,
  ingest 8 entities → 99 chunks, **re-ingest = no-op** (hash skip), Arabic query returns the
  Arabic chunk, **location filter hides the Baghdad-only bundle in Basra**, exact loan
  utterance routes, nonsense falls back.
- Eval on the 30-item sample gold set: Hit@5 93.3%, MRR 0.732, routing accuracy 93.8%,
  **false-route 0%**, abstain 6.3%, language detection 100%. **These prove the plumbing,
  not quality** — mock embedder, fictional data, tiny gold set.
- HTTP: `/health` ok · `/v1/route` routes with reason · `/v1/retrieve` returns chunks +
  grounded_facts + respects filters · `/v1/answer` → 501 as designed.

## 6. Open issues — what stands between here and Phase-0 exit

| # | Issue | Owner | Detail |
|---|-------|-------|--------|
| 1 | **Real embedder not yet running.** Docker/WSL2 ARE installed (2026-07-13); the TEI image pull was interrupted by session end and TEI has **never started here** — so the RTX 5060 (Blackwell) GPU question from doc 29 §6 is still open, and every quality number so far is mock/meaningless | Next session (runbook: §8 step 1) | If the GPU image won't run on the 5060, edit `docker-compose.yml` to the CPU image (`:cpu-latest`) — slower ingest, identical results at this corpus size |
| 2 | **Sample content is fictional.** Combo/Elna entities illustrate the docs, nothing more | You (data) | Author the real **seed-20** into `content/entities/` per doc 21; the validation gate will catch format errors |
| 3 | **Six CONFIRM data lists still empty** — flows (14), image categories (18), error sources (19), service_class vocab (26), API access map (27), glossary (28) | You (domain) | service_class placeholder currently `red, yooz` only — this gates real eligibility filtering |
| 4 | **Gold set is 30 sample items.** Doc 09 wants 150–300 real ones incl. the Kurdish slice, ideally phrased from real Laila logs | You + harness ready | `eval/gold.sample.jsonl` shows the format |
| 5 | **τ thresholds are uncalibrated placeholders** (0.82/0.65/0.08) | Blocked by 1+4 | Sweep on the real gold set per doc 09 §4 |
| 6 | **Service LLM credential missing** → query rewrite, routing tie-breaker, `/answer` all OFF | You (procurement) | Doc 08 §5b; system degrades safely meanwhile |
| 7 | **Date-window filtering (valid_from/to) not implemented** — needs a Qdrant datetime payload index | Code (small) | Noted in doc 29 §3 and `src/qdrant.js` |
| 8 | **ar/ckb/kmr sample text + condition templates are my drafts** — need native review before anything customer-facing | You / native speaker | doc 21 §3; templates in `src/chunker.js` |
| 9 | **Druid integration facts unverified**: REST webhook capability, auth method, history window, shadow-mode feasibility | You (Druid admin) | Doc 08 open items — verify before Phase 1 |
| 10 | **Staging→promote loop (doc 20) not built** — alpha writes to the one live collection | Code (Phase 1) | Design is ready; needs a second collection + swap |

## 7. Do not commit

- `qdrant_bin/`, `qdrant_storage/`, `tei_cache/`, `logs/` — all gitignored already.
- Real bundle data from internal APIs may be fine, but **anything with customer data is not** —
  this KB stores product knowledge only, never PII (doc 01 non-goals, doc 10 §1).

## 8. Where to start next session

1. **Finish the TEI bring-up (the runbook).** Everything is installed; only the image
   download + first start remain:

   ```powershell
   cd "$env:USERPROFILE\Desktop\DevOps\Vector DB"
   docker info                        # engine up? if not: start Docker Desktop, wait, retry
   docker compose up -d               # resumes the TEI pull (layers cache); starts qdrant + tei
   docker compose ps                  # wait until tei is Up
   docker compose logs tei            # WATCH THIS: (a) it downloads BAAI/bge-m3 (~2.3 GB) on
                                      # first start; (b) it prints whether it is on GPU or CPU.
                                      # CUDA/driver error on the RTX 5060 (Blackwell)? → edit
                                      # docker-compose.yml to image :cpu-latest and re-up (fine
                                      # at this corpus size). Record the outcome HERE.
   curl http://localhost:8080/health  # TEI ready
   # Mock vectors are NOT compatible with real ones — recreate the collection:
   curl -X DELETE http://localhost:6333/collections/laila_knowledge
   $env:EMBEDDER = "tei"
   node src/cli.js init
   node src/cli.js ingest content/entities
   node src/cli.js eval eval/gold.sample.jsonl   # ← the FIRST REAL quality number. Record it here.
   npm test                                       # must stay green
   ```

2. Record the eval numbers + the GPU/CPU outcome in §5/§6 of this file (and tick the
   Docker line in docs/29 §7).
3. Then the data work: the **seed-20 list** (issue 2) and the **service_class
   vocabulary** (issue 3) — both unblock everything downstream; the τ calibration
   (issue 5) needs the real gold set (issue 4).
4. Keep the habit: every claim in this file names a commit or a run you can repeat.
