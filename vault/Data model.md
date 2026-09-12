---
title: Data model
tags: [design, data, laila]
updated: 2026-09-12
---

# Data model

One JSON file per entity under `data/seed/`. The file *is* the source of truth; the index is
derived and disposable.

```
data/seed/
  bundles/      50 real (+ 3 retired placeholders, kept for the record)
  services/     RED line + 12 RED plans (+ retired Shukran placeholder)
  intents/      5 routing intents (placeholder utterances — still the routing blocker)
  terminology/  RED balance + RED tariff (+ retired placeholder)
data/vocab/     controlled vocabularies — languages, locations, service classes, flows, entity types
```

## Entity types

| Type | Subtypes | What it is |
|---|---|---|
| `bundle` | `atl`, `btl`, `corporate` | Something a customer buys against a line. **Requires an integer `bundleId`** |
| `service` | — | A line type, programme or capability. No id requirement |
| `terminology` | — | A word customers use that needs defining |
| `intent` | — | Routing training data: example utterances → a flow |
| `roaming`, `error`, `image_ref` | — | Defined in the vocab, not yet used |

Types live in `data/vocab/entity_types.json` — **data, not code**. Adding one needs no code
change.

## The universal fields

```jsonc
{
  "entity_id": "bundle_1026",     // must start with "<type>_"
  "type": "bundle",
  "names":       { "en": "...", "ar": "...", "ckb": "...", "kmr": "..." },
  "description": { "en": "...", "ar": "..." },   // per language; this is what gets embedded
  "aliases": ["combo", "كومبو"],  // how customers actually type it
  "how_to": { "subscribe": { "en": "..." }, "unsubscribe": { "en": "..." } },
  "status": "draft",              // draft | needs_review | verified | retired
  "source": "mixed",              // api | manual | mixed
  "version": 1,
  "updated_at": "2026-09-12T00:00:00Z",
  "languages_present": ["en", "ar"],
  "attributes": { "review_note": "what is still unconfirmed" }
}
```

Bundles add normalised numerics (**D18**): `price_iqd` as an integer, `validity_days` in days
(4 weeks → 28), `data_mb` in MB (1 GB → 1024), plus `display.price` / `display.validity` so
the customer-facing string survives alongside the machine-readable one.

## How an entity becomes chunks

`src/lib/chunker.js`, one chunk per **section × language**:

| Section | From |
|---|---|
| `overview` (`definition` for terminology) | `description[lang]` |
| `subscribe` / `unsubscribe` | `how_to.*[lang]` |
| `eligibility` | service classes, locations, validity window — rendered per language |
| `fees_edgecases` | `repeat_purchase_fee_iqd` + `threshold`, as an ordinal |
| `conflicts` | `conflicts_with`, with the related entity's name in that language |
| `example_N` (intents only) | each utterance in `examples[lang]` |

Every non-intent chunk is prefixed with a header: `[Name · label · aliases: …]`. **Intent
chunks get no header** — they must live in the same vector space as a raw customer message.

> [!tip] What this means in practice
> `description` is the field that does the work. A fact that is not in some language's
> `description` (or `how_to`) is not retrievable in that language, no matter what other
> fields hold.

## The validation gate

`src/lib/validate.js`. **Errors reject the entity — bad data never reaches the index.**
Warnings are surfaced and do not block.

Rejections you will actually hit:
- `entity_id` does not start with `<type>_`
- a `bundle` missing an integer `bundleId`, a positive `price_iqd`, or a positive `validity_days`
- a language map whose *values* are not non-empty strings (`{"en": {...}}` used to pass and
  embed as the literal string `[object Object]`)
- `repeat_purchase_threshold` below 1 — it renders as an ordinal
- `conflicts_with` or `belongs_to_service` naming an entity that does not exist
- a location or service class outside the controlled vocabulary
- a duplicate `entity_id`
- an intent with no examples, or a `target_flow` not in the flows vocab

Warnings: missing required languages, and `languages_present` disagreeing with the actual keys.

## Status, and why everything is `draft`

| Status | Meaning |
|---|---|
| `draft` | Unconfirmed. Visible in the sandbox; **hidden when `NODE_ENV=production`** |
| `needs_review` | Someone flagged it |
| `verified` | A human confirmed the facts. **Nothing in the repo is here yet** |
| `retired` | Excluded from retrieval by `buildFilter`, kept on disk for the record |

> [!danger] Invented content does not sit quietly next to real content — it outranks it
> `bundle_1601/1602/1603`, `service_shukran` and `terminology_line` were placeholders with
> made-up prices and made-up shortcodes. They were **retired on 2026-09-12** after a probe
> measured them ranking **#1 on 6 of 24** realistic questions and appearing in the top 3 on
> **11 of 24** — they won because they were the only entities with *both* aliases and
> `how_to`, which made them the richest documents in the index. One returned an invented
> shortcode at a fused score of 1.00 for a question about a different bundle.
>
> The lesson generalises: a placeholder is not neutral. Until an entity is real, retiring it
> is safer than leaving it to be retrieved.

Every imported entity carries `attributes.review_note` naming exactly what is unconfirmed.
That note is the contract between the importer and the person who will verify it.

> [!warning] Draft visibility is a deliberate two-sided risk
> Hiding draft entirely makes the sandbox useless (everything is draft). Showing it in
> production would serve unconfirmed prices. The switch is `NODE_ENV` plus an `EXCLUDE_DRAFT`
> override, and the startup banner states which way it is set.

## Identity rules that matter

- **A bundle's identity is its `bundleId`, never its display name.** Several products share a
  name ("MAX Card 25 for 4 Weeks" exists under 2180 *and* 1712).
- **One id must mean one product.** The FEBRA export has ids 1013 and 1012 each claimed by two
  different roaming products; both sides were refused rather than imported. See
  [[Content pipelines]].
- **Empty `eligible_locations` / `eligible_service_classes` means everywhere / everyone.**
  Only leave them empty when that is genuinely true.

Related: [[Content pipelines]] · [[Architecture]] · [[Glossary]]
