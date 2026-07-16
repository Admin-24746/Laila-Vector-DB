# 02 — Data Inventory & Entity Model

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

This document defines **what knowledge we store and how it is structured**. It is the blueprint the
chunking (03), embedding (04), and ingestion (07) docs build on. The guiding requirement is
**extensibility** — we will add new entity types and new attributes over time, so nothing here is
allowed to be rigid.

---

## 1. Design Principle: Open, Extensible Schema

We do **not** hard-code a fixed set of fields per entity. Instead:

- Every piece of knowledge is an **Entity** with a small **core** (stable fields every entity has) plus
  an open **attributes** bag and a list of **rules**.
- A **type taxonomy** (`type` + `subtype`) classifies entities and can grow without schema changes.
- **Metadata is free-form and editable.** The fields shown later (location, service_class, language, …)
  are *examples, not a fixed set*. Qdrant payloads are schemaless, so new metadata keys can be added or
  edited per-record at any time **without migrations or re-indexing**. Treat the field list as a living
  convention, documented here but never hard-locked in code.
- New attribute groups (quality, process, …) are added as keys under `attributes` — no migration needed.

This lets us start with bundles + services today and bolt on new categories later without redesign.

## 2. Entity Type Taxonomy (extensible)

| `type` | `subtype` (examples) | Notes |
|--------|----------------------|-------|
| `bundle` | `atl`, `btl`, `corporate` | More subtypes may be added |
| `service` | (e.g. Shukran, Bye Bye) | Subtypes TBD as needed |
| `terminology` | — | Synonym/glossary entries (e.g. line = primary offer = service class) |
| `intent` | per flow (loan, btl, complaint, shop_locator, …) | **Routing examples** — utterances mapped to a `target_flow` for the dispatcher (see §2b) |
| `roaming` | country / partner plans | Roaming offerings — own structure (doc 16) |
| `image_ref` | scratch_card, competitor_card, sim, id, screenshot, … | **Reference images** for visual recognition/routing — stored in a separate image-vector collection (doc 18) |
| `error` | by error code / source system | **Error explanations** — system/API errors → human-friendly cause + resolution; reduces human escalations (doc 19) |
| _future_ | _quality, process, …_ | **Reserved — added when defined.** The model must accept new types freely |

> The taxonomy is **data, not code** — stored in a small editable list so adding `type: roaming` later
> is a config change, not a rewrite.

## 2b. Second use case — Intent routing for the dispatcher (`type: intent`)

The same vector DB is **also** the dispatcher's semantic router. Today the dispatcher mis-routes
(e.g. a loan request sent to BTL or the knowledge base). We fix that by storing **intent entities**:
curated example utterances for each flow, embedded and tagged with their `target_flow`.

```jsonc
{
  "id": "intent_loan_001",
  "type": "intent",
  "subtype": "loan",
  "target_flow": "loan_flow",
  "examples": {                       // multilingual example utterances
    "en": "I need a loan", "ar": "احتاج قرض", "ckb": "پێویستم بە قەرزە", "kmr": "Ez deynê dixwazim"
  },
  "metadata": { "priority": 1, "notes": "advance balance / credit requests" }
}
```

**How it's used at dispatch time** (mechanics finalized in doc 06, integration in doc 08):
1. Embed the customer message.
2. Search `type:intent` records → nearest example(s) → read `target_flow`.
3. Apply a **confidence threshold + margin**: route only if the top match is clearly best; otherwise
   **abstain and ask a clarifying question** (never guess) — this is what eliminates misroutes.
4. Dispatch to the chosen flow (loan_flow, btl_flow, …).

**Why store intents in the same DB:** one model, one infrastructure, multilingual for free, and new
intents are added by inserting examples (no retraining). The `type:intent` payload filter keeps routing
records separate from knowledge records during search.

> **New decision D7** (resolved in doc 06): exact routing mechanism — pure vector nearest-neighbour vs
> vector + LLM tie-breaker — and the confidence/abstain thresholds.

## 3. Core Entity Schema (proposed)

A single, language-aware, extensible shape. (Illustrative JSON — final field names settled in doc 07.)

