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

| Metric | Gate | 2026-09-12 | | vs. the old number |
|---|---|---|---|---|
| Hit@5 overall | ≥ 0.85 | **87.5%** | ✅ | was 96.6% |
| Hit@5 Kurdish | ≥ 0.70 | **85.7%** | ✅ | was 100% |
| Routing accuracy | ≥ 0.85 | **8.9%** | ❌ | was 28.6% |
| False-route rate | ≤ 0.05 | **0.0%** | ✅ | unchanged |

> [!important] Every one of those old numbers was measuring invented content
> **28 of the 42 gold items pointed at the retired placeholders.** "Hit@5 96.6% / Kurdish
> 100%" was retrieval scored against bundles with made-up prices and made-up shortcodes, and
> the Kurdish figure was 5 real Sorani items plus **5 Badini items whose content existed
> nowhere but the placeholder**.
>
> The gold set was rewritten onto real entities (31 retrieval items: 13 en, 11 ar, 7 ckb),
> each `expected_chunk` verified against chunks the chunker actually emits. **87.5% / 85.7%
> is the first honest measurement**, and both still clear their gates.
>
> Routing's drop is a measurement artefact too, and an instructive one: the intent `examples`
> were written around the placeholder bundles, so they matched the old placeholder-shaped
> queries better than they match real questions about real products. 8.9% is what routing
> actually does for a real customer. It moves when real utterances land — see
> [[Content pipelines]].

### Coverage the migration lost

Not hidden, because these are gaps in the *content*, not in the harness:

| Lost | Why | Comes back when |
|---|---|---|
| `unsubscribe` + `fees_edgecases` on a bundle (9 items) | The FEBRA export states no cancellation steps and no repeat-purchase fees | Product/BSS supplies them |
| The **kmr (Badini)** slice entirely (5 items) | No source we have carries Badini | Badini copy is authored |
| Location **exclusion** | The only location-restricted entity was invented, Baghdad-only and all | A real location-restricted bundle lands (worksheet row 16) |

The Sorani slice was widened from 2 to 7 items to keep the Kurdish gate meaningful.

## Why routing is 8.9%

Not architecture — data. The intent examples are invented placeholders, and **31 of the 45
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

`npm test` — **190 tests, all passing** (2026-09-12). Offline; no stack needed except the
Qdrant integration test.

| File | Pins |
|---|---|
| `febra.test.js` | The FEBRA import's refusals ([[Content pipelines]]) |
| `answer-guards.test.js` | The relevance floor and the solicitation guard ([[Safety and security]]) |
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
