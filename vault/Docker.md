---
title: Docker
tags: [runbook, docker, laila]
updated: 2026-09-12
---

# Docker

Only **one** service actually runs in Docker here: **TEI**, the embedding model. Qdrant is
defined in the compose file but you must **not** start it — see the trap below.

```
docker-compose.yml  project name: laila-kb
├── qdrant   ⛔ DEFINED BUT DO NOT START — a different, empty database
└── tei      ✅ the one you run
```

> [!danger] The single most expensive mistake in this project
> `docker compose up -d` (no service name) starts **both**, and the Docker Qdrant has its own
> volume — a separate, empty database. The app then talks to an index with no content and
> everything looks broken for no reason.
>
> This has already happened on this machine. There is a stopped container to prove it:
> ```
> laila-qdrant   Exited (143) 2 weeks ago   qdrant/qdrant:latest
> laila-kb_qdrant_storage   460.3MB   ← the abandoned database
> ```
> Meanwhile the **real** data is the native binary's, in `./storage` (759 MB on disk).
>
> **Always name the service: `docker compose up -d tei`.**

## Everyday commands

```bash
docker compose up -d tei          # start TEI (healthy in ~20 s, model already cached)
docker compose ps                 # what is running
docker compose logs -f tei        # follow the logs (Ctrl-C to stop following)
docker compose logs --tail 50 tei # last 50 lines and exit
docker compose restart tei        # after changing its command/limits in the compose file
docker compose stop tei           # stop, keep the container and the model cache
docker compose start tei          # start it again
```

Health, straight from TEI rather than through our service:

```bash
curl http://127.0.0.1:8080/health                 # 200 when ready
curl http://127.0.0.1:8080/info                   # → BAAI/bge-m3, float32, max_input_length 4096
curl -X POST http://127.0.0.1:8080/embed \
  -H 'Content-Type: application/json' \
  -d '{"inputs":["hello"]}' -o /dev/null -w '%{http_code} in %{time_total}s\n'
#   → 200 in ~0.08s
```

## What is on disk

| Thing | Name | Size here |
|---|---|---|
| TEI image | `ghcr.io/huggingface/text-embeddings-inference:cpu-latest` | 938 MB |
| Qdrant image (unused) | `qdrant/qdrant:latest` | 275 MB |
| **TEI model cache** | volume `laila-kb_tei_cache` | **2.285 GB** |
| Abandoned Docker-Qdrant data | volume `laila-kb_qdrant_storage` | 460 MB |
| **The real index** | `./storage` (native binary, not Docker) | **759 MB** |

```bash
docker compose ps                 # containers
docker volume ls | grep laila     # volumes
docker system df -v               # sizes, including per-volume
```

## Destructive commands — read the difference

```bash
docker compose down               # stop + remove containers. Volumes SURVIVE. Safe.
docker compose down -v            # ⛔ ALSO DELETES THE VOLUMES
```

> [!warning] `down -v` costs you a 2.3 GB re-download
> It removes `laila-kb_tei_cache`, so the next `up` pulls BAAI/bge-m3 again from scratch.
> It does **not** touch `./storage` (the real index is not in a volume), so your data
> survives — but there is no reason to do it. Use `docker compose down` if you want a clean
> container.

Reclaiming the genuinely dead thing is safe:

```bash
docker rm laila-qdrant                        # the stopped container from the mistake above
docker volume rm laila-kb_qdrant_storage      # and its 460 MB of empty database
```

Nothing in the working setup references either. Do it only if you want the disk back.

## The TEI configuration, and why it is what it is

From the committed `docker-compose.yml`:

```yaml
command: --model-id BAAI/bge-m3 --max-client-batch-size 32 --max-batch-tokens 4096
mem_limit: 6g
ports: ["8080:80"]      # TEI listens on 80 INSIDE the container
volumes: [tei_cache:/data]
```

> [!warning] `--max-client-batch-size` must stay ≥ 24
> `src/lib/embedder.js` sends batches of 24. At 16, ingestion dies with
> `422 batch size 24 > maximum allowed batch size 16`. The old notes said 16; they were wrong.

The batch/memory numbers are sized for this laptop (4c/8t, no CUDA, 15.8 GB RAM). The
GPU-era defaults (16384 / 64) make a CPU batch take minutes and push the container past the
WSL memory budget.

## GPU

The compose file carries a commented-out GPU variant. The RTX 5060 is Blackwell (sm_120) and
needs a TEI build with CUDA 12.8+. Try the GPU image once; fall back to CPU if it fails. CPU
latency is fine for this corpus — a single embed is ~84 ms, a full 409-chunk rebuild ~132 s.

## When Docker itself is the problem

**Docker Desktop does not autostart on this machine** (since the 2026-09-10 performance
pass). Launch it from the Start menu and wait for the whale icon to settle. Until then every
`docker` command fails with:

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

That is not a compose problem — it means the engine is not up yet.

Related: [[Running the stack]] · [[Managing the data]] · [[Terminal reference]]
