---
title: Troubleshooting
tags: [runbook, laila]
updated: 2026-09-12
---

# Troubleshooting

Every entry below has actually happened on this machine. Symptom first.

## The stack

### `/healthz` says `qdrant:false`
Qdrant is not running, or you started the wrong one. Check `curl http://127.0.0.1:6333/collections`.
If it answers but `points` is 0 or the collection is missing, you started the **Docker**
Qdrant instead of the native binary — they are different databases. Stop it, run
`./qdrant_bin/qdrant.exe`, and re-ingest. See [[Running the stack]].

### `/healthz` says `tei:false`
Docker Desktop is probably not running — it does not autostart here. Start it, wait, then
`docker compose up -d tei`. Confirm with `curl http://127.0.0.1:8080/health` (expects 200).

### `/healthz` says `llm:false`
Ollama is down: `curl http://127.0.0.1:11434/api/tags`. Start it, or install/pull
`qwen2.5:3b-instruct`.

### Port 8090 is already in use after stopping the server
You started it with `npm run serve` and the node child was orphaned. Kill the stray node
process. Always run `node src/service/server.js` directly.

## Ingestion

### `422 batch size 24 > maximum allowed batch size 16`
TEI's `--max-client-batch-size` is below the embedder's batch size of 24. The committed
compose file sets 32. Someone lowered it — put it back.

### Entities rejected during ingest
`npm run ingest:dry` prints each rejection with its reason. The validator is strict on
purpose; see [[Data model]] for the rules. Common ones:
- a `bundle` without an integer `bundleId`, `price_iqd` or `validity_days`,
- `conflicts_with` / `belongs_to_service` pointing at an entity that does not exist,
- `repeat_purchase_threshold: 0` — it renders as an ordinal ("from the 0th subscription").

### Warnings about `names missing required languages: kmr`
Expected, not a fault. Badini (kmr) copy is absent from the FEBRA export and was deliberately
**not** machine-translated. ~50 entities warn. See [[Content pipelines]].

### A content change does not show up in answers
The content hash did not change (a chunker or payload change is invisible to it), or you ran
`npm run ingest` rather than `ingest:rebuild`. Rebuild.

## Retrieval and answers

### An Arabic or Kurdish query returns zero chunks from `curl`
Almost certainly **your shell, not the service.** Git Bash mangles non-Latin text inside a
`curl -d` string. Re-test with a Node `fetch` one-liner or the browser sandbox before
believing it. This produced one false "Arabic retrieval is broken" alarm on 2026-09-12.

### `/v1/answer` returns the safe fallback for everything, HTTP 200
Two causes, both common:
1. **LLM timeouts too low** — at the hosted defaults the 3B model on this CPU expires
   mid-generation. See the timeout table in [[Running the stack]].
2. **`LLM_BASE_URL`/`LLM_MODEL` are set but nothing is behind them.** `llmConfigured()` only
   checks the strings are non-empty, so a stale value yields HTTP 200 + fallback for every
   question instead of an honest 503. Blank them to get the 503 back.

### An answer comes back `grounded: false` with `misattributed_number`
Working as designed. The guardrail binds each number to the entity whose evidence carries it;
a price borrowed from a *different* bundle in the same top-5 is reported rather than served.
See [[Safety and security]].

### Answers mix scripts (Chinese characters inside Arabic)
Also caught by design — `scriptViolations` fails the guardrail, forces a strict retry, then
the safe fallback. Latin is deliberately *not* flagged (brand names like "Super Net" are
legitimately Latin in Arabic text).

## Tests

### One whole test file fails with no failing assertion
> [!info] This is the known entropy race, not a regression
> At high concurrency Node itself crashes at startup on this machine —
> `Assertion failed: ncrypto::CSPRNG(nullptr, 0)` — and the runner reports whole files as
> failed with nothing behind them. `npm test` is capped at `--test-concurrency=2`, which
> makes it rare but **not impossible**: `test/resilience.test.js` did it once on 2026-09-12
> and then passed 16/16 alone and on the next full run.
>
> **Re-run before investigating.** `npm run test:serial` forces one file at a time.

### `npm run redteam` fails to connect
It needs the service running and an LLM behind it. It is an end-to-end suite, not a unit test.

Related: [[Running the stack]] · [[Safety and security]] · [[Evaluation]]
