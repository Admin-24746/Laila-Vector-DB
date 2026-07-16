# 24 — Human-Handoff Design

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> Handoff is referenced across many docs; here it's designed as one thing — **when** Laila escalates to a
> human and **how** context is transferred so the customer never has to repeat themselves.

---

## 1. When to hand off (triggers)

| Trigger | Detail |
|---------|--------|
| **Explicit request** | Customer asks for a human → hand off immediately. |
| **Low confidence / repeated failure** | After **N failed attempts** (default 2–3) or sustained low retrieval/routing confidence (doc 06). |
| **Sensitive actions** | Payment, fraud, account security, or formal complaints that need an agent to act (also `auto_explain=false` errors, doc 19). |
| **Unexplainable error** | Error not found / low confidence in the catalogue (doc 19). |
| **Abuse/safety** | Per doc 17 (after safe response). |

> We do **not** "minimize at all costs" — we hand off on these triggers, but we *prevent unnecessary*
> handoffs by resolving errors (doc 19) and gaps (doc 13) first. Goal: handoff is correct, not rare-for-its-own-sake.

## 2. Thresholds

- **N attempts:** start at 2–3 before escalating on repeated failure; tune via eval/feedback.
- **Confidence floor:** below the retrieval/routing `τ_low` (doc 06) → escalate rather than guess.
- Always honor an **explicit human request** regardless of confidence.

## 3. Context transfer (warm handoff)

When escalating, pass the agent a **handoff payload** so the customer doesn't restart:

```jsonc
{ "summary": "Customer asked about Combo eligibility on a Red Baghdad line; got eligibility info; now
              wants to dispute a charge.",
  "detected_intent": "complaint_billing", "language": "ar-IQ",
  "retrieved": ["bundle_combo::eligibility"], "attempts": 3,
  "what_was_tried": ["explained eligibility", "offered alternative"],
  "reason": "sensitive_action: billing dispute" }
```

- **No PII in our logs**, but the live handoff payload to the authorized agent system may include
  session context (handled by Druid/agent platform with proper access — not stored by us).

## 4. Handoff mechanics

- **Warm** (preferred): pass summary + context to the agent/queue.
- **Availability fallback:** after-hours / no agent → inform the customer, offer callback/ticket, capture the request.
- **No dead ends:** never loop forever; if stuck, escalate or offer a clear next step.

## 5. Learn from handoffs (close the loop)

- Log **handoff reason + trigger** (doc 13) → feeds analytics (doc 22) and the content/error backlog
  (docs 19/21). Every avoidable handoff becomes a fix.

## 6. Evaluation
- **Over-escalation** (handed off when it could have answered) and **under-escalation** (kept trying when
  it should have escalated) tracked in doc 09. Both are failures.

## 7. Open items to confirm
- [ ] Confirm the **agent system / queue** Laila hands off to, and the payload it accepts.
- [ ] Confirm **agent availability hours** + after-hours behavior (callback/ticket?).
- [ ] Set the initial **N attempts** before repeated-failure handoff.
- [ ] Confirm which **sensitive actions** must always escalate.
