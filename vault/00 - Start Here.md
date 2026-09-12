---
title: Start Here
tags: [index, laila]
updated: 2026-09-12
---

# Laila Knowledge Base — vault

This is the **operator's vault** for the Laila Knowledge Base: how to run it, what each piece
does, and where every fact in it came from.

> [!info] What this vault is and is not
> - **This vault** = how the thing works and how to run it. Read it first.
> - **`docs/00–28`** (in the repo) = the *design contract*. It is the authority on intended
>   behaviour. Read it before changing behaviour.
> - **`README.md`** (in the repo) = the *running state log*. It is the authority on what is
>   done, what is broken, and what is next.
>
> When this vault and `docs/` disagree about intent, `docs/` wins. When this vault and
> `README.md` disagree about current state, `README.md` wins.

## In one paragraph

Laila is Asiacell's customer-facing agent. This project is the **knowledge and routing engine
behind it**: it holds bundle and service knowledge as embedded text in a vector database, and
answers two questions for the agent — *"what do we know that is relevant to this message?"*
(retrieval) and *"which flow should this message go to?"* (routing). It speaks English,
Iraqi Arabic, Sorani Kurdish and Badini Kurdish.

## Start here

| I want to… | Go to |
|---|---|
| Get it running on this laptop | [[Running the stack]] |
| Try it out and judge it | [[Testing it yourself]] |
| Fix something that broke | [[Troubleshooting]] |
| Understand how it works | [[Architecture]] |
| Understand the data | [[Data model]] |
| Add real content | [[Content pipelines]] |
| Call the API | [[Endpoints]] |
| Know if it is any good | [[Evaluation]] |
| Know what protects it | [[Safety and security]] |
| Know what is left to do | [[Project state]] |
| Decode a term or a shortcode | [[Glossary]] |

## The 30-second version of running it

```bash
./qdrant_bin/qdrant.exe          # terminal 1 — leave running
# start Docker Desktop by hand, then:
docker compose up -d tei         # terminal 2
npm run ingest:rebuild           # ~2.5 min
node src/service/server.js       # terminal 3 — leave running
curl http://127.0.0.1:8090/healthz
```

Full detail and every trap: [[Running the stack]].

## Current state, one line

Phase 0 + Phase 1 done, engineering backlog empty, **real Asiacell content in the index**
(73 entities / 402 chunks). Retrieval passes its gate; **routing does not**, and cannot until
real customer utterances arrive. See [[Project state]].
