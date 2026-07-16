# 22 — Analytics & Business KPIs

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> Doc 09 measures whether retrieval is *correct*. This doc measures whether the system delivers *business
> value* — the numbers that justify the project and guide where to invest. Essential for Phase-2 buy-in.

---

## 1. Headline KPIs

| KPI | Definition | Why it matters |
|-----|------------|----------------|
| **Containment / deflection rate** | % conversations resolved **without** a human | The core value: fewer agent escalations |
| **Escalation-reduction (errors)** | % of error cases explained by Laila vs handed off (doc 19) | Direct win from error handling |
| **Coverage** | % of questions that get a **confident** answer | How much of the domain we actually serve |
| **Content-gap volume** | # of low-score / no-match queries (doc 13) | The to-author backlog, ranked |
| **Routing accuracy** | % routed to the correct flow (doc 09) | Kills the misroute problem |
| **CSAT / feedback** | thumbs / satisfaction where available | Customer perception |
| **Latency (p95)** | customer-facing response time | Must stay in ms-to-low-seconds |
| **Language breakdown** | all KPIs **split by language** | Exposes Kurdish/Iraqi-Arabic performance (D5) |

## 2. Capability-specific metrics

- **Images (doc 18):** category accuracy, competitor false-accept rate, OCR success.
- **Errors (doc 19):** false-explain rate (must be ~0), top unresolved errors.
- **Flow-builder usage:** time saved authoring flows (the design-time consumer, doc 00 §7).

## 3. Dashboards

- **Operational** (for you): latency, no-match rate, routing confidence, guardrail blocks, errors.
- **Business** (for stakeholders): deflection, escalation-reduction, coverage, CSAT, trend over time.

## 4. Data sources

- Runtime logs (doc 13, PII-free), eval runs (doc 09), feedback signals, handoff reasons (doc 24).
- Aggregated/anonymized only — **no PII** (doc 10/17).

## 5. Cadence & ownership

- Live dashboard + a **weekly review** (pairs with the doc-13 gap triage).
- Each KPI has a **target** (starting values; revise with data) and an **owner**.

## 6. How KPIs drive action

```
 low coverage / high content-gap → author missing entities (doc 21)
 low routing accuracy            → add/adjust intent examples (doc 14)
 high error-handoff              → expand error catalogue (doc 19)
 weak Kurdish KPIs               → mitigations / fine-tune (doc 04)
```

## 7. Open items to confirm
- [ ] Which **CSAT/feedback** signals are actually available from the channels?
- [ ] Agree the **headline KPI** for "proving value" (likely deflection + escalation-reduction).
- [ ] Confirm a dashboard tool (simple table/Grafana/etc.) for Phase 2.
