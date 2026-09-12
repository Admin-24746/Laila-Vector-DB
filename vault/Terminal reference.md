---
title: Terminal reference
tags: [runbook, reference, laila]
updated: 2026-09-12
---

# Terminal reference

Every command, what it does, what it prints, what it costs. Run from the repo root
(`D:\Projects\DevOps\Vector DB`). Timings are measured on this laptop.

> [!info] Shell
> Examples are Git Bash / POSIX. In PowerShell the only differences that bite are
> `$env:VAR = "x"` instead of `VAR=x cmd`, and `2>$null` instead of `2>/dev/null`.

## Bring it up — the four commands

```bash
./qdrant_bin/qdrant.exe          # 1. Qdrant, native. Own terminal, leave running
docker compose up -d tei         # 2. TEI (start Docker Desktop by hand first)
npm run ingest:rebuild           # 3. load the data — 132 s, 75 entities, 409 chunks
node src/service/server.js       # 4. the service. Own terminal, leave running
```

Then `curl http://127.0.0.1:8090/healthz` → `{"ok":true,…,"points":409}`.

Full detail and the traps: [[Running the stack]]. Docker specifics: [[Docker]].

## Ingestion

| Command | Does | Cost |
|---|---|---|
| `npm run ingest` | Incremental. Re-embeds only entities whose content hash changed | **~5 s** for one entity |
| `npm run ingest:rebuild` | Drops and recreates the collection from scratch | **~132 s** |
| `npm run ingest:dry` | Validates and prints the chunks it *would* write. Writes nothing | ~2 s |

```
Entities: 75 valid (1 changed, 74 unchanged, 0 rejected) → 7 chunks to write
Embedding… 7/7
Done in 4.8s — upserted 7 chunks for 1 entities; collection now holds 416 points.
```

Read that line. `rejected` above 0 means an entity failed validation and is **not** in the
index — `ingest:dry` prints the reason. `⚠` lines are warnings (usually
`names missing required languages: kmr`) and do not block.

When to rebuild rather than ingest: after a chunker, payload or model change, or when
`.ingest-state.json` came from another machine. The hash cannot see code changes —
[[Managing the data]].

## Content pipelines

```bash
npm run bundles:import                        # FEBRA export → seed entities + a report
npm run bundles:import -- --dry-run           # report only, writes nothing
npm run bundles:import -- --src "<dir>"       # a different export directory

npm run logs:extract -- <export> --inspect    # sniff a log export's format, write nothing
npm run logs:extract -- <export>              # → content-kit/utterances-<date>.csv
#   ... a human fills in intent_id ...
npm run utterances:import -- <csv> --dry-run  # report the 80/20 split
npm run utterances:import -- <csv>            # write intent examples + gold items
npm run utterances:import -- <csv> --merge    # ADD to existing examples instead of replacing
```

[[Content pipelines]] explains what each refuses to do and why.

## Testing

| Command | Does | Cost |
|---|---|---|
| `npm run probe` | Pass/fail over real questions **including the refusals** | ~5 s |
| `npm run probe -- --answers` | Also the LLM path | ~3–4 min |
| `npm run probe -- --verbose` | Print the replies, not just verdicts | — |
| `npm test` | Unit suite, 190 tests. Offline | ~150 s |
| `npm run test:serial` | Same, one file at a time (entropy race) | ~200 s |
| `npm run eval` | The gate: Hit@5, routing, false-route | ~4 min |
| `npm run eval:sweep` | Threshold calibration sweep | ~5 min |
| `npm run gaps` | What the corpus could not answer | ~1 min |
| `npm run redteam` | 21 adversarial items. **Needs the service + an LLM** | ~9 min |
| `npm run sanity:kurdish` | Kurdish eyeball check + model licence | ~1 min |

A single test file, when you are iterating:

```bash
node --test test/febra.test.js
node --test test/answer-guards.test.js
```

[[Testing it yourself]] has the copy-paste questions and expected facts.

## Calling the service

The bearer token lives in `.env`. Grab it once per shell:

```bash
TOKEN=$(grep -E "^SERVICE_TOKEN=" .env | cut -d= -f2- | tr -d '\r')
```

```bash
# retrieval
curl -s -X POST http://127.0.0.1:8090/v1/retrieve \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"how much is the daily unlimited 4G?","top_k":3}'

# with filters, a language lock, and the full entity card
  -d '{"text":"…","language":"ar","filters":{"location":"basra","service_class":"yooz"},
       "top_k":5,"expand":true}'

# routing
curl -s -X POST http://127.0.0.1:8090/v1/route \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"can you lend me some balance please"}'

# a composed answer (17-57 s on this CPU)
curl -s -X POST http://127.0.0.1:8090/v1/answer \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"how do I subscribe to RED 15?"}'

# a follow-up, with history
  -d '{"text":"and how do I cancel it?",
       "history":[{"role":"user","text":"tell me about RED 15"}]}'

# health — no auth
curl -s http://127.0.0.1:8090/healthz
```

