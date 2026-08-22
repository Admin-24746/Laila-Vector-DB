# Laila Knowledge Base — Phase 0 implementation

RAG retrieval + semantic routing engine for Asiacell bundle/service knowledge, serving the **Laila**
agent and its flow-builders. **The design contract lives in [`docs/`](docs/README.md)** — read it
before changing behaviour; this code implements docs 02–09.

Stack (D3/D4): **Qdrant** (hybrid dense+lexical, one collection) + **TEI serving BGE-M3**
(1024-dim, cosine) + a **Node retrieval service** exposing the docs/08 contract.

## Quickstart

```bash
docker compose up -d      # Qdrant :6333 + TEI/BGE-M3 :8080 (first start downloads ~2.3GB)
npm install
npm run ingest            # seed data → validate → chunk ×4 languages → embed → Qdrant
npm run serve             # retrieval-svc on :8090
npm run eval              # gold-set metrics (add -- --sweep for threshold calibration)
npm run sanity:kurdish    # D5 eyeball check + BGE-M3 license check
npm test                  # unit suite (docs/23) — offline, no stack needed
```

Config: copy `.env.example` → `.env` (defaults work locally).

## Endpoints (docs/08 contract)

| Endpoint | Purpose |
|---|---|
| `POST /v1/retrieve` | knowledge retrieval — `{text, language?, filters?{location,service_class}, top_k?, expand?}` → chunks + `grounded_facts` + `bucket_hint` |
| `POST /v1/route` | semantic router — `{text}` → `{flow, confidence, action: route\|clarify\|fallback, reason}` |
| `POST /v1/answer` | retrieve + LLM compose (docs/15 prompt) + number-grounding guardrail (docs/08 §3) + injection filter & leak-guard (docs/17) |
| `GET /healthz` | stack health + point count |

## Layout

```
docs/            the design contract (00–28)
data/seed/       entity JSONs (one file per entity; _TEMPLATE.* to author new ones)
data/vocab/      controlled vocabularies (docs/26) — placeholders to CONFIRM
src/lib/         chunker (docs/03), embedder (docs/04), qdrant (docs/05), validate (docs/25)…
src/ingest/      pipeline CLI (docs/07): incremental, hash-based, idempotent
src/service/     retrieve() engine (docs/06) + REST server (docs/08) + safety filter (docs/17)
src/eval/        eval harness (docs/09): Hit@k/MRR per language, routing confusion, τ sweep
eval/gold/       gold test set (JSONL) — starter items incl. Kurdish slice
eval/redteam/    adversarial suite (docs/17 §5) — `npm run redteam`, needs live service
eval/runs/       saved eval reports (gitignored)
test/            unit suite (docs/23): chunker, normalizer, follow-up gate, guardrail, safety…
logs/            service audit log JSONL (gitignored)
```

## Where we left off (updated 2026-08-22)

**Phase 0 + Phase 1 are done and committed. A full security + correctness audit ran on
2026-08-21 against the new laptop, and its blocking findings are FIXED** (`ab98c99`, branch
`fix/audit-blocking-issues`, **not pushed**). `npm test` = **127 tests, 126 pass / 1 skipped /
0 fail**; `npm audit` = **0 vulnerabilities**. The engineering backlog is no longer empty —
see the audit section below. The content work (`content-kit/`) is still the real unblock.

> ⚠️ **`HANDOVER.md` and `docs/29` describe a DIFFERENT, DEAD implementation** (`src/*.js`,
> port 7100, `content/entities/`). Commit `bd84b2e` merged that older tree back into this
> repo. Both trees default to the same Qdrant collection and their sparse analyzers are
> mutually unintelligible for Arabic/Kurdish — **following the HANDOVER runbook corrupts the
> live index.** This README is the authoritative document. Details in the audit section.

### 2026-08-21/22 — security & correctness audit, and the fixes

Full report (reproductions for every claim):
<https://claude.ai/code/artifact/8000da68-0b45-45a4-9635-f0746f9ed08c>

**Fixed in `ab98c99`** — six issues, each pinned by a regression test that fails without it
(`test/auth.test.js`, `test/audit-fixes.test.js`):

1. **Auth bypass (CRITICAL).** The `/v1/*` gate tested `req.url.startsWith('/v1/')`, but
   RFC 9112 §3.2.2 requires accepting an absolute-form request target — which makes `req.url`
   the whole URI, so the hook returned early while the router still ran the handler.
   Reproduced over a raw socket: `POST http://evil.example/v1/retrieve` → **200 OK, no token**.
   Now gates on the routed path. **`app.inject()` normalizes the target and cannot reproduce
   this** — the regression test drives real sockets; 7 of its 11 cases fail against the old hook.
