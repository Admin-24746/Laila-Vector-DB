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
| `POST /v1/answer` | retrieve + LLM compose (docs/15 prompt) + number-grounding guardrail (docs/08 §3) — see "Where we left off" |
| `GET /healthz` | stack health + point count |

## Layout

```
docs/            the design contract (00–28)
data/seed/       entity JSONs (one file per entity; _TEMPLATE.* to author new ones)
data/vocab/      controlled vocabularies (docs/26) — placeholders to CONFIRM
src/lib/         chunker (docs/03), embedder (docs/04), qdrant (docs/05), validate (docs/25)…
src/ingest/      pipeline CLI (docs/07): incremental, hash-based, idempotent
src/service/     retrieve() engine (docs/06) + REST server (docs/08)
src/eval/        eval harness (docs/09): Hit@k/MRR per language, routing confusion, τ sweep
eval/gold/       gold test set (JSONL) — starter items incl. Kurdish slice
eval/runs/       saved eval reports (gitignored)
test/            unit suite (docs/23): chunker, normalizer, follow-up gate, guardrail, validation
logs/            service audit log JSONL (gitignored)
```

## Where we left off (session ended 2026-07-16)

**Phase 0 = done and verified. Phase 1 = done and smoke-verified end to end** (the /v1/answer
open issue is CLOSED). First git commit made this session — `git log` is now part of the record.

### 2026-07-16 session: model swap verified + rewrite path fixed

1. **`qwen2.5:3b-instruct` pulled and verified** — `/v1/answer` now returns grounded answers in
   ~0.6–1.3 s (was 36–52 s fallbacks on qwen3:4b, see probe notes below). All smoke answers
   `grounded:true` with correct numbers; unknown-topic (Starlink) politely declines without
   inventing facts.
2. **docs/12 rewrite path fixed** (it was returning null / drifting into Chinese):
   - `understand.js` deictic/elliptical gate was dead for ar/ckb/kmr: JS `\b` only understands
     ASCII, so `/\bهذا\b/` and `\b` after `ê î û ç ş` can never match. Replaced with explicit
     edge guards; unit-checked in all four languages.
   - Rewrite prompt now carries a worked example (probed against qwen2.5:3b — an example is what
     makes it resolve references instead of echoing; an ARABIC example made it copy the example's
     intent, so English example only. Probe evidence in the `REWRITE_SYSTEM` comment).
   - New fail-safe guards on the rewrite output (reject → fall back to raw query, docs/12 §7):
     CJK/cross-script drift + **vocabulary anchoring** (≥60 % of rewrite tokens must occur in
     the conversation — rejects hallucinated/garbled rewrites).
   - Verified: en follow-up → `"and how do I cancel the combo bundle?"`, unsubscribe chunk
     jumps to rank 1. ckb → near-raw rewrite (anchored, harmless).
3. **Unit suite + CI added (docs/23)**: `npm test` — 31 offline tests over the pure engine
   (chunker, normalizer, language detection, follow-up gate incl. the `\b` regression net,
   number-grounding guardrail, validation gate) with Node's built-in runner (zero new deps;
   migrate to Vitest only if docs/23 §6 confirms it). `.github/workflows/test.yml` runs it on
   every push/PR once the repo is on GitHub. Eval re-run after the rewrite changes: numbers
   identical to the 2026-07-15 baseline (no retrieval regression).
4. **GitHub remote configured, push pending auth**: `origin` →
   `https://github.com/Admin-24746/Laila-Vector-DB.git` (repo exists, empty). First push needs
   Yousif to sign in once: `git push -u origin master` → complete the credential-manager popup.

**Known limitations (accepted for prototype, revisit with real data):**
- **Arabic rewrites fail safe to raw**: qwen2.5:3b garbles Iraqi Arabic rewrites
  (`وشلون الغيها؟` → `وشلا غيبة`), so the anchoring guard rejects them → cross-turn reference
  resolution in Arabic doesn't happen (smoke case: answer cites weekly-net 1603 instead of combo).
  Candidate fixes later: larger model (qwen2.5:7b-instruct) for the rewrite call only, or Druid
  passing explicit entity context.