> [!danger] Never put Arabic or Kurdish inside a `curl -d` on Windows
> Git Bash mangles the UTF-8 and you get **zero chunks** — indistinguishable from broken
> multilingual retrieval, and it has already caused one false alarm. Use the sandbox console
> at `http://127.0.0.1:8090/`, or Node:
>
> ```bash
> TOKEN=$TOKEN node -e '
> fetch("http://127.0.0.1:8090/v1/retrieve",{method:"POST",
>   headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.TOKEN}`},
>   body:JSON.stringify({text:"شكد سعر باقة تيك توك الاسبوعية؟",top_k:2})})
>   .then(r=>r.json()).then(j=>console.log(JSON.stringify(j.grounded_facts)));'
> ```

Getting `401 unauthorized`? That is the auth gate working — only `/healthz` and the console
page are open. In the console, paste the token into the box top-right once; it is kept in
`localStorage`.

## Talking to Qdrant directly

No auth, loopback only. Read-only calls are safe; see [[Managing the data]] for the
destructive ones and why you rarely want them.

```bash
curl -s http://127.0.0.1:6333/collections                      # list collections
curl -s http://127.0.0.1:6333/collections/laila_knowledge      # config + point count

# count / list / inspect one entity's points
curl -s -X POST http://127.0.0.1:6333/collections/laila_knowledge/points/count \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"must":[{"key":"entity_id","match":{"value":"bundle_1684"}}]},"exact":true}'
```

## Talking to TEI and Ollama directly

```bash
curl http://127.0.0.1:8080/health                  # TEI ready?
curl http://127.0.0.1:8080/info                    # → BAAI/bge-m3, float32, max_input_length 4096
curl -X POST http://127.0.0.1:8080/embed -H 'Content-Type: application/json' \
  -d '{"inputs":["hello"]}' -o /dev/null -w '%{http_code} in %{time_total}s\n'

curl http://127.0.0.1:11434/api/tags               # which Ollama models are installed
ollama list                                        # → qwen2.5:3b-instruct, 1.9 GB
ollama run qwen2.5:3b-instruct "say hi"            # talk to the answer model directly
```

## Stopping things

```bash
# the service — Ctrl-C in its terminal. If you lost the terminal:
netstat -ano | grep LISTENING | grep ":8090"       # find the PID (last column)
taskkill //PID <pid> //F                            # Git Bash needs the doubled slashes

docker compose stop tei                             # TEI, keeping the model cache
# Qdrant — Ctrl-C in its terminal
```

> [!warning] Run the service as `node src/service/server.js`, not `npm run serve`
> Under npm the server is a child process; killing the task orphans the child and the port
> stays taken.

## Config knobs worth knowing

Set in `.env`, or inline for one run (`VAR=value npm run …`).

| Variable | Default | Effect |
|---|---|---|
| `TOP_K` | 5 | Default chunks returned |
| `ANSWER_RELEVANCE_FLOOR` | 0.55 | Below this cosine, `/v1/answer` declines. `0` disables |
| `EXCLUDE_DRAFT` | unset | `1` hides draft content → **currently empties the index** |
| `NODE_ENV` | unset | `production` implies `EXCLUDE_DRAFT=1` |
| `ROUTE_TAU_HIGH` / `ROUTE_TAU_LOW` / `ROUTE_MARGIN` | 0.8 / 0.6 / 0.05 | Routing thresholds |
| `EMBED_TIMEOUT_MS` | 30000 here | 10 s default is a GPU-era number |
| `LLM_TIMEOUT_MS` / `LLM_REWRITE_TIMEOUT_MS` | 240000 / 90000 here | Not optional on this CPU |
| `COLLECTION` | `laila_knowledge` | Point at a throwaway collection for experiments |
| `INGEST_STATE_FILE` | `.ingest-state.json` | So a test cannot clobber the live state |
| `SERVICE_TOKEN` | set | The bearer token. Unset **disables the auth gate** |

> [!warning] An empty numeric is not an absent one
> `ROUTE_TAU_HIGH=` (present, empty) used to become `0` and make the router confidently route
> garbage. `coerceNum()` now falls back to the default and warns — but the general lesson
> stands: delete the line, do not blank it.

## Git

```bash
git status -sb
git log --oneline -10
git diff                                  # unstaged
git push                                  # branch: fix/audit-blocking-issues
```

The branch is pushed but **not merged** and has no PR. `master` is still at the pre-audit
state.

Related: [[Running the stack]] · [[Docker]] · [[Managing the data]] · [[Troubleshooting]]