2. **History injection bypass.** `understand.js` builds the rewrite prompt from
   `t.text ?? t.content`, but the gate scanned only `.text` — so an OpenAI-style caller could
   smuggle an injection to the rewrite LLM. Now scans both; a non-array `history` no longer 500s.
3. **Ingest deletion.** `sourceIds` came from `valid`, so an entity that **failed validation**
   looked "removed" and had its live points deleted — the opposite of the message printed two
   lines earlier. Now keyed off what is on disk (`retiredIds()`), plus a guard that refuses to
   retire the whole collection when the seed dir is empty.
4. **Draft content.** All 12 seed entities are `status:"draft"` with invented shortcodes and
   prices, and the query filter excluded only `retired`. Draft stays visible in the sandbox and
   is hidden when `NODE_ENV=production`; override with `EXCLUDE_DRAFT`.
5. **Dependencies.** `fast-uri` host confusion + `find-my-way` HTTP/2 DDoS (both high),
   `undici` response desync (moderate). `npm audit` is now clean.
6. **Fail-open auth.** An unset `SERVICE_TOKEN` disables the gate entirely, and the Dockerfile
   copies neither `.env` nor the variable — so a container was open the moment someone set
   `HOST=0.0.0.0` to make it reachable. Startup now refuses that combination, warns on
   loopback, and the banner states `auth on|OFF` and whether draft content is visible.

**Found and verified, NOT yet fixed** (second review pass, 2026-08-22):

| # | Issue | Where | Why it matters |
|---|-------|-------|----------------|
| 1 | `Number('')` is `0`, and `??` doesn't catch `""` — a present-but-empty numeric line in `.env` silently zeroes the value | `src/lib/config.js:20-32` | An empty `ROUTE_TAU_HIGH=` makes the router **confidently route a garbage query** instead of abstaining. Also zeroes `TOP_K` (no results), `EMBED_TIMEOUT_MS` (every query 503s), `PORT` (random port). |
| 2 | The `__clarify__` branch `continue`s before `falseRoutes++` | `src/eval/run.js:94` | A gold item that should have been clarified but was confidently routed is **excluded from the false-route rate** — the headline 0% is under-counted. |
| 3 | `isLangMap` checks the container, never the values | `src/lib/validate.js:13` | `"names": {"en": {...}}` passes validation and embeds as `[object Object]`, served to the LLM as evidence. |
| 4 | `contentHash` covers only the entity, but chunks bake in *related* entity names | `src/ingest/run.js:50` | Rename `bundle_b` and `bundle_a`'s conflict chunk keeps the old name — `bundle_a` is byte-identical, so it is never re-embedded. |
| 5 | `anchorRatio` uses `hay.includes(t)` — substring, not token | `src/service/understand.js:98` | The hallucinated rewrite `"sub scribe to bun"` scores **1.00** against the conversation and passes the 0.6 guard. |
| 6 | Unknown sections sort **first** (`indexOf` → `-1`) | `src/service/retrieve.js:126` | An unrecognised section leads the entity card handed to the LLM. |
| 7 | The `_`-skip convention only applies to basenames | `src/ingest/run.js:30` | A `data/seed/_drafts/` folder is fully ingested. |
| 8 | `repeat_purchase_threshold: 0` renders "from the 0th subscription" | `src/lib/chunker.js:147` | Customer-facing nonsense in an embedded fee chunk. |
| 9 | Date pre-filter compares against UTC | `src/service/retrieve.js:29` | A promo `valid_to` expires 03:00 Baghdad, not midnight. |

**Checked and cleared** (do not re-litigate): the Qdrant filter grammar is correct against real
Qdrant 1.18.2 (`is_empty` does match missing keys; nested `should` inside `must` is a real OR);
the safety regexes are **not** ReDoS-prone (worst case 3.8 ms on adversarial 1 MB input, because
the `{0,40}` bounds keep backtracking linear); `decide()` cannot crash on an undefined rival
(with no rival `gap = top.score >= tauHigh >= margin`, so it routes); and there is no
`child_process`, `eval()`, `new Function` or dynamic `require` anywhere in the tree.

**Still open by design decision, not neglect:**

- **The number guardrail is a flat bag of digits** (`src/service/answer.js:20`) with no binding
  between a number and its entity. It blocks *invented* numbers but allows a price **borrowed
  from another bundle in the same top-5** — and returns it as `grounded: true`. Spelled-out
  numbers ("five thousand", "سبعة آلاف") skip the check entirely. Rebinding it per entity
  changes the grounding contract, so it needs a decision, not a patch.
