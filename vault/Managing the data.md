---
title: Managing the data
tags: [runbook, data, laila]
updated: 2026-09-12
---

# Managing the data and the embeddings

> [!important] One rule to start from
> **The JSON files under `data/seed/` are the source of truth. The index is derived and
> disposable.** Never edit the vector store to change content — edit the file and re-ingest.
> Anything you change directly in Qdrant is silently undone by the next `npm run ingest`.

## The pipeline, once

```
data/seed/**.json          you edit this
   → validate              src/lib/validate.js — errors REJECT the entity
   → chunk                 src/lib/chunker.js — one chunk per section × language
   → embed                 TEI / BGE-M3 → 1024-dim dense + a sparse lexical vector
   → upsert                Qdrant collection `laila_knowledge`
```

What ends up in the store, verified on 2026-09-12:

```
collection laila_knowledge · status green · 409 points
dense:  1024 dims, Cosine        sparse: "lexical" (idf)
```

## Add an entity

```bash
cp data/seed/bundles/_TEMPLATE.bundle.json data/seed/bundles/bundle_9999.json
#   fill it in — entity_id MUST be "bundle_<bundleId>" (validation enforces the prefix)
npm run ingest:dry     # validate + print the chunks it would write. Writes nothing
npm run ingest         # ~5 s: only your entity is embedded
npm run probe          # confirm nothing else moved
```

Files whose name starts with `_` are skipped, so the template is never ingested. The right
directory is by **type**: `bundles/`, `services/`, `terminology/`, `intents/`.

## Edit an entity

Edit the file, then:

```bash
npm run ingest
```

Ingestion is keyed on a **SHA-256 content hash per entity**, kept in `.ingest-state.json`:

```json
{ "bundle_1000": "dad4bf859eb13683af70dd4f8eac108e99b5b07fdc9b43e35cdb81e1d4b4e362", … }
```

Changed hash → that entity is re-chunked and re-embedded. Unchanged → skipped entirely. A
one-entity edit costs **~5 s**; a full rebuild is **~132 s**.

> [!danger] The hash covers the ENTITY, not the code
> A change to the **chunker**, the **payload shape** or the **embedding model** is invisible
> to it — the file did not change, so ingestion skips it and the index silently keeps stale
> chunks. After any such change you must:
> ```bash
> npm run ingest:rebuild
> ```
> Same if `.ingest-state.json` came from another machine. When unsure, rebuild — 132 s is
> cheaper than debugging a stale index.

## Delete an entity

Two ways, and the difference matters.

**1. Delete the file** — for something that should not exist at all (a test fixture):

```bash
rm data/seed/bundles/bundle_9999.json
npm run ingest
#   → "Retired bundle_9999 (source file removed)."   0.1 s
```

**2. Set `"status": "retired"`** — for real content that must stop being served but whose
record is worth keeping:

```jsonc
{ "entity_id": "bundle_1601", "status": "retired", … }
```

`buildFilter()` excludes `retired` from **every** query, so it is unanswerable immediately
after a re-ingest while its file, its facts and its `review_note` stay in git. This is what
was done to the five invented placeholders — see [[Data model]].

> [!warning] Removal is guarded, deliberately
> `retiredIds()` works off **what is on disk**, not off what validated. An entity that fails
> validation used to look "removed" and had its live points deleted — the opposite of what
> the run printed (audit 2026-08-22). There is also a guard that refuses to retire the whole
> collection when the seed directory comes back empty, so a bad path cannot wipe the index.

## Status, and the one that will surprise you

| Status | Retrievable in the sandbox | Retrievable in production |
|---|---|---|
| `draft` | ✅ | ❌ |
| `needs_review` | ✅ | ✅ |
| `verified` | ✅ | ✅ |
| `retired` | ❌ | ❌ |

