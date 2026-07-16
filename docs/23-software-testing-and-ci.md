# 23 — Software Testing & CI

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> Doc 09 tests the **content** (is retrieval correct?). This doc tests the **code** (does the software
> work?). Both gates run in CI so neither correctness nor functionality silently regresses.

---

## 1. Test layers

| Layer | What it checks | Examples |
|-------|----------------|----------|
| **Unit** | Pure functions in isolation | chunker splits sections right; normalizer (digits/diacritics); query-rewrite gate; error-code parser; alias expansion |
| **Integration** | Components together | ingest → Qdrant upsert; `/retrieve` filter+hybrid; router thresholds; guardrail blocks an unsupported number |
| **Contract** | API shape for Druid | `/route` `/retrieve` `/answer` request/response schemas (doc 08) stay stable |
| **End-to-end** | Whole flow on staging | sample question → routed → retrieved → grounded answer (uses sandbox, doc 20) |
| **Load / performance** | Latency & throughput | p95 within ms budget; cache hit-rate; concurrency soak |
| **Resilience** | Failure handling | embedding service down / Qdrant down → graceful degradation (doc 06 §7) |
| **Safety (red-team)** | Adversarial inputs | injection/jailbreak/PII-probe/neutrality (doc 17) produce safe outcomes |

## 2. CI pipeline (every change)

```
 commit ─► lint ─► unit ─► integration ─► contract ─► CONTENT EVAL (doc 09) ─► SAFETY red-team (doc 17)
         └────────────────── any gate fails → block merge ──────────────────┘
```

- The **content eval** (doc 09) and **safety** (doc 17) sets run here as gates — a prompt/model/content
  change can't ship if it regresses correctness or safety.
- Performance/resilience run on a schedule (heavier), not every commit.

## 3. Test data & environments

- **Fixtures:** a small seed corpus + gold set (doc 09) for deterministic tests.
- **Environments:** `staging` index (doc 20) for E2E; never test against live customer traffic.
- Mocks for external calls (BSS/CDR, vision-LLM) so tests are fast and offline.

## 4. Tooling (JS-first)

- Unit/integration: **Jest/Vitest**. Load: **k6** (or similar). Contract: schema assertions.
- Coverage target: meaningful coverage on the core engine (chunking, retrieval, router, guardrail) —
  not a vanity %.

## 5. Relationship to the other test docs

- **Doc 20** = add-and-test for *content authors* (staging→promote).
- **Doc 09** = *content* correctness metrics.
- **Doc 23 (this)** = *code* correctness + the CI that runs all gates.

## 6. Open items to confirm
- [ ] Confirm **Jest/Vitest + k6** (or your preferred JS test stack).
- [ ] Confirm a **CI runner** is available (GitHub Actions / GitLab CI / local) for Phase 2.
- [ ] Agree which gates are **blocking** vs advisory in alpha.