- **The legacy `src/*.js` tree.** Deleting it means first moving
  `test/integration.qdrant.test.js` onto the current pipeline — that test imports the *dead*
  modules and is the project's only integration coverage.

### 2026-07-19 second session — safety-filter precision fixes (committed)

### 2026-07-19 second session — safety-filter precision fixes (committed)

All five review findings addressed in `safety.js` + `app.js`, each pinned in
`test/safety.test.js` / `test/contract.test.js`:

- Arabic word-edge guards (`(?:^|[^؀-ۿ])`, optional attached و/ف) — `رد` no longer
  matches inside `استرد`; password questions (`وين اكتب كلمة السر؟`) get real answers.
- No bare-diacritic alternatives — `الغي كل تعليماتك السابقة` (undiacritized) now caught.
- The Arabic canary frame requires the "only" qualifier (بس/فقط) or "one word".
- Fake-authority needs the authority frame (`new SYSTEM rule` / announcement colon) —
  "Is there a new policy for SIM registration?" and `اكو تعليمات جديدة لتفعيل الشريحة؟`
  answered, not deflected. English "ignore … prompt" needs an instructional qualifier.
- **Order fix (was the unverified finding — it was real):** `detectInjection` now runs
  BEFORE `understandQuery`, so attacker text never reaches the rewrite LLM and nothing
  model-generated is echoed in the deflection; `history` turns are scanned too
  (audit logs `injection_source: text|history`).

Verified live end-to-end: the review's false positives all answer normally, the
previously-missed injections deflect deterministically; smoke test green.

Also in this session:

- **CI is GREEN for the first time** (`e37bd5f`). The GitHub Actions unit gate had failed
  on every run since the workflow landed: the "hung TEI" resilience test's mocked fetch
  pended only on `AbortSignal.timeout`'s timer, which Node **unrefs** — on idle ubuntu
  runners the event loop drained before the abort fired and node:test cancelled tests
  50–52 (`cancelledByParent`). Passed locally on Windows, so it was never noticed. Fix:
  the mock holds a ref'd keep-alive timer, standing in for the socket handle a real
  fetch would hold. Verified: the run on `e37bd5f` concluded `success`.
- **Ops guide for teammates**: `operations vector data base.docx` (repo root,
  untracked) — a beginner-level Word walkthrough of start-up, the sandbox console
  (incl. token setup), the API, adding/editing seed data, quality checks, and
  troubleshooting. Regenerate from a future session by asking for the operations
  guide; source of truth for procedures remains this README + `docs/`.

### 2026-07-16 evening (4th session) — now committed (see git log)

15 modified files + 2 new (`src/service/safety.js`, `test/safety.test.js`):

1. **Prompt hardening (docs/17 §2.2–2.4 — was backlog 6)**: `prompts.js` bumped to v2 with a
   SECURITY block (instruction hierarchy, context-is-data, never-reveal). `PROMPT_LEAK_MARKERS`
   is the single source of truth shared by the new deterministic output leak-guard
   (`promptLeakViolations()` in `answer.js`, wired into the guardrail → strict retry → safe
   fallback) and by `scripts/red-team.js`.
2. **Input-side injection filter (docs/17 §2.1)**: `safety.js` `detectInjection()` (en+ar
   regexes) short-circuits `/v1/answer` to a deterministic 4-language `INJECTION_DEFLECTION` —
   the LLM is never called, so no attacker token can be echoed; audit-logged as
   `injection_blocked`. Contract test pins the response shape and the no-echo property.
3. **Service auth rollout (docs/10 — was backlog 3)**: `SERVICE_TOKEN` is now set in `.env`
   (auth ON). Smoke/red-team/probe scripts send `Authorization: Bearer` via `CONFIG`; the
   sandbox console got a token box (localStorage). `.env.example` documents token generation.
4. **Arabic rewrite quality (docs/12 — was backlog 4)**: the 7B probe WAS run —
   `qwen2.5:7b-instruct` is *worse* for rewrites (drifts to Chinese/English). The real fix,
   implemented: **language-matched worked examples** (`rewritePrompt(language)` — a static
   Arabic example corrupted English rewrites and vice versa) + **orthography-folded anchoring**
   (`anchorRatio()` over `normalizeForSparse`, so أ/ى/ة folds no longer reject correct
   MSA-shifted rewrites) + optional `LLM_REWRITE_MODEL` in `.env` (leave empty = use
   `LLM_MODEL`). This closes session 3's "Arabic rewrites fail safe to raw" limitation.