- The 3B model occasionally typos Arabic words in answers (`بُكْمَة` for `باقة`) — numbers stay
  guardrail-protected; native review (docs/21) will judge acceptability.
- Unknown-topic questions retrieve *some* chunks, so they go through the LLM (which correctly
  declines) rather than the deterministic not-found path — fine, no invention observed.

### ⏭ Next session — pick up here

**If Yousif's content landed** (seed-20 / utterances / vocab CONFIRMs — see the placeholder
section at the bottom): re-ingest → re-eval → `npm run eval -- --sweep` → update
`ROUTE_TAU_HIGH`/`ROUTE_MARGIN` in `.env`. That's the step that should push routing accuracy
past the 0.85 gate.

**Otherwise, engineering backlog in priority order** (none needs content):
1. **Contract tests** (docs/23 §1): pin the docs/08 request/response shapes of
   `/v1/retrieve` `/v1/route` `/v1/answer` so Druid integration has a stable target.
   ← recommended next
2. **Resilience** (docs/06 §7): test/implement graceful endpoint behavior with Qdrant, TEI,
   or Ollama down (healthz reports it; endpoint failure paths are unverified).
3. **Service auth** (docs/10): at least an API key before the service is reachable by
   anyone but localhost.
4. **Arabic rewrite quality**: probe `qwen2.5:7b-instruct` for the rewrite call only
   (would lift the known ar-rewrite fail-safe limitation above).
5. **Safety red-team set** (docs/17): small adversarial suite runnable like the smoke test.

**Open decisions for Yousif** (docs/23 §6): node:test vs Vitest; confirm GitHub Actions as
CI runner (assumed); blocking vs advisory gates in alpha.
**Pending from Yousif**: one-time GitHub sign-in (`git push -u origin master` → credential
popup) — unblocks teammates + CI; then real data (bottom section).

Stack state at session end: containers + service left RUNNING (`docker compose down` + kill
:8090 to stop). To restart cold: `docker compose up -d` → check Ollama (`:11434`; it isn't
auto-started — `Start-Process -WindowStyle Hidden ollama -ArgumentList "serve"`) →
`npm run serve` → sanity: `npm test` (offline) + `node scripts/smoke-phase1.js` (full stack).
Testing gotcha: PowerShell mangles Arabic in HTTP bodies — always test via Node scripts.

Phase 1 additions (all code in place, service wiring done):
- **Query understanding** (docs/12): `src/service/understand.js` — language/script detection (en/ar/ckb/kmr),
  gated LLM rewrite of follow-ups, raw+rewrite merged retrieval. Wired into all three endpoints.
- **`/v1/answer`** (docs/15 + 08 §3): `src/service/answer.js` + `prompts.js` (versioned prompt config) —
  LLM-agnostic OpenAI-compatible client (`src/lib/llm.js`), number-grounding guardrail with one strict
  retry then per-language safe fallback. Local LLM = Ollama `qwen2.5:3b-instruct` (see `.env`;
  qwen3:4b rejected — thinking mode burns the token budget, evidence in `scripts/probe-llm.js`).
- **Shadow mode** (docs/08 §6): `/v1/route` accepts `current_flow`, logs agree/disagree to `logs/shadow.jsonl`.
- **Gap report** (docs/13): `npm run gaps` — zero-result retrievals, abstain clusters, ungrounded answers,
  shadow disagreements.
- **Sandbox console** (docs/20 §4): `GET http://127.0.0.1:8090/` — flow-builder UI (retrieve/route/answer).

Verified working: healthz (all green), console serves, Arabic/Kurdish retrieval (fees question → rank 1,
~85 ms), shadow logging, guardrail correctly serves safe fallback instead of bad answers, deterministic
not-found path.

**✅ RESOLVED (was the open issue):** `/v1/answer` fallbacks + null rewrites were qwen3:4b's
thinking mode burning the token budget → truncation → guardrail block. Fixed by the swap to
`qwen2.5:3b-instruct` + the rewrite-path fixes above; smoke-verified 2026-07-16.

To resume: see **"⏭ Next session — pick up here"** above (restart commands, prioritized
backlog, pending decisions).

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
