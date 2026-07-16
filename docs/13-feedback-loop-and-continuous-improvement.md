# 13 — Feedback Loop & Continuous Improvement

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> Correctness isn't a launch event; it's a loop. This doc defines how the system **tells us where it's
> failing** so content and intents improve over time — the engine behind "must be correct *later*".
> Resolves **D9**.

---

## 1. The loop

```
   serve  →  log signals  →  detect gaps  →  fix content/intents  →  re-ingest  →  re-eval  →  serve
     ▲                                                                                          │
     └──────────────────────────────────────────────────────────────────────────────────────┘
```

Every retrieval/route is an opportunity to learn. We capture cheap signals automatically and turn them
into a prioritized fix list.

## 2. Signals we capture (automatic, from every call)

| Signal | Source | Means |
|--------|--------|-------|
| **Low top score** | retrieval | weak/maybe-missing knowledge for this query |
| **No result above threshold** | retrieval | a **content gap** (we don't know this) |
| **Routing abstain / low confidence** | router | missing or weak intent examples |
| **Routing override** | shadow mode (doc 08) | router disagreed with old dispatcher → label to review |
| **Guardrail block** | doc 08 | LLM tried an unsupported number → bad/missing data |
| **Grounded = false** | doc 08 | answer couldn't be grounded → gap |
| **Repeated near-duplicate misses** | aggregation | a high-value gap (many users hit it) |

Each logged as `{query, language, top_scores, chosen, grounded, flow, timestamp}` — no PII.

## 3. Explicit feedback (optional, higher signal)

- **Flow-builder / agent thumbs-down** on an answer in the internal tool → flagged for review.
- **Customer signal** where available (e.g. "did this help?" / repeated rephrasing / escalation to human)
  → implicit negative.
- **Human-agent correction** when a call escalates → gold answer candidate.

## 4. From signals to fixes (the triage)

A periodic review (and a simple dashboard) turns signals into action:

```
  cluster the misses by topic/entity  →  rank by frequency × impact  →  for each:
     • missing knowledge      → author a new chunk / entity   (doc 07 authoring flow)
     • wrong/weak phrasing     → improve description/how_to
     • misroute               → add/adjust intent examples    (type:intent, doc 02 §2b)
     • stale fact             → fix source / re-ingest         (doc 07 reconciliation)
     • model blind spot       → add to Kurdish fine-tune set   (doc 04 layer 5)
```

> The **content gap list** is the single most valuable output here — it tells you *exactly* which of your
> "hundreds of edge cases" customers actually ask about, so you author the high-value ones first instead
> of guessing.

## 5. D9 — Feedback mechanism: **passive logging + periodic triage** ✅

- **Passive-first:** capture signals automatically with zero agent effort (always on, cheap). This alone
  surfaces most gaps.
- **Active-optional:** add thumbs-down / correction capture where humans are already in the loop.
- **Triage cadence:** weekly review in prototype; automated clustering + dashboard in Phase 2.
- **Closed loop into eval:** confirmed misses become **new gold test items** (doc 09) so the same failure
  can never silently return (regression protection).

## 6. Continuous improvement of routing thresholds & content

- Re-run threshold calibration (doc 09 §4) as the gold set grows → router self-tunes on real data.
- Track metrics over time (doc 09) → see whether each content/intent fix actually moved the number.
- **Fine-tuning trigger (doc 04 layer 5):** once enough real Kurdish miss-pairs accumulate, use them to
  fine-tune BGE-M3 — a data-driven decision, not a guess.

## 7. Privacy

- Log **queries and scores**, never customer identity or account data (Principle: no PII in this system).
- Aggregate/anonymize before any sharing. Retention window set in doc 10.

## 8. Open items to confirm

- [ ] Confirm **passive logging + weekly triage** for the prototype (vs heavier tooling now).
- [ ] Confirm which **explicit feedback** signals are available (agent thumbs, escalation events).
- [ ] Confirm **log retention** + that logs are PII-free.
- [ ] Assign an **owner** for the weekly gap-triage.
