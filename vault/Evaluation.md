---
title: Evaluation
tags: [eval, laila]
updated: 2026-09-12
---

# Evaluation

```bash
npm run eval           # the gate
npm run eval:sweep     # threshold calibration
npm run gaps           # what the corpus could not answer
```

Harness: `src/eval/run.js` (docs/09). Gold set: `eval/gold/gold.jsonl`. Reports are saved to
`eval/runs/` (gitignored).

## The prototype gate — current numbers

| Metric | Gate | 2026-09-12 | |
|---|---|---|---|
| Hit@5 overall | ≥ 0.85 | **96.6%** | ✅ |
| Hit@5 Kurdish | ≥ 0.70 | **100%** | ✅ |
| Routing accuracy | ≥ 0.85 | **28.6%** | ❌ |
| False-route rate | ≤ 0.05 | **0.0%** | ✅ |

> [!important] The one number that matters about these numbers
> Retrieval held at 96.6% / 100% while the corpus grew **7×** — from 10 entities / 129 chunks
> to 73 / 402. That is the real result of the content import: more real content did not dilute
> retrieval.
>
> Routing did not move **and was never going to**. Routing scores against intent `examples`,
> not bundle cards. It will move when real utterances land, and not before. See
> [[Content pipelines]].

## Why routing is 28.6%

Not architecture — data. The intent examples are invented placeholders, and **29 of the 42
gold items are knowledge questions labelled `knowledge_flow`**, so the gold set itself is
lopsided. Typical failures are all the same shape:

```
✗ "can you lend me some balance please" expected loan_flow got CLARIFY
    — top intent_loan::example_2::en (0.766) below τ_high 0.8
```

The right intent wins; it just does not win *confidently enough* to clear the threshold. That
is the system behaving conservatively with weak training data — which is why the false-route
rate is 0.0%.

## Thresholds: deliberately NOT calibrated

The sweep tops out at **78.6%** under the false-route gate (τ_high 0.50 / margin 0.05).

> [!warning] Do not commit that 0.50
> The sweep measures against the **synthetic** seed, so committing τ_high = 0.50 would bake a
> placeholder-derived number into `.env` and make future measurements meaningless.
> Recalibrate *after* real utterances land. That ordering is the whole point of the sweep.

## What the harness measures

- **Hit@k / MRR**, overall and **per language** — the Kurdish slice is broken out because it is the one most likely to silently regress.
- **Routing confusion** — which flow was expected vs. taken, including `clarify` and `fallback`.
- **False-route rate** — confidently routing something that should have been clarified. The most dangerous failure, because the customer never sees a question.
- **Threshold sweep** — accuracy across τ values under the false-route constraint.

## The test suite

`npm test` — **179 tests, all passing** (2026-09-12). Offline; no stack needed except the
Qdrant integration test.

| File | Pins |
|---|---|
| `febra.test.js` | The FEBRA import's refusals ([[Content pipelines]]) |
| `logmine.test.js` | Log mining, PII redaction, train/gold separation |
| `audit-fixes.test.js`, `audit-round2.test.js` | Every audit finding ([[Safety and security]]) |
| `auth.test.js` | The auth gate, **over real sockets** |
| `resilience.test.js` | All 16 dependency-failure contracts |
| `safety.test.js`, `contract.test.js` | Injection detection and the response shape |
| `integration.qdrant.test.js` | The real ingest CLI into a throwaway collection |
| `lib-primitives.test.js` | Chunker, normaliser, follow-up gate, guardrail |

> [!info] A whole file failing with no failing assertion is the known entropy race
> Re-run before investigating. See [[Troubleshooting]].

Related: [[Content pipelines]] · [[Project state]] · [[Architecture]]