```jsonc
{
  "id": "bundle_combo_monthly_2",      // stable canonical key
  "type": "bundle",
  "subtype": "btl",

  // --- Multilingual identity (D1 decides how we store/translate) ---
  "names": {
    "en": "Combo Bundle",
    "ar": "باقة كومبو",
    "ckb": "پاکێجی کۆمبۆ",            // Sorani (Arabic script)
    "kmr": "Pakêja Combo",             // Kurmanji (Latin script)
    "aliases": ["combo", "كومبو", "combo monthly"]   // colloquial forms for entity resolution
  },

  // --- Human-readable knowledge (this is what gets chunked & embedded) ---
  "description": {
    "en": "4 weeks: 500 on-net minutes, 25 on-net SMS, 25 off-net min/SMS, 300MB data for 5,000 IQD.",
    "ar": "...", "ckb": "...", "kmr": "..."
  },
  "how_to": {
    "subscribe": { "en": "...", "ar": "...", "ckb": "...", "kmr": "..." },
    "unsubscribe": { "en": "...", "ar": "...", "ckb": "...", "kmr": "..." }
  },

  // --- Structured conditions for METADATA FILTERING (not just prose) ---
  "conditions": {
    "eligible_locations": ["baghdad"],          // null/empty = everywhere
    "eligible_service_classes": ["red", "..."], // ties to primary offer / line
    "valid_from": "2026-06-20",
    "valid_to":   "2099-12-31",
    "repeat_purchase_fee_iqd": 2500,            // e.g. Elna w lil Kul pattern
    "repeat_purchase_threshold": 3
  },

  // --- Crisp facts kept structured (price, expiry, ids) ---
  "facts": {
    "price_iqd": 5000,
    "expiry": "4 Weeks",
    "bundle_id": 1601,
    "offer_id": null
  },

  // --- Conflicts / relationships ---
  "conflicts_with": ["bundle_xyz"],

  // --- Open extension point: future attribute groups go here ---
  "attributes": { /* quality, process, ... added later with no schema change */ },

  // --- Provenance & lifecycle ---
  "source": "api" ,                  // "api" | "manual"
  "source_ref": "productOfferingQualification#1601",
  "version": 3,
  "updated_at": "2026-06-28T00:00:00Z",
  "languages_present": ["en", "ar", "ckb", "kmr"]
}
```

## 4. The Structured-vs-Prose Question (Decision D2)

Notice the schema deliberately splits knowledge into two homes:

| Home | Holds | Why |
|------|-------|-----|
| **Structured** (`conditions`, `facts`, `conflicts_with`) | Crisp, queryable values (price, dates, locations, fees, eligibility classes) | Code can **filter/compute** on these exactly; no hallucination; powers metadata-filtered retrieval (doc 06) |
| **Prose** (`description`, `how_to`) | Explanations, instructions, nuance | Natural-language is what users actually ask in; this is what gets **embedded & semantically searched** |

> **D2 resolution (proposed):** *Both.* Every entity carries structured fields **and** prose. Crisp rules
> live structured (so code stays deterministic — Principle 1) **and** are also rendered into prose for
> semantic retrieval. We get exact filtering *and* natural-language recall from one source of truth.
> **Confirm this dual approach** — it shapes chunking (03) and retrieval (06).

## 4b. Eligibility data: static vs dynamic (Decision D15)

Eligibility splits cleanly into two homes — **never** store live customer state in the vector DB:

| Kind | Lives in | Example |
|------|----------|---------|
| **Static eligibility** | **Vector DB metadata** (`conditions`) | "This bundle allows Red service-class, Baghdad only." Filterable, used for pre-checks (doc 19) and entity resolution. |
| **Dynamic per-customer** | **Live BSS/CDR API at request time** (in code) | "Is THIS line whitelisted / actually eligible right now?" Never stored; decided deterministically (Principle 1). |

So the DB knows the *rules*; the live API knows the *customer*. The flow combines them (doc 08 §4).

## 5. Multilingual Handling (feeds Decision D1)

- Each text field is a per-language map (`en`/`ar`/`ckb`/`kmr`), plus an `aliases` list for colloquial
  and romanized forms — critical for entity resolution across Sorani, Kurmanji, Arabic, English.
- **D1 (still open):** do we *store* all languages, or store one pivot language and translate at query
  time? Resolved in docs 03/04 once we pick the embedding model. The schema above supports either —
  it can hold all languages or just a pivot.

## 6. Data Sources → Field Mapping

| Field group | Likely source | Refresh |
|-------------|---------------|---------|
| `facts` (price, expiry, ids) | **API** (product/billing) | Auto, scheduled |
| `conditions` (locations, dates, fees) | Mixed — some API, some **manual** | Mixed |
| `description`, `how_to` | **Manual** (authored) | Human-owned |
| `names`, `aliases`, `terminology` | **Manual** (curated) | Human-owned |
| `conflicts_with` | **Manual** initially | Human-owned |

This split is exactly why the ingestion pipeline (doc 07) needs a **normalization layer** that merges
API-sourced and hand-authored fields into one Entity record.

## 7. Volume Estimate

| Entity type | Rough count | Notes |
|-------------|-------------|-------|
| Bundles (ATL/BTL/Corporate) | hundreds | Primary mass |
| Services | tens | Shukran, Bye Bye, … |
| Terminology entries | tens | Glossary/synonyms |
| **Total entities** | **~hundreds–low thousands** | |
| **Total chunks after splitting** | **~thousands–low tens-of-thousands** | Confirms: small corpus (doc 00, Principle 4) |

## 8. Open Items for This Document

- [ ] Confirm the **dual structured+prose** model (D2).
- [ ] List the **top ~20 bundles/services** to seed first (drives the prototype + eval set in doc 09).
- [ ] Define the first **future attribute groups** you have in mind (quality? process?) so we reserve
      sensible keys — even rough names help.
- [x] **Canonical id RESOLVED (D16):** `entity_id = {type}_{bundleId}`; `offerId` secondary; save the
      COMPLETE record (all languages, prices, rules…). Full schema in **doc 25**; vocabularies in **doc 26**;
      sources in **doc 27**. Relationships modeled (D17); units normalized (D18).