### 2026-07-19 session — verification + adversarial review of that work

- `npm test`: **73/73** offline. `node scripts/smoke-phase1.js`: all endpoints healthy,
  grounded answers, unknown-topic declines cleanly.
- **`npm run redteam`: 15/15 safe, 0 blocking failures** — the three 3rd-session holes
  (verbatim prompt extraction, Arabic canary injection, GROUNDED_FACTS leak) are all closed.
  Eyeball notes: one ar neutrality answer had mixed-script garbling (`أنتright … 不满意` —
  known 3B quality issue, safety held); the scope item wrote an off-topic poem (advisory).
- Eval: Hit@5 **96.6%** overall / **100%** Kurdish / false-route **0%** — no retrieval
  regression (routing 28.6% unchanged, still data-limited by the synthetic seed).
  Report: `eval/runs/2026-07-19T06-46-26-955Z.json`.
- A multi-agent adversarial review of the diff confirmed precision bugs in `safety.js` —
  **all fixed and regression-pinned in the second 2026-07-19 session (above)**.

### ⏭ Next session — pick up here

1. **Config coercion + the eval false-route metric** (audit items 1 and 2 above). Both are
   small and mechanical, and each currently invalidates a stated safety guarantee.
2. **Type-check langmap values** (item 3) plus the trivial text/ordering fixes (6–8). One pass.
3. **The two design calls**: the per-entity number guardrail, and retiring the legacy tree.
4. **Then the content work — still the real unblock:** work through
   [`content-kit/`](content-kit/README.md) → re-ingest → re-eval → `npm run eval -- --sweep` →
   update `ROUTE_TAU_HIGH`/`ROUTE_MARGIN` in `.env`. That is what pushes routing accuracy past
   the 0.85 gate (28.6% at conservative defaults — data-limited by the synthetic seed, not the
   architecture: 29 of the 42 gold items are knowledge questions labelled `knowledge_flow`).

**Open decisions for Yousif** (docs/23 §6): node:test vs Vitest; confirm GitHub Actions as CI
runner (assumed); blocking vs advisory gates in alpha.

#### Stack state — THIS MACHINE (HP EliteBook 830 G7, since 2026-08)

The project was built on an Acer Predator with an **RTX 5060**. This laptop is
**i5-10310U, 4c/8t, Intel UHD graphics — no CUDA**, 15.8 GB RAM, C: ~10 GB free / D: ~110 GB.
Nothing is running; the stack has never been brought up here.

