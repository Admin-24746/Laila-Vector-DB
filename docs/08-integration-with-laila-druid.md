# 08 — Integration with Laila / Druid

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> This doc defines the **contract** between Laila/Druid and the retrieval engine: the API surface, how
> the dispatcher and flows call it, and the **answer grounding guardrail** that stops hallucinated
> prices/fees from reaching customers.

---

## 1. Integration shape

The retrieval engine is a **stateless JS HTTP service** Druid calls via **REST webhook / function-calling**
(doc: Druid supports both, plus custom connectors). Druid owns the conversation; our service answers one
question at a time.

```
   Druid (Laila)
     │  dispatcher turn ──────────► POST /route      ──► { flow, confidence, reason }
     │  inside a flow   ──────────► POST /retrieve    ──► { chunks[], grounded_facts }
     │  (optional)      ──────────► POST /answer       ──► { answer, citations, grounded }
     ▼
   our service ──► embed (TEI) ──► search (Qdrant) ──► [guardrail] ──► response
```

Three endpoints, all thin wrappers over the **one** `retrieve()` engine (doc 06 §1).

## 2. Endpoints (contract)

### `POST /route` — dispatcher / semantic router
```jsonc
// request
{ "text": "I need loan bundles", "language": "auto", "session_id": "abc",
  "history": [ {"role":"user","text":"…"}, … ] }       // optional, for context (doc 12)
// response
{ "flow": "loan_flow",            // or null if abstaining
  "confidence": 0.91,
  "alternatives": [ {"flow":"btl_flow","score":0.62} ],
  "action": "route",               // "route" | "clarify" | "fallback"
  "reason": "matched intent_loan_001 (0.91), margin 0.29" }
```
Druid uses `action`: **route** → go to `flow`; **clarify** → ask the returned clarifying question;
**fallback** → safe default. (Implements doc 06 §5 thresholds.)

### `POST /retrieve` — knowledge retrieval
```jsonc
// request
{ "text": "extra fee if I sub Combo 3 times?", "language": "auto",
  "filters": { "service_class": "red", "location": "baghdad" },   // optional
  "top_k": 5 }
// response
{ "chunks": [ { "text":"[Combo Bundle · BTL] … 2,500 IQD fee.",
                "entity_id":"bundle_combo", "section":"fees_edgecases",
                "score":0.88, "language":"en" } ],
  "grounded_facts": { "repeat_purchase_fee_iqd":2500, "price_iqd":5000 },  // structured metadata
  "bucket_hint": "B" }            // A=eligibility, B=lookup, C=reasoning (doc 00 §4)
```
The flow can either compose its own answer from `chunks`, or call `/answer`.

### `POST /answer` — retrieve + compose (convenience)
Runs `/retrieve` then an LLM (Gemini **or** ChatGPT — caller's choice) with a grounded prompt, returns a
finished, **guardrail-checked** answer + citations. Useful for flows that just want a reply.

## 3. The grounding guardrail (anti-hallucination)

Before any composed answer is returned, it passes a cheap check:

```
  1. Extract numbers/prices/fees the LLM stated.
  2. Verify each appears in `grounded_facts` or the retrieved chunk text.
  3. If a number is NOT supported → block the answer → retry once with stricter prompt,
     else return a safe "let me check that" / handoff instead of the unverified claim.
```

- **Why:** the costliest error is a confidently wrong **price/fee**. This catches exactly that class.
- **Grounding rule (from doc 06 §4):** the LLM answers **only** from provided chunks; if chunks are
  empty/irrelevant, it must say it doesn't know — enforced in the system prompt and re-checked here.
- Every answer carries `grounded: true/false` + `citations` so Druid can decide to escalate.

## 4. Division of labor (Principle 1, made concrete)

| Step | Owner |
|------|-------|
| Understand intent, route | `/route` (vector) + Druid |
| Decide **eligibility** (service class, whitelist, history) | **Druid flow → deterministic code / BSS-CDR APIs** — never our LLM |
| Resolve fuzzy bundle name → canonical id | `/retrieve` (entity resolution) |
| Fetch the right knowledge | `/retrieve` |
| Compose the wording | LLM via `/answer` (or the flow's own LLM) |
| Final verdict on eligibility | **Druid flow** (uses code result + our explanation chunk) |

> Our service **never** returns an eligibility verdict. For Bucket A it returns the *entity* and the
> *explanation text*; Druid's existing functions (e.g. `check CDR` → BSS) return the *facts*; the flow
> combines them. This keeps deterministic decisions in code.

## 5. Operational contract

- **Stateless** — every call self-contained (session/history passed in, not stored) → trivially scalable.
- **Latency budget** — `/route` and `/retrieve` target < 150 ms (doc 06); `/answer` adds LLM time.
- **Auth** — service-to-service token between Druid and the engine (internal network).
- **Versioned API** — `/v1/…` so contract changes don't break live flows.
- **Graceful failure** — on engine/embedding error, return a clear status so Druid falls back to current
  logic rather than hanging (doc 06 §7).
- **Observability** — every call logs `{endpoint, text, language, result, scores, latency, grounded}`
  (feeds docs 09 & 13).

## 6. Rollout into existing flows (low-risk)

1. **Shadow mode** — call `/route` alongside the current dispatcher, **log disagreements**, change
   nothing. Measures real-world routing accuracy before trusting it.
2. **Assist mode** — use `/retrieve` inside the knowledge flow for flow-builders first (low stakes, doc 00 §7).
3. **Active routing** — switch the dispatcher to `/route` for a few well-tested intents (e.g. loan), expand
   as eval (doc 09) proves each safe.

## 7. Open items to confirm

- [ ] Confirm **Druid calls REST webhooks** (vs needing a custom connector) and the auth method.
- [ ] Confirm flows want **`/answer`** (we compose) or only **`/retrieve`** (flow composes).
- [ ] Confirm **shadow-mode** rollout for routing is acceptable to start.
- [ ] Confirm the **guardrail behaviour** on an unverified number (retry-then-handoff vs just flag).
