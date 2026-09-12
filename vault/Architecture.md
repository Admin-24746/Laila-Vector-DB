---
title: Architecture
tags: [design, laila]
updated: 2026-09-12
---

# Architecture

## The shape of it

```
                 customer message
                        │
                        ▼
        ┌───────────────────────────────┐
        │  retrieval-svc  (:8090)       │
        │                               │
        │  1. safety filter   ← runs FIRST, before any LLM sees the text
        │  2. understand()    ← follow-up rewrite (LLM), gated
        │  3. embed (TEI)     ← BGE-M3, 1024-dim
        │  4. search (Qdrant) ← dense + sparse hybrid, one collection
        │  5. rank / filter   ← language, location, service class, dates, status
        │  6. relevance gate  ← below the floor: decline, never call the LLM
        │  7. compose (LLM)   ← /v1/answer only
        │  8. guardrail       ← numbers trace to evidence; no solicitation; no script drift
        └───────────────────────────────┘
                        │
         chunks + grounded_facts + bucket_hint
```

Three external processes back it: **Qdrant** (the index), **TEI** (the embedding model), and
an **OpenAI-compatible LLM** (Ollama locally). All three are optional in the sense that the
service degrades honestly rather than lying — see [[Safety and security]].

## Why these pieces

| Choice | Why |
|---|---|
| **Qdrant**, one collection | Hybrid dense + sparse in a single query; payload filtering is expressive enough for language/location/class/date gates without a second store |
| **BGE-M3** via TEI | One model covering English, Arabic and both Kurdish variants. Sharing a vector space across languages is what makes a Kurdish question find Arabic evidence |
| **Chunk per language per section** | A customer asks in one language; retrieval should score against text in that language, not a translation of it |
| **Node service** | The docs/08 contract is a thin HTTP surface; nothing here needs a heavier runtime |

## The two jobs

### Retrieval — "what do we know?"
Embed the message, search the index, filter by what the caller said about the customer
(language, location, service class), return the winning chunks plus `grounded_facts`
(machine-readable price/validity/id) and a `bucket_hint`.

### Routing — "where should this go?"
The same index also holds **intent** entities whose `examples` are raw customer utterances,
embedded *without* a contextual header so they sit in the same vector space as an incoming
message. Routing is nearest-neighbour against those examples with two thresholds:

- above `ROUTE_TAU_HIGH` and clear of its rival by `ROUTE_MARGIN` → **route**
- above `ROUTE_TAU_LOW` but not clear → **clarify** (ask the customer)
- below `ROUTE_TAU_LOW` → **fallback**

> [!important] Routing quality is a content problem, not an architecture problem
> Routing sits at **8.9%** because the intent examples are invented placeholders. Adding 62
> real bundles moved it by **zero**, exactly as expected — bundles are not what routing scores
> against. It then *fell* from 28.6% when the gold set moved onto real questions, because the
> examples had been written around the placeholder bundles. See [[Evaluation]].

## Code map

| Path | What lives there |
|---|---|
| `src/lib/chunker.js` | Entity → chunks. The single most behaviour-defining file |
| `src/lib/embedder.js` | TEI client, batches of 24 |
| `src/lib/qdrant.js` | Collection setup, upsert, hybrid search |
| `src/lib/validate.js` | The gate: bad data never reaches the index |
| `src/lib/vocab.js` | Controlled vocabularies from `data/vocab/` |
| `src/lib/normalize.js` | Language/script detection, text normalisation |
| `src/lib/sparse.js` | Lexical (IDF) side of the hybrid search |
| `src/lib/config.js` | `.env` → `CONFIG`, read once at import |
| `src/lib/febra.js` | FEBRA export parsing ([[Content pipelines]]) |
| `src/lib/logmine.js`, `csv.js` | Log-export mining ([[Content pipelines]]) |
| `src/ingest/run.js` | The ingest CLI: hash-based, incremental, idempotent |
| `src/service/retrieve.js` | The retrieval engine |
| `src/service/understand.js` | Follow-up rewrite + anchoring guard |
| `src/service/answer.js` | Compose + relevance floor + number guardrail + solicitation guard + script-drift guard |
| `src/service/safety.js` | Injection detection, leak guard |
| `src/service/server.js` | HTTP surface + auth + sandbox console |
| `src/eval/run.js` | The gate metrics |
| `scripts/` | Content pipelines ([[Content pipelines]]), `probe.mjs` ([[Testing it yourself]]), the red-team runner |

## Things that will bite you

> [!warning] `CONFIG` is read at import time
> `src/lib/config.js` evaluates `.env` when the module is first imported. Tests that need
> different config **shell out** to the CLI rather than re-importing — that is why
> `test/integration.qdrant.test.js` spawns `node src/ingest/run.js` instead of calling it.

> [!warning] An empty numeric in `.env` is not the same as an absent one
> `Number('')` is `0`, and `??` does not catch `''`. `ROUTE_TAU_HIGH=` (empty) used to make
> the router **confidently route garbage**. Fixed and pinned, but the shape of the bug is
> worth remembering.

Related: [[Data model]] · [[Endpoints]] · [[Safety and security]]