> [!danger] Production currently serves NOTHING
> Everything in the repo is `draft`, and `NODE_ENV=production` (or `EXCLUDE_DRAFT=1`) hides
> draft. Measured:
> ```
> EXCLUDE_DRAFT=1      → 0 chunks
> EXCLUDE_DRAFT=0      → 5 chunks
> NODE_ENV=production  → 0 chunks
> ```
> Moving entities to `status: "verified"` after a human checks them is the deployment gate.
> The flag takes `1`/`0` — `EXCLUDE_DRAFT=true` silently means *show* draft.

## Looking inside the index

Read-only, safe, no auth (Qdrant is loopback-only):

```bash
# collection summary: point count, vector config, status
curl -s http://127.0.0.1:6333/collections/laila_knowledge

# how many points does one entity have?
curl -s -X POST http://127.0.0.1:6333/collections/laila_knowledge/points/count \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"must":[{"key":"entity_id","match":{"value":"bundle_1684"}}]},"exact":true}'
#   → {"result":{"count":3}}

# which chunks are they?
curl -s -X POST http://127.0.0.1:6333/collections/laila_knowledge/points/scroll \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"must":[{"key":"entity_id","match":{"value":"bundle_1684"}}]},
       "limit":10,"with_payload":["chunk_id"],"with_vector":false}'
#   → bundle_1684::overview::ckb / ::en / ::ar
```

### Seeing an actual embedding

```bash
curl -s -X POST http://127.0.0.1:6333/collections/laila_knowledge/points/scroll \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"must":[{"key":"chunk_id","match":{"value":"bundle_1684::overview::en"}}]},
       "limit":1,"with_payload":false,"with_vector":true}'
```

Gives a point with **two** vectors:

```
id: d92ceef3-ba96-5468-81e3-713b4f078b94
vector.dense:   1024 floats  → -0.0167, -0.0015, -0.0042, -0.0046, -0.0232, -0.0536, …
vector.lexical: {indices, values}  ← the sparse/idf side of the hybrid search
```

> [!tip] Point ids are deterministic, which is why re-ingest is idempotent
> `pointIdFor(chunkKey)` in `src/lib/qdrant.js` is a UUID built from a SHA-1 of the chunk key
> (`bundle_1684::overview::en`). The same chunk always lands on the same point id, so an
> upsert replaces rather than duplicates — you can re-run `npm run ingest` as often as you
> like and the point count will not drift.

## Surgery on the store — and why you almost never want it

These work, and they are the wrong tool for content changes: the next `npm run ingest`
rewrites whatever you did, because the files are the truth.

```bash
# delete one entity's points (they come straight back on the next ingest)
curl -s -X POST http://127.0.0.1:6333/collections/laila_knowledge/points/delete \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"must":[{"key":"entity_id","match":{"value":"bundle_9999"}}]}}'

# ⛔ drop the whole collection — then you MUST npm run ingest:rebuild
curl -s -X DELETE http://127.0.0.1:6333/collections/laila_knowledge
```

Legitimate uses: recovering from a corrupted collection, or clearing a throwaway collection
(`COLLECTION=laila_knowledge_test`) that the integration test leaves behind.

### Snapshots

Qdrant can snapshot a collection; `./snapshots/` is where the native binary keeps them.

```bash
curl -s -X POST http://127.0.0.1:6333/collections/laila_knowledge/snapshots   # create
curl -s http://127.0.0.1:6333/collections/laila_knowledge/snapshots          # list
```

Useful before an experiment. Not a backup strategy: **the seed files plus `npm run
ingest:rebuild` reproduce the entire index in 132 s**, and they are in git. Back up
`data/seed/`, not the vector store.

## Changing the embedding model

This is the one change that invalidates everything:

1. change `--model-id` in `docker-compose.yml` (and the dimension in `src/lib/qdrant.js` if
   it differs from 1024),
2. `docker compose up -d tei` and wait for the new model to download,
3. **`npm run ingest:rebuild`** — old and new vectors are not comparable, so a partial index
   is worse than an empty one,
4. `npm run eval` — the gate numbers move with the model; re-measure before trusting them.

Also re-run `npm run sanity:kurdish`, which checks the model licence alongside the Kurdish
output.

Related: [[Data model]] · [[Docker]] · [[Terminal reference]] · [[Testing it yourself]]