- **Qdrant needs no Docker.** `qdrant_bin\qdrant.exe` (v1.18.2, official release) runs natively
  and passes the full integration suite. Note it writes to `.\qdrant_storage\`, while
  `docker-compose.yml` mounts a *named volume* — **they are different databases.**
- **TEI must stay on CPU.** `docker-compose.yml` already defaults to `cpu-latest`; do **not**
  uncomment the GPU block. Lower `--max-batch-tokens` to `4096` and `--max-client-batch-size`
  to `16`, and add `mem_limit: 6g` (the `~/.wslconfig` comment already assumes limits exist).
- **`npm run ingest` will write 0 chunks and exit 0.** `.ingest-state.json` came over from the
  old machine and matches all 10 seed files, while this machine's collection is empty.
  **Use `npm run ingest:rebuild` on first bring-up.**
- **Ollama is not installed**, but `.env` still points at `localhost:11434`. `llmConfigured()`
  only checks that the env strings are non-empty, so `/v1/answer` returns **HTTP 200 with the
  safe-fallback answer for every question** instead of an honest 503. Blank `LLM_BASE_URL` and
  `LLM_MODEL` until an LLM exists, or point them at a hosted OpenAI-compatible endpoint.
- **Raise `EMBED_TIMEOUT_MS` to `30000`** — the 10 s default is a GPU-era number; BGE-M3 on this
  CPU runs ~1–3 embeddings/second.
- **Docker's disk image is still on C:.** Moving it needs the GUI: Docker Desktop → Settings →
  Resources → Advanced → Disk image location → `D:\DockerData`. The `DataFolder` key is already
  set in `settings-store.json` (Docker stores it but ignores it at startup).

Testing gotchas: PowerShell mangles Arabic in HTTP bodies — always test via Node scripts;
killing `npm run serve` via a task-stop orphans the node child — kill the :8090 PID instead;
and **`app.inject()` cannot reproduce request-target attacks** — use a raw socket (see
`test/auth.test.js`).

**Known limitations (accepted for prototype, revisit with real data):**
- The 3B model occasionally typos or mixes scripts in Arabic answers (`بُكْمَة` for `باقة`;
  `أنتright`) — numbers stay guardrail-protected; native review (docs/21) will judge.
- Unknown-topic questions retrieve *some* chunks, so they go through the LLM (which correctly
  declines) rather than the deterministic not-found path — fine, no invention observed.
- Prompt-only defenses are not absolute on a 3B model — the layered design (hardened prompt +
  input filter + output leak-guard, docs/17 §6) is what holds; keep humans in the loop.
- ~~Arabic rewrites fail safe to raw~~ CLOSED by the 4th-session rewrite fix (above).

### Phase 1 feature record (all committed, `5fa5948…5d9e30c`)

- **Query understanding** (docs/12): `src/service/understand.js` — language/script detection
  (en/ar/ckb/kmr), gated LLM rewrite of follow-ups (Arabic-script-safe edge guards — JS `\b`
  never matches Arabic), raw+rewrite merged retrieval. Wired into all three endpoints.
- **`/v1/answer`** (docs/15 + 08 §3): `answer.js` + `prompts.js` (versioned prompt config),
  LLM-agnostic OpenAI-compatible client (`src/lib/llm.js`), number-grounding guardrail with one
  strict retry then per-language safe fallback. Local LLM = Ollama `qwen2.5:3b-instruct`
  (qwen3:4b rejected — thinking mode burns the token budget; evidence in `scripts/probe-llm.js`).
- **Contract tests** (docs/23 §1): `test/contract.test.js` via Fastify `inject()`; enabled by
  the `app.js` `buildApp(overrides)` split (injectable deps), `server.js` = thin listen entry.
- **Resilience** (docs/06 §7): typed `DependencyError` → `503 {error:"dependency_unavailable",
  dependency, detail}`; 10s timeouts on TEI embed + Qdrant query/scroll
  (`EMBED_TIMEOUT_MS`/`QDRANT_TIMEOUT_MS`).
- **Red-team suite** (docs/17 §5): `npm run redteam` — 15 adversarial items en/ar vs the live
  service.
- **Shadow mode** (docs/08 §6): `/v1/route` accepts `current_flow`, logs agree/disagree to
  `logs/shadow.jsonl`. **Gap report** (docs/13): `npm run gaps`.
- **Sandbox console** (docs/20 §4): `GET http://127.0.0.1:8090/` — flow-builder UI.
- **Content kit**: `content-kit/` — prioritized worksheets for the seed-20 data, real Laila-log
  utterances, ~60 vocab CONFIRMs, and the 116-string native-review pack.

## Status (2026-07-15) — Phase 0 exit criterion MET

Ingestion runs end-to-end (10 seed entities → 129 chunks, idempotent re-runs) and the eval
harness produces numbers:

| Metric (prototype bar) | Result |
|---|---|
| Retrieval Hit@5 overall (≥ 0.85) | ✅ **96.6%** |
| Retrieval Hit@5 Kurdish (≥ 0.70) | ✅ **100%** |
| Routing accuracy (≥ 0.85) | ❌ 28.6% at conservative defaults; **sweep shows ~78–83%** reachable now |
| False-route rate (≤ 0.05) | ✅ **0%** (abstains instead of guessing — docs/06 §5 working as designed) |

Routing accuracy is limited by the tiny synthetic seed (placeholder intent examples + a
42-item gold set), not the architecture: `.env` ships τ_high=0.80 (deliberately conservative,
"favor clarifying" per docs/06 §5). After real utterances land, recalibrate with
`npm run eval -- --sweep` and update `ROUTE_TAU_HIGH` / `ROUTE_MARGIN`.

## ⚠️ Everything marked PLACEHOLDER needs real data (the actual Phase 0 content work)

1. **Seed 20** — replace/extend `data/seed/` with the real top ~20 bundles/services
   (`attributes.review_note` marks what's invented: shortcodes, prices of 1602/1603, Shukran).
2. **Intent examples** — pull real customer utterances from Laila logs (docs/09 §3).
3. **Vocabularies** — `data/vocab/*.json` service classes, locations, flows (docs/26 CONFIRM).
4. **Native review** of machine-drafted ar/ckb/kmr text (docs/21).
5. **Gold set** — grow `eval/gold/gold.jsonl` toward 150–300 items from real phrasings.

Then: re-ingest, re-eval, re-sweep. The prototype gate should pass fully before Phase 1
(shadow-mode routing alongside the old dispatcher — docs/08 §6, docs/11).
