# 19 — Error Handling & Resolution Knowledge

**Status:** 🟡 Draft (error sources need your confirmation) · **Owner:** Yousif · **Last updated:** 2026-06-28

> **Today:** when a flow hits an error (e.g. a Baghdad line tries to buy a Sulaymaniyah-only bundle), the
> system **transfers the customer to a human agent**. **Goal:** stop the automatic escalation — look the
> error up in the vector DB, validate it, and **explain it to the customer with a resolution**, escalating
> only when we genuinely can't. Resolves **D12**.

---

## 1. Why this matters

Errors are a huge share of escalations, and most are *explainable* ("this bundle is only available in
Sulaymaniyah"). Turning errors into clear answers **cuts human handoffs** and frustration — a direct,
measurable win (escalation-reduction is a KPI in doc 09).

## 2. New entity type: `type: error`

```jsonc
{
  "id": "err_bundle_region_mismatch",
  "type": "error",
  "source_system": "BSS",                       // where the error came from
  "match": {                                     // how we recognize it
    "codes": ["E-4012", "REGION_NOT_ELIGIBLE"],  // stable code(s) if any
    "message_patterns": ["not eligible in", "region mismatch", "ناوچە"]  // text fallbacks
  },
  "cause": { "en": "The bundle is restricted to a region the line doesn't belong to.", … },
  "customer_explanation": {                      // grounded, human-friendly, per language
    "en": "This bundle is only available in Sulaymaniyah, so it can't be activated on your line's region.",
    "ar": "…", "ckb": "…", "kmr": "…" },
  "resolution": { "en": "Here are bundles available in your area instead…", … },
  "related": { "flow": "purchase_bundle", "entity_type": "bundle" },
  "severity": "info",
  "auto_explain": true,                          // false → always escalate to human
  "escalate_if": ["payment failure", "fraud", "unknown"]
}
```

## 3. How errors are recognized (two paths)

| Path | When | Lookup |
|------|------|--------|
| **By code** (preferred) | API/BSS returns a stable error code | exact **metadata filter** on `match.codes` |
| **By message text** | only a raw message is available | **semantic + sparse** search on `match.message_patterns` |

Same hybrid engine (doc 06) — codes use filtering, messages use search.

## 4. Runtime flow

```
 flow calls a function (e.g. purchase_bundle) ──► returns ERROR (code/message)
        │
        ▼
 look up error in vector DB  (by code → fallback to message search)
        │
   ┌────┴───────────────────────────────────────────┐
   │ found, auto_explain=true, confidence high       │ → compose grounded explanation + resolution
   │                                                 │   → answer customer (NO escalation)
   ├─────────────────────────────────────────────────┤
   │ not found / low confidence / auto_explain=false │ → escalate to human (safe fallback, as today)
   └─────────────────────────────────────────────────┘
```

> The human-handoff **safety net stays** — we just stop using it for errors we *can* confidently explain.

## 5. Prevent vs explain (two layers)

1. **Prevent (best):** before calling the purchase function, **pre-check eligibility** using the bundle's
   `conditions` metadata (location, service class — doc 02/06). If the Baghdad line isn't eligible for a
   Sully-only bundle, Laila says so **before** attempting → no error at all.
2. **Explain (fallback):** if an error still occurs (rules we didn't pre-check, backend issues), the error
   catalogue explains it.

Both use the same vector DB; together they minimize escalations.

## 6. Guardrails (don't make errors worse)

- The explanation must be **grounded** in the error entry — never invent a cause or a fix (doc 08 §3).
- **Confidence threshold + abstain** (doc 06): a *wrong* error explanation is harmful → if unsure, escalate.
- `auto_explain=false` for sensitive classes (payment, fraud, account security) → always human.

## 7. Authoring & sourcing

- The **error catalogue is authored/mapped by you** (some from the API/BSS error list), via the doc-07
  workflow. Start with the **most frequent** errors (the ones driving today's escalations).
- Keep it in sync with backend error codes (reconciliation, doc 07 §8).

## 8. Evaluation (doc 09)

- **Error-explanation accuracy** (right cause + safe resolution) on a labeled error set.
- **Escalation-reduction rate** — % of error cases resolved without a human (the business KPI).
- **False-explain rate** — explained wrongly when it should have escalated (keep near zero).

## 9. Open items to confirm

- [ ] Do backend errors have **stable codes**, or only message text? (decides code-filter vs text-search)
- [ ] Where is the **error list** sourced (BSS doc / API / your mapping)?
- [ ] Which error classes must **always escalate** (payment, fraud, security…)?
- [ ] Provide the **top errors** driving today's escalations (seed set).
