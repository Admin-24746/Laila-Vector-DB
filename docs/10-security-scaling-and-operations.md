# 10 — Security, Scaling & Operations

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> How the system runs safely and reliably — and how it scales from one laptop to "all of Iraq" without
> re-architecting. Recall the core fact: **small corpus, huge traffic** (doc 00 Principle 4) → scaling is
> about caching + replicas, not big-data search.

---

## 1. Security

| Area | Approach |
|------|----------|
| **Data sensitivity** | Corpus is bundle/service config — **no customer PII** (a deliberate non-goal, doc 01). Low blast radius. |
| **PII stays out** | Live customer state comes from BSS/CDR at request time and is **never stored** in Qdrant or logs. |
| **Service auth** | Service-to-service token between Druid and the engine; engine on the internal network only. |
| **Secrets** | API keys / tokens in a secret store / env, never in the repo. |
| **Authoring access** | Knowledge edits go through Git review (doc 07); only approved authors merge. |
| **At rest / in transit** | TLS between services; disk encryption on the prod VM per company policy. |
| **Logs** | Queries + scores only, PII-free (doc 13 §7). **Retention:** kept until needed for diagnosis, then deleted — **must be easy to purge** (delete by date/filter, optional TTL). No fixed window for now. |

## 2. Scaling model

```
            ┌── cache hit (most traffic) ──────────────► instant
 request ──►│
            └── miss ─► embed (TEI) ─► search (Qdrant) ─► answer
                          ▲ scale by GPU/replicas   ▲ scale by replicas; corpus in RAM
```

- **Stateless retrieval service** → scale horizontally behind a load balancer (add instances).
- **Cache absorbs repeats** → at high QPS the *same* questions dominate; cache carries most load.
- **Qdrant** → whole corpus in RAM (tiny); add **replicas** for read throughput + HA.
- **Embedding (TEI)** → the heaviest component; scale with **GPU replicas**; batch on ingest, single on query.
- **No re-architecture needed** between prototype and prod — same components, more replicas.

## 3. Caching (the main scaling lever)

- **Where:** in front of `retrieve()`/`/route` (doc 06 §6, doc 08).
- **Key:** `{normalized_query, filters, type}` (after query-understanding normalization, doc 12).
- **TTL:** short-to-medium; **invalidate on re-ingest** of affected entities (tie to doc 07 hashes).
- **Tech (RESOLVED):** **alpha/laptop = in-process LRU cache** (zero infra, in-RAM, microsecond hits);
  **production = Redis** (shared across replicas, sub-millisecond). Both meet the hard **ms latency** bar.
- **Latency rule (customer cannot wait):** the customer-facing path is budgeted in **milliseconds**.
  Cache hits return in **well under 1 ms**; only cold misses pay embed+search (~tens of ms). Caching is the
  primary lever to keep it fast at scale.

## 4. Availability & resilience

| Concern | Handling |
|---------|----------|
| Component down | **Graceful degradation:** on engine/embedding failure, Druid falls back to current dispatcher logic (doc 06 §7) |
| Qdrant node loss | Replication (Phase 2 cluster); snapshots for restore |
| Health | `/health` + readiness probes on every service |
| Backups | Qdrant snapshots; **and** the corpus is fully **reproducible by re-ingest** (doc 07) → relaxed RPO |
| Deploys | Versioned API (`/v1`), rolling updates, shadow-test routing changes (doc 08 §6) |

## 5. Observability

- **Metrics:** QPS, latency (p50/p95) per endpoint, cache hit-rate, **no-match rate**, **routing
  confidence distribution**, **grounded-answer rate**, embedding service health.
- **Quality signals:** the doc-13 feedback signals (low-score, abstain, guardrail blocks) surfaced on a
  dashboard.
- **Logs/tracing:** structured logs per call; trace IDs across Druid → engine → Qdrant/TEI.
- **Alerts:** embedding service down, error-rate spike, no-match-rate spike (content drift), latency breach.

## 6. Deployment topology

```
 Alpha (now):       docker-compose on the laptop (RTX 5060 / 32GB) —
                    [ retrieval-svc (JS) ] [ TEI/BGE-M3 (GPU) ] [ Qdrant ] [ in-process cache ]

 Production (later): same 4 containers on the VM, each replicated as needed,
                     behind a load balancer; Qdrant clustered; monitored.
```

## 7. Cost shape

- **Self-hosted, open-source** → no per-query license/API cost (a core goal). Main cost = the VM + GPU.
- Optional cloud embedding fallback would add per-call cost → kept as fallback only (doc 04).

## 8. Open items to confirm

- [x] **Cache** — in-process LRU for alpha (laptop), Redis for production. Both sub-ms. ✅ RESOLVED.
- [x] **Log retention** — keep until an issue arises, then delete; designed for **easy purge** (by date/filter / TTL). ✅ RESOLVED.
- [x] **VM** — **alpha runs on the RTX 5060 / 32GB laptop**; production VM specs decided later. ✅ RESOLVED.
- [ ] Confirm company **TLS / disk-encryption** requirements to bake in (when prod VM is chosen).
