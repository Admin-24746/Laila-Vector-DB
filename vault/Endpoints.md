---
title: Endpoints
tags: [api, laila]
updated: 2026-09-12
---

# Endpoints

Contract: `docs/08`. Base `http://127.0.0.1:8090`. Every `/v1/*` call needs
`Authorization: Bearer $SERVICE_TOKEN`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/retrieve` | Knowledge retrieval → chunks + `grounded_facts` + `bucket_hint` |
| `POST /v1/route` | Semantic router → `{flow, confidence, action, reason}` |
| `POST /v1/answer` | Retrieve + compose + guardrail + safety |
| `GET /healthz` | Dependency health + point count. **No auth** |
| `GET /` | Sandbox console (browser) |

## `POST /v1/retrieve`

```jsonc
// request
{
  "text": "how much is the daily unlimited 4G?",
  "language": "en",                       // optional; detected if absent
  "filters": { "location": "basra", "service_class": "red" },  // optional
  "top_k": 5,
  "expand": false                          // true → full entity card
}
```

```jsonc
// response
{
  "chunks": [ { "chunk_id": "bundle_2017::overview::en", "score": 0.833, "text": "…", "…": "…" } ],
  "grounded_facts": { "price_iqd": 3000, "validity_days": 1, "bundleId": 2017 },
  "bucket_hint": "B"
}
```

`grounded_facts` is the machine-readable answer — use it rather than parsing prose. It comes
from the top result's payload, so it is only as good as the entity behind it.

> [!danger] `score` is not a confidence. `relevance` is.
> `score` is a fused **rank** score (RRF). It orders the list well and says nothing about
> whether anything in the list is relevant: *"what is Eshrat Omar?"* — a programme the corpus
> only ever names — came back at **score 1.00**. Threshold on **`relevance`** (raw cosine) or
> on the response's **`max_relevance`**.
>
> Measured 2026-09-12 over 17 probes: answerable questions **0.588–0.740**, questions the
> corpus cannot answer **0.346–0.610**. That is the separation the floor uses, and it is
> genuinely tight at the boundary — treat it as a gate, not a truth.

## `POST /v1/route`

```jsonc
{ "text": "can you lend me some balance please" }
→ { "flow": "loan_flow", "confidence": 0.77, "action": "clarify",
    "reason": "top intent_loan::example_2::en (0.766) below τ_high 0.8 — ask to confirm" }
```

`action` is `route` | `clarify` | `fallback`. **`reason` is human-readable on purpose** — it
is what makes a bad routing decision debuggable without re-running the model.

## `POST /v1/answer`

Retrieval + LLM composition (docs/15 prompt) + the number-grounding guardrail + the injection
filter and leak guard. Also accepts `history` (OpenAI-style turns) for follow-ups.

> [!warning] A 200 from `/v1/answer` is not proof the LLM worked
> When the LLM is misconfigured or times out, the endpoint returns **200 with the safe
> fallback**, not an error. Check the banner and the timeouts — see [[Troubleshooting]].

> [!important] `grounded: true` does not mean "answered"
> An honest "I don't have that detail" is grounded. **`abstained: true`** is the flag that
> says the service declined. Three things can raise it: nothing retrieved, the relevance
> floor firing, or — separately — the guardrail blocking, which shows as `grounded: false`.
>
> A caller that wants to escalate to a human should look at `abstained` and `grounded`
> together, not at `grounded` alone.

**The relevance gate.** Before composing, `/v1/answer` checks `max_relevance` against
`CONFIG.answerRelevanceFloor` (default 0.55). Below it, the service answers from a fixed
message and **never calls the LLM** — there is nothing for the model to invent from. This
exists because a 3B model, handed five irrelevant chunks, invented the same false definition
three runs out of three ([[Safety and security]]).

The response carries a `guardrail` block. `violations` can contain bare digits,
`misattributed_number` or `unsupported_magnitude`. A `grounded: false` answer means the
guardrail caught something and the safe fallback was served instead.

## Failure contract

All dependency failures collapse to one shape, so a caller never has to special-case them:

| Situation | Response |
|---|---|
| TEI / Qdrant down | `503 dependency_unavailable` with `{dependency: "tei" \| "qdrant"}` |
| LLM down during follow-up rewrite | **200** on the raw query — the rewrite is optional |
| LLM down during compose | **200** with the guardrail fallback, `grounded: false` |
| Retrieval failed on `/v1/answer` | `503` — the LLM is never invoked without evidence |
| Malformed JSON body | 4xx, never 500/503 |
| Missing `text` | 200 in the pinned empty shape |
| Unexpected internal error | `500 internal_error`, still JSON |

All sixteen of these are pinned in `test/resilience.test.js`.

## Auth

- The token is `SERVICE_TOKEN` in `.env`. The banner prints `auth on` or `auth OFF`.
- **Startup refuses** an unset token combined with a non-loopback `HOST`, and warns on loopback.
- The gate matches on the **routed path**, not `req.url` — see [[Safety and security]] for why
  that distinction was a critical vulnerability.

Related: [[Safety and security]] · [[Architecture]] · [[Running the stack]]
