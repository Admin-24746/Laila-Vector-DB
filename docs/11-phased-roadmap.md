# 11 — Phased Roadmap

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> The path from "docs done" to "serving all of Iraq," in stages that each deliver value and de-risk the
> next. Each phase has an **exit criterion** — don't advance until it's met.

---

## Phase 0 — Foundations (prep)
**Goal:** everything needed to build, in place.
- Stand up the 4 components locally (Qdrant, TEI/BGE-M3, retrieval-svc, optional cache) via docker-compose.
- Author the **seed 20** bundles/services + core **intents** (doc 07 §9).
- Build the **gold test set**, incl. the **Kurdish slice** (doc 09).
- Verify BGE-M3 license + sample Kurdish retrieval behaviour (doc 04 open item).

**Exit:** ingestion runs end-to-end on the seed set; eval harness produces numbers.

## Phase 1 — Prototype (prove retrieval, low risk)
**Goal:** prove the system returns the right facts — aimed at **flow-builders first** (doc 00 §7).
- Knowledge retrieval (`/retrieve`) live for the internal tool / flow-building.
- Query understanding: normalization + gated rewrite (doc 12).
- **Shadow-mode routing** (doc 08 §6): `/route` runs alongside the old dispatcher, logging disagreements — changes nothing yet.
- Run eval (doc 09); start the feedback gap-list (doc 13).

**Exit:** retrieval meets prototype bars (Hit@5 ≥ 0.85; Kurdish measured); shadow routing data collected.

## Phase 2 — Production hardening (earn customer traffic)
**Goal:** safe for live customer use, one capability at a time.
- HA infra: replicas, cache (Redis), Qdrant cluster, monitoring/alerts (doc 10).
- **Answer grounding guardrail** enforced (doc 08 §3).
- **Active routing** turned on for a few well-tested intents (e.g. loan), expanded as eval proves each safe.
- Eval in CI as a **regression gate** (doc 09 §6).
- Automated ingestion schedules + reconciliation (doc 07).

**Exit:** production bars met (Hit@5 ≥ 0.95, routing ≥ 0.95, false-route ≤ 0.01, grounded ≥ 0.98) on the
covered scope; rollback tested.

## Phase 3 — Scale & continuous improvement (ongoing)
**Goal:** broaden coverage and keep getting more correct.
- Expand from seed 20 → full bundle/service catalogue, driven by the **content-gap list** (doc 13).
- Add intents until the dispatcher is fully vector-routed.
- **Fine-tune BGE-M3** on accumulated Kurdish miss-pairs if eval warrants (doc 04 layer 5).
- Optional: add a **reranker** if precision plateaus (doc 06 D6 revisit).
- New entity types (quality, process…) as needed — schema already supports it (doc 02).
- **Voice / IVR / call-center channel (future):** add a speech-to-text front-end; plan for ASR
  transcription errors (esp. Kurdish) corrupting queries — extra normalization + fuzzy/sparse matching,
  and an ASR-specific slice in the eval set (doc 09). Not in v1 (v1 = app/web/WhatsApp text).

**Exit:** continuous — tracked by trend dashboards (doc 10/13).

---

## Critical-path dependencies
```
 Phase 0 (data + eval) ──► everything. Without the seed data & gold set, nothing can be measured.
 Shadow routing (P1) ──► must precede active routing (P2). Never route live on unproven thresholds.
 Eval bars (P1/P2) ──► gate every promotion. No bar met = no advance.
```

## Top risks & mitigations
| Risk | Mitigation |
|------|-----------|
| **Kurdish retrieval underperforms** | per-language chunks + sparse + measure early (P0/P1); fine-tune (P3) |
| **Bad/missing data** poisons answers | validation gate + authoring review (doc 07); guardrail (doc 08); feedback loop (doc 13) |
| **Misrouting in production** | shadow-first; abstain-on-low-confidence; per-intent rollout |
| **Prototype→prod ambition gap** (doc 00 §7) | name it early; secure infra + buy-in before Phase 2 |
| **Maintainer bandwidth** (mostly one person) | open-source self-contained stack; automate ingestion/eval |

## Definition of done (project-level)
The system is "done enough to trust" when: the covered scope meets production eval bars, routing runs
active for the high-value intents with near-zero false-routes, updates are automated, and the feedback
loop is demonstrably improving the numbers over time.
