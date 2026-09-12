---
title: Running the stack
tags: [runbook, laila]
updated: 2026-09-12
---

# Running the stack

Four processes. Three you start, one (Ollama) is usually already running as a Windows
service. Verified working on this laptop on 2026-09-12.

> [!warning] Read these three before your first run
> 1. **Start Qdrant from `./qdrant_bin/qdrant.exe`, NOT `docker compose up qdrant`.** The
>    compose file defines a Qdrant service with its own Docker volume — a *different,
>    empty database*. Bringing that one up makes everything look broken for no reason.
> 2. **Docker Desktop does not start itself on this machine.** Launch it by hand, wait for
>    the whale icon to settle, then run the compose command.
> 3. **Run the service as `node src/service/server.js`, not `npm run serve`.** Under `npm`
>    the server is a child process; stopping the task orphans it, and the port stays taken.

## The four processes

| # | What | How | Port | Notes |
|---|---|---|---|---|
| 1 | **Qdrant** — the vector DB | `./qdrant_bin/qdrant.exe` | 6333 (REST), 6334 (gRPC) | Native binary. Data lives in `./storage/`. |
| 2 | **TEI** — the embedding model | `docker compose up -d tei` | 8080 | Serves BGE-M3. Model is cached; healthy in ~20 s. |
| 3 | **Ollama** — the answer LLM | `ollama serve` | 11434 | Usually already running. Model `qwen2.5:3b-instruct`. |
| 4 | **retrieval-svc** — our service | `node src/service/server.js` | 8090 | The thing that actually answers. |

## Step by step

```bash
# 1. Qdrant — own terminal, leave it running
./qdrant_bin/qdrant.exe

# 2. Docker Desktop: launch it from the Start menu and wait for it to be ready. Then:
docker compose up -d tei

# 3. Ollama — check it is up; start it only if not
curl http://127.0.0.1:11434/api/tags

# 4. Load the data into Qdrant (~2.2 min; see the warning below about --rebuild)
npm run ingest:rebuild

# 5. The service — own terminal, leave it running
node src/service/server.js

# 6. Confirm
curl http://127.0.0.1:8090/healthz
```

A healthy system answers:

```json
{"ok":true,"qdrant":true,"tei":true,"llm":true,"collection":"laila_knowledge","points":409}
```

and the service prints:

```
retrieval-svc + sandbox console on http://127.0.0.1:8090
(auth on, draft content VISIBLE, Qdrant http://localhost:6333, TEI http://localhost:8080, LLM qwen2.5:3b-instruct)
```

**Read that banner.** `auth on` and `draft content VISIBLE` are the two facts that most
change how the thing behaves — see [[Safety and security]].

## Poking at it

- **Sandbox console** — open `http://127.0.0.1:8090/` in a browser. Easiest way to try a query.
- **From the shell** — every `/v1/*` call needs the bearer token from `.env`:

```bash
TOKEN=$(grep -E "^SERVICE_TOKEN=" .env | cut -d= -f2-)
curl -s -X POST http://127.0.0.1:8090/v1/retrieve \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"how much is the daily unlimited 4G?","top_k":2}'
```

> [!danger] Do not put Arabic or Kurdish in a `curl -d` string on Windows
> Git Bash mangles the UTF-8 and the service returns **zero chunks** — which looks exactly
> like broken multilingual retrieval and is not. Use a Node one-liner with `fetch` and a
> `JSON.stringify` body, or the sandbox console in the browser. This has already cost one
> false alarm.

## Every command

| Command | What it does |
|---|---|
| `npm run ingest` | Incremental load — only re-embeds entities whose content hash changed |
| `npm run ingest:rebuild` | Drops and recreates the collection. **Required after a chunker or schema change** |
| `npm run ingest:dry` | Validates and prints the chunks it *would* write. Writes nothing |
| `npm run bundles:import` | FEBRA export → seed entities ([[Content pipelines]]) |
| `npm run logs:extract` | Raw log export → labellable CSV ([[Content pipelines]]) |
| `npm run utterances:import` | Labelled CSV → intent examples + gold items |
| `npm run eval` | The gate: Hit@5, routing accuracy, false-route ([[Evaluation]]) |
| `npm run eval:sweep` | Threshold calibration sweep |
| `npm run gaps` | What the corpus could not answer |
| `npm run redteam` | Adversarial safety suite. **Needs the service running** |
| `npm run sanity:kurdish` | Kurdish eyeball check + model licence check |
| `npm test` | Unit suite — offline, no stack needed |
| `npm run test:serial` | Same, one file at a time (see [[Troubleshooting]]) |

## Why `--rebuild` matters

Ingestion is incremental and keyed on a **content hash of each entity**. That makes re-runs
cheap, but it has a blind spot: *a change to the chunker or the payload shape is invisible to
the hash*, because the entity file did not change. The index then silently keeps the old
chunks.

Rebuild whenever:
- the chunker, payload shape or embedding model changed,
- `.ingest-state.json` came from another machine,
- you are not sure.

## Local config that is NOT in git

`.env` is gitignored, so these live only on this machine. They are documented in the tracked
`.env.example`; a fresh box has to reapply them.

| Setting | Value here | Why |
|---|---|---|
| `EMBED_TIMEOUT_MS` | `30000` | The 10 s default is a GPU-era number |
| `LLM_BASE_URL` | `http://localhost:11434/v1` | Local Ollama |
| `LLM_MODEL` | `qwen2.5:3b-instruct` | |
| `LLM_TIMEOUT_MS` | `240000` | **Not optional.** This CPU runs the 3B model at ~9 tok/s |
| `LLM_REWRITE_TIMEOUT_MS` | `90000` | Same reason |
| `SERVICE_TOKEN` | *(set)* | Auth. An unset token would disable the gate — see [[Safety and security]] |
| `ANSWER_RELEVANCE_FLOOR` | default `0.55` | Below this cosine relevance `/v1/answer` declines instead of composing. `0` disables it — see [[Evaluation]] |

> [!warning] The timeouts are not cosmetic
> At the hosted defaults (60 s / 15 s) generation expires mid-answer and **every question
> falls back to the safe canned reply**. It does not look like a timeout; it looks like the
> model has nothing to say. Drop them back only on a GPU or hosted box.

The committed `docker-compose.yml` also carries `--max-client-batch-size 32`,
`--max-batch-tokens 4096` and `mem_limit: 6g`. **The batch size must stay ≥ 24**, because
`embedder.js` sends batches of 24 — at 16 ingestion dies on
`422 batch size 24 > maximum allowed batch size 16`.

## Measured on this machine

| | |
|---|---|
| Single embed (TEI) | ~84 ms |
| Full rebuild, 75 entities | ~132 s |
| Unit suite | ~150 s |
| Eval run | ~4 min |
| Index | 75 entities / 409 chunks |

Related: [[Troubleshooting]] · [[Architecture]] · [[Endpoints]]
