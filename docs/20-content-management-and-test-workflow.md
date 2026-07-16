# 20 — Content Management & Test Workflow

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> Two hard requirements: (1) **full control of the data** — add, edit, delete, **in bulk**; and (2) the
> ability to **test the solution whenever you add or change something**, *before* it affects customers.
> This doc designs both. Resolves **D13**.

---

## 1. Full CRUD over entities

Every entity (bundle, service, intent, roaming, error, image_ref) is fully manageable. Each operation
runs through the pipeline (normalize → validate → chunk → embed → Qdrant) so the index never drifts.

| Op | What it does | Under the hood |
|----|--------------|----------------|
| **Create** | Add a new entity | validate → chunk → embed → upsert points |
| **Read** | Fetch/inspect an entity + its chunks | by `entity_id` |
| **Update** | Edit fields | re-chunk changed entity → delete old points by `entity_id` → upsert |
| **Delete** | Remove an entity | delete all points where `entity_id = …` (soft-delete first, §4) |

Exposed as a **management API + JS CLI** (admin UI later) — same engine, authenticated (doc 17).

## 2. Bulk operations

| Bulk op | Input | Safety |
|---------|-------|--------|
| **Bulk import** | CSV / JSON file of entities | dry-run + diff preview before commit |
| **Bulk edit** | by filter (e.g. all `subtype:btl` → change a field) | preview affected count + sample before apply |
| **Bulk delete** | by filter (e.g. retire all `valid_to < today`) | soft-delete + undo window (§4) |
| **Export** | filter → CSV/JSON | for backup, offline editing, review |

- **Idempotent & hash-based** (doc 07 §6): re-importing unchanged rows is a no-op.
- **Atomic per entity**; a bad row is rejected without blocking the batch (validation, doc 07 §4).

## 3. ⭐ The add-and-test workflow (the important part)

Nothing reaches customers untested. Adding/editing follows a **staging → test → promote** loop:

```
  1. AUTHOR/EDIT   entity (+ optional `test_questions` it should answer)
        │
  2. VALIDATE      schema & rules (doc 07 §4) — bad data blocked here
        │
  3. STAGE         ingest into a STAGING index (separate Qdrant collection), NOT live
        │
  4. AUTO-TEST     ① self-retrieval: each test_question must retrieve THIS entity in top-k
        │          ② routing (if intent): example utterances route to the right flow
        │          ③ regression: run the gold-set eval (doc 09) on staging — nothing else broke
        │          ④ collision: didn't wrongly outrank/buried a neighbour
        │
  5. PREVIEW       sandbox console (§4) — ask any question, see what staging returns
        │
  6. PROMOTE       green? → publish staging → live (instant swap). red? → fix & repeat.
```

- **Self-retrieval test** answers your exact ask: *"did the thing I just added actually become findable,
  and does it answer its questions?"* — instant, automatic.
- **Regression test** guarantees adding bundle X didn't break bundle Y (doc 09 §6 gate).

## 4. Test/sandbox console

A "**try it before it's live**" surface (for you / flow-builders):
- Type any query → see **retrieval results, scores, routing decision, composed answer, citations,
  grounded? flag** — run against **staging** or **live**.
- Shows *why* (which chunk matched, the score) → makes debugging a miss obvious.
- This is also the daily tool for flow-builders (doc 00 §7, the low-risk first consumer).

## 5. Safety, versioning, rollback

- **Soft-delete + undo window** before hard delete (doc 07 §7) — no accidental data loss.
- **Versioned** (doc 07): every change has `version`/`updated_at`; **one-click rollback** to a prior version.
- **Staging/live separation** = blue-green: promote is a swap, rollback is a swap back. Instant.
- **Easy purge** of logs/data (doc 10) — delete by filter/date.

## 6. Access & audit

- CRUD/bulk/promote actions are **authenticated and logged** (who changed what, when) — doc 17.
- Promotion to live can require **review/approval** (doc 07 §9) for customer-facing content.

## 7. Tooling & phasing

- **Now (alpha):** JS CLI for CRUD + bulk import/export + the auto-test loop + a simple sandbox query
  command. Runs on the laptop.
- **Later:** a lightweight admin **web UI** over the same API for non-technical authors.

## 8. D13 — Decision ✅

Content management = **CRUD + bulk API/CLI**, with a mandatory **staging → auto-test → promote** loop and a
**sandbox console**. No content goes live without passing self-retrieval + regression tests.

## 9. Open items to confirm

- [ ] Confirm **bulk formats** you'll use (CSV, JSON, Excel?).
- [ ] Confirm whether **promotion to live needs approval**, or you can self-promote in alpha.
- [ ] Confirm the **CLI-first** approach for alpha (web UI later) is acceptable.
- [ ] Decide the **undo window** length for soft-deletes.
