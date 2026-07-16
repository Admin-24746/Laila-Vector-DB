# 07 — Ingestion & Update Pipeline

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

> This doc defines how raw inputs (hand-authored docs + API data) become **normalized, chunked,
> embedded records in Qdrant**, and how we keep them fresh with **fast incremental updates**. This is the
> last foundational doc — clearing it opens the build gate.

---

## 1. Pipeline overview

```
  SOURCES                NORMALIZE            VALIDATE         CHUNK + EMBED            STORE
  ┌──────────────┐
  │ Manual docs  │──┐
  │ (MD/JSON)    │  │   ┌─────────────┐    ┌──────────┐    ┌────────────────┐    ┌──────────────┐
  └──────────────┘  ├──►│ → canonical │───►│ schema & │───►│ render sections│───►│ upsert into  │
  ┌──────────────┐  │   │   Entity    │    │ rules    │    │ ×language +    │    │ Qdrant by    │
  │ Company APIs │──┘   │ (doc 02)    │    │ checks   │    │ header → embed │    │ entity_id    │
  │ (extractors) │      └─────────────┘    └──────────┘    │ (BGE-M3/TEI)   │    └──────────────┘
  └──────────────┘                                          └────────────────┘
                                  ▲                                                     │
                                  └──────── change detection (hash/version) ◄───────────┘
                                          only changed entities flow through
```

The pipeline is the same for both source types — they merge at **Normalize**, exactly the reason a
normalization layer exists (doc 00 §6).

## 2. Sources & connectors

| Source | Form | Connector | Cadence |
|--------|------|-----------|---------|
| Hand-authored | Markdown / JSON in a Git repo | File reader | On change (commit/save) |
| Company APIs | JSON (product/billing/etc.) | Per-API extractor → maps fields to canonical schema | Scheduled (cron) |

Each connector's only job: **produce raw records**. They do not chunk or embed — separation of concerns
keeps new sources cheap to add (write one mapper).

## 3. Normalization layer → canonical Entity

Every raw record is mapped to the **canonical Entity** (doc 02 §3): `id`, `type`, `subtype`, `names`,
`description`, `how_to`, `conditions`, `facts`, `conflicts_with`, `attributes`, provenance.

- **Merge rule:** when both sources touch one entity (API fills `facts.price`, human writes
  `description`), the normalizer merges them into one record, field-by-field, with a documented
  precedence (API wins on `facts`; human wins on prose). 
- **Provenance kept** per field group (`source`, `source_ref`) so we always know where a value came from.

## 4. Validation (quality gate)

Before anything is embedded, each Entity is checked:

- **Schema:** required core fields present; types correct.
- **Languages:** flag entities missing a language so authoring can fill gaps (don't silently ship 1-language).
- **Conditions sanity:** `valid_from ≤ valid_to`; fees numeric; locations from a known list.
- **Referential:** `conflicts_with` / `target_flow` point to things that exist.
- **Result:** invalid records are rejected with a clear report — **bad data never reaches the index.**

## 5. Chunk + embed (apply docs 03 & 04)

1. **Render** each existing section (`overview`, `subscribe`, … and for `type:intent`, the example
   utterances) into text, **per language**, with the **contextual header** (`[Name · subtype · aliases]`).
2. **Attach metadata** (entity_id, type, subtype, section, language, conditions, facts, version, updated_at).
3. **Embed in batches** via the TEI/BGE-M3 service (dense + sparse).
4. Produce records keyed by deterministic **`entity_id::section::language`**.

## 6. Storing & incremental updates (the important part)

**Change detection:** each Entity carries a **content hash** + `version`. On a pipeline run:

```
  for each incoming entity:
     if hash unchanged  → skip (no re-embed, no write)
     if changed/new     → re-chunk + re-embed that entity only
                          → Qdrant: delete points where payload.entity_id == id
                          → Qdrant: upsert the new points
     if removed at source → retire (see §7)
```

- **Only changed entities are touched** → updating one bundle costs ~milliseconds, never a full
  re-index (satisfies FR8, NFR6; "even huge changes done quickly" — doc, batch 7).
- **Idempotent:** re-running the pipeline with unchanged data is a no-op (hashes match).
- **Atomic per entity:** delete+upsert for one `entity_id` keeps the index consistent.

## 7. Retirement & expiry

| Case | Handling |
|------|----------|
| Bundle pulled from catalog | **Soft-retire:** mark `status:retired` (filtered out of retrieval) for an audit window, then hard-delete |
| Time-bound promo passes `valid_to` | Date pre-filter (doc 06 §2.2) auto-excludes it; optional cleanup job hard-deletes stale ones |
| Source API drops a record | Reconciliation (next) flags it for retirement |

## 8. Reconciliation / drift detection

A periodic job compares Qdrant's current entities against the source-of-truth API set:

- **In source but not indexed** → ingest.
- **Indexed but gone from source** → flag for retirement.
- **Value drift** (price differs) → re-ingest.

This guards against silent staleness — important because answers must become provably correct (NFR4).

## 9. Authoring & review workflow (content quality)

Because **data quality is the product**, hand-authored knowledge follows a light, version-controlled flow:

```
  author edits MD/JSON  →  pull request  →  review (peer / domain owner)  →  merge  →  auto-ingest
```

- Git gives history, diff, blame, and rollback for free.
- Review catches errors **before** they reach customers.
- A "seed set" of the **top ~20 bundles/services + core intents** is authored first (drives prototype + eval).

## 10. Pipeline observability

Each run emits: counts (processed / skipped / upserted / rejected), per-entity failures, embedding
latency, and a diff summary. Surfaced to the maintainer so a broken extractor is obvious, not silent.
(Full system observability in doc 10.)

## 11. Operational shape

- A **JS ingestion service/CLI** orchestrates connectors → normalize → validate → chunk → embed → upsert.
- **Manual sources:** triggered on merge (Git hook / CI).
- **API sources:** triggered on a **schedule** (cron), cadence per source (daily/weekly).
- Runs locally now; a small scheduled job/container in Phase 2.
- **CRUD, bulk operations, and the add-and-test (staging→test→promote) workflow** are specified in doc 20.

## 12. Open items to confirm

- [ ] Confirm **authoring format** (Markdown with front-matter vs JSON) and the repo location.
- [ ] Confirm **merge precedence** (API wins on facts, human wins on prose) — or adjust.
- [ ] Confirm **soft-retire window** length before hard delete.
- [ ] Identify the **first API(s)** to write extractors for, and the **seed 20** entities.
- [ ] Confirm cron cadence per API source.
