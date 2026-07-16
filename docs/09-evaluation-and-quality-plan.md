# 09 — Evaluation & Quality Plan

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> "Annoying but fine now; **must be correct later**" only works if *correct* is **measured**. This doc
> defines how we prove the system works, catch regressions, and know when Kurdish/routing are good
> enough. You cannot improve what you cannot measure — this is that instrument.

---

## 1. Three things we evaluate (they fail differently)

| Layer | Question | If it fails |
|-------|----------|-------------|
| **A. Retrieval** | Did the right chunk come back for the query? | LLM has nothing good to answer from |
| **B. Routing** | Did the dispatcher pick the right flow? | "loan → BTL" misroute (today's bug) |
| **C. Answer** | Was the final reply correct, grounded, right language? | Customer gets a wrong/hallucinated answer |

A perfect LLM can't fix bad retrieval (A); perfect retrieval can't fix bad routing (B). Measure each.

## 2. Metrics

### A. Retrieval quality
- **Hit@k** — is the correct chunk in the top *k*? (primary, intuitive). Target k = 3 and 5.
- **Recall@k** — fraction of all relevant chunks found.
- **MRR** — how high the first correct chunk ranks (rewards putting it at #1).
- Tracked **per language** (so Kurdish can't hide behind English averages).

### B. Routing quality
- **Routing accuracy** — % of utterances sent to the correct flow.
- **Confusion matrix** — *which* intents get mixed up (e.g. does "loan bundle" leak into BTL?). The
  single most useful artifact for your dispatcher problem.
- **False-route rate** — routed confidently to the **wrong** flow (worst case; minimize hard).
- **Abstain correctness** — when it abstained/clarified, *should* it have? (good abstains vs lazy ones).

### C. Answer quality (end-to-end)
- **Groundedness** — every claim (esp. numbers/prices) traceable to retrieved text. (Ties to doc-08 guardrail.)
- **Correctness** — matches the gold answer.
- **Language correctness** — answered in the user's language/script.

## 3. The gold test set (the foundation of all of this)

A labeled set of real questions with known-correct answers. Without it, "correct" is an opinion.

**Structure (per item):**
```jsonc
{ "query": "extra fee if I get Combo 3 times this month?",
  "language": "en",
  "expected_chunk": "bundle_combo::fees_edgecases::en",   // for retrieval (A)
  "expected_flow":  "knowledge_flow",                       // for routing (B)
  "gold_answer":    "Yes — a 2,500 IQD fee applies on the 3rd subscription in a month." } // for (C)
```

**How to build it (cheaply):**
1. Start from the **seed 20** bundles/services + core intents (doc 07 §9).
2. For each, write **3–5 real-phrasing questions** ×**each language** (incl. **romanized Kurdish**).
3. Pull **real customer utterances** from existing Laila logs where possible — far better than invented ones.
4. Label expected chunk / flow / answer. Aim for an initial **~150–300 items**; grow over time.

> **Kurdish set is mandatory (closes D5):** a dedicated Sorani + Kurmanji (Arabic + Latin script) slice,
> so we *measure* whether the doc-04 mitigations suffice — not assume.

## 4. Method

- **Offline eval harness** (JS script): runs the gold set through `retrieve()` and the router, computes
  metrics A & B automatically (they're exact-match against labels → no LLM needed, fast & free).
- **Answer eval (C):** **LLM-as-judge** (Gemini/ChatGPT scores groundedness/correctness vs gold) for
  scale, plus **human spot-check** on a sample and on all low-scores. LLM-judge is a helper, not the
  final word.
- **Routing-threshold calibration:** sweep `τ_high`, `τ_low`, `margin` (doc 06/D7) over the labeled set;
  pick values that maximize correct routes while keeping false-routes near zero. Data-driven, not guessed.

## 5. Acceptance bars

| Metric | Prototype gate | Production gate |
|--------|----------------|-----------------|
| Retrieval Hit@5 (overall) | ≥ 0.85 | ≥ 0.95 |
| Retrieval Hit@5 (Kurdish) | ≥ 0.70 (measure & improve) | ≥ 0.90 |
| Routing accuracy | ≥ 0.85 | ≥ 0.95 |
| False-route rate | ≤ 0.05 | ≤ 0.01 |
| Answer groundedness | ≥ 0.90 | ≥ 0.98 |

Numbers are **starting targets** — revise once we see the first real run. The point is to have a bar at all.

## 6. Regression gate (keep it correct)

- The eval harness runs **on every content/config change** (and in CI for Phase 2).
- A change that **drops any metric below its bar is rejected** — this is how correctness is *maintained*,
  not just achieved once. Adding bundle X must not silently break bundle Y's retrieval.

## 7. Tooling

- **Metrics A & B:** lightweight custom **JS harness** (exact-match, no dependencies) — fits the stack.
- **Metric C:** LLM-as-judge via the same Gemini/ChatGPT used in flows; optionally Python eval libs
  (e.g. Ragas) offline if helpful — eval is offline so language choice is free here.
- **Reporting:** a simple results table + confusion-matrix dump per run, saved for trend tracking.

## 8. Open items to confirm

- [ ] Approve the **acceptance bars** (§5) as starting targets.
- [ ] Confirm access to **real Laila logs** to source authentic test queries.
- [ ] Agree the **Kurdish slice** is a required part of the gold set.
- [ ] Decide who **owns labeling** the gold set (you / team / domain expert).
- [ ] Confirm **LLM-as-judge + human spot-check** as the Metric-C method.
