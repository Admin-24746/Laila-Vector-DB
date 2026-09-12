---
title: Glossary
tags: [reference, laila]
updated: 2026-09-12
---

# Glossary

## The domain

| Term | Meaning |
|---|---|
| **Laila** | Asiacell's customer-facing agent. This project is the knowledge and routing engine behind it |
| **ATL** | Above-the-line — a bundle in the public catalogue, available to anyone eligible |
| **BTL** | Below-the-line — a personalised offer targeted at one customer. Carries a `btlProductName` |
| **RED Line** | An Asiacell line type: up to 4.5× balance multiplier, social apps included, family sharing. Switching to it is **one-way** (you can only move on to YOOZ) |
| **YOOZ** | Another line type. Yooz bundles require a Yooz line |
| **FEBRA** | The bot-flow project whose export is the source of the real bundle catalogue |
| **Shukran** | Asiacell's rewards programme. The name is real; the repo's definition was invented, so the entity is **retired** — asking about it now gets an honest non-answer |
| **Eshrat Omar** (عشرة عمر) | A discounts programme named by the RED Line source but **defined nowhere**. The canonical example of "naming is not defining" — a 3B model invented a definition for it 3 runs out of 3 ([[Safety and security]]) |
| **Elna / Lil-Kul** | Bundle families. "Elna w lil Kul" is the repeat-purchase-fee pattern (3×/month → +2,500 IQD) |
| **FUP** | Fair use policy — the threshold after which an "unlimited" bundle is throttled. **Not an allowance**, and never stored as one |
| **MSISDN** | A phone number. Redacted by the log pipeline |
| **BSS / CBS** | The business/charging systems that hold the authoritative eligibility and fee rules |
| **TMF** | The TM Forum API response format, one of two shapes `productOfferingQualification` returns |

## Shortcodes seen in the sources

| Code | What |
|---|---|
| `*230#` | RED line: switch to RED, and manage RED packages |
| `send 1/2/3/8 to 230` | Subscribe to a specific RED package |
| `send 0 to 230` | Cancel a RED package (stated in the Arabic source only) |
| `call 200` | Customer service — one of the ways to switch to RED |
| `*#313#` | Women's services discount. A legitimate `*#NNN#` form — **not** a mangled code |
| `*123#`, `1234`, `*321*2#` | ⚠️ **INVENTED.** They existed only in the placeholder entities — now `retired` — and dial nothing |

> [!danger] RTL mangling of shortcodes
> The Arabic source writes `*230#` as `#230`, the Kurdish as `#230*`. The importer repairs
> these from the English row. If you ever hand-author Arabic or Kurdish copy, write USSD codes
> in their **LTR form** — the source files say so explicitly, then break their own rule.

## The project's own vocabulary

| Term | Meaning |
|---|---|
| **Entity** | One JSON file under `data/seed/`. The unit of authoring |
| **Chunk** | One embedded text fragment: entity × section × language. The unit of retrieval |
| **Section** | `overview`, `subscribe`, `unsubscribe`, `eligibility`, `fees_edgecases`, `conflicts`, `example_N` |
| **`grounded_facts`** | The machine-readable answer (price, validity, id) returned beside the prose |
| **`bucket_hint`** | A coarse category hint for the calling flow |
| **Guardrail** | The check that every number in an answer traces to that entity's evidence |
| **`score`** | The **fused rank** score (RRF) on a retrieval result. Orders the list; says nothing about relevance — an irrelevant chunk can score 1.00. Never threshold on it |
| **`relevance`** | Raw **cosine** similarity of a chunk to the query. This is the confidence number. Added 2026-09-12 |
| **`max_relevance`** | The best `relevance` in a result set — the one number a caller gates on |
| **RRF** | Reciprocal Rank Fusion — how the dense and lexical result lists are merged. Rank-based by construction, which is why it cannot be a confidence |
| **Relevance floor** | `ANSWER_RELEVANCE_FLOOR` (0.55). Below it `/v1/answer` declines **without calling the LLM**, so there is nothing to invent from |
| **`abstained`** | The service declined rather than answered. `grounded: true` does **not** mean answered — an honest "I don't have that detail" is grounded |
| **Solicitation guard** | Fails an answer that asks the customer for a secret or for account details, or that leaks an internal id |
| **Semantic magnet** | An entity whose description covers so many topics that it ranks first for unrelated questions. `service_red_line` was one until it was split |
| **`misattributed_number`** | A number that is real but belongs to a *different* entity in the same result set |
| **Anchoring guard** | The check that a follow-up rewrite is grounded in the actual conversation |
| **τ_high / τ_low** | `ROUTE_TAU_HIGH` / `ROUTE_TAU_LOW` — the route and fallback thresholds |
| **Margin** | `ROUTE_MARGIN` — how far the top intent must beat its rival to route confidently |
| **False route** | Confidently routing something that should have been clarified. The dangerous failure |
| **Gold set** | `eval/gold/gold.jsonl` — held-out items the eval scores against |
| **Hold-out** | The 20% of utterances kept out of training. **Hash-based**, so it never reshuffles |
| **Draft / verified** | Entity status. Nothing is `verified` yet; everything real is `draft` |
| **`review_note`** | The per-entity record of what is still unconfirmed. The contract with the reviewer |
| **D16 / D18 / docs/NN** | Design decisions and contract documents in `docs/` |

## Language codes

| Code | Language |
|---|---|
| `en` | English |
| `ar` | Arabic (Iraqi) |
| `ckb` | Kurdish — Sorani |
| `kmr` | Kurdish — Badini / Kurmanji. **Absent from every source we have** |

Related: [[Data model]] · [[Content pipelines]] · [[00 - Start Here]]
