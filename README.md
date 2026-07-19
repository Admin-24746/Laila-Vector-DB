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

## Where we left off (updated 2026-07-19, second session)

**Phase 0 + Phase 1 done, verified, COMMITTED and pushed. All four engineering-backlog
items are in** (prompt hardening, injection filter, service auth, Arabic rewrite fix) —
landed as three topical commits after `5d9e30c`, plus this README. The safety-filter
precision bugs found by the 2026-07-19 adversarial review are **fixed, regression-pinned
and live-verified**. `npm test` = **77 offline tests**, all green; `npm run redteam` =
15/15 safe. **The engineering backlog is now empty — what remains is the content work
(`content-kit/`).**

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

**The content work (the real unblock):** work through
[`content-kit/`](content-kit/README.md) → re-ingest → re-eval →
`npm run eval -- --sweep` → update `ROUTE_TAU_HIGH`/`ROUTE_MARGIN` in `.env`. That's what
pushes routing accuracy past the 0.85 gate (currently 28.6% at conservative defaults —
data-limited by the synthetic seed, not the architecture).

**Open decisions for Yousif** (docs/23 §6): node:test vs Vitest; confirm GitHub Actions as CI
runner (assumed); blocking vs advisory gates in alpha.

Stack state: left **RUNNING** on 2026-07-19 (Qdrant+TEI containers, Ollama, service on :8090).
Cold-start ritual if it's down: `docker compose up -d` → check Ollama `:11434` (not
auto-started — `Start-Process -WindowStyle Hidden ollama -ArgumentList "serve"`) →
`npm run serve` → sanity `npm test` (offline) + `node scripts/smoke-phase1.js` (full stack).
Testing gotchas: PowerShell mangles Arabic in HTTP bodies — always test via Node scripts;
killing `npm run serve` via a task-stop orphans the node child — kill the :8090 PID instead.

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
