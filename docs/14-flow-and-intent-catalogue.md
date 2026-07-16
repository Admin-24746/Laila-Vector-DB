# 14 — Flow & Intent Catalogue (+ Out-of-Domain Handling)

**Status:** 🟡 Draft (catalogue needs your confirmation) · **Owner:** Yousif · **Last updated:** 2026-06-28

> The router (doc 06/08) can only route to flows it knows exist. This doc is the **canonical, versioned
> list** of every flow/intent, plus what happens when **nothing matches** (out-of-domain / non-Asiacell).
> Resolves **D11**.

---

## 1. The catalogue ⚠️ CONFIRM & COMPLETE

Inferred from our conversation — **please correct, delete, and add**. Each row becomes a set of
`type:intent` records (doc 02 §2b) with multilingual example utterances.

| intent_id | target_flow | What the customer wants | Notes |
|-----------|-------------|-------------------------|-------|
| `knowledge_query` | knowledge_flow | Info about a bundle/service (price, how-to, rules) | Bucket B |
| `bundle_info_atl` | atl_flow | Info about an ATL bundle | Separate **info** flow (unify later) |
| `bundle_info_btl` | btl_flow | Info about a BTL bundle | Separate **info** flow (unify later) |
| `purchase_bundle` | purchase_bundle (shared fn) | Buy any bundle (ATL or BTL) | **Purchase = one shared function** even though info is separate |
| `unsubscribe_bundle` | unsub_flow | Cancel a bundle | |
| `eligibility_check` | eligibility_flow | "Can I get bundle X?" | Bucket A — deterministic code decides |
| `balance_inquiry` | balance_flow | Check balance | |
| `recharge` | recharge_flow | How to / recharge balance | |
| `loan` | loan_flow | Advance balance / loan | The misroute example you gave |
| `roaming` | roaming_flow | Roaming plans/usage (doc 16) | v1 |
| `complaint_no_internet` | complaint_flow | No internet in area | |
| `shop_locator` | shop_flow | Nearest shop/branch | |
| `scratch_card_check` | scratch_card_flow | Validate / damaged scratch card (also via image, doc 18) | |
| `greeting_chitchat` | smalltalk | Hello / thanks / small talk | Meta |
| `human_handoff` | agent_handoff | Wants a human | Meta |
| `out_of_domain` | (see §3) | Not about Asiacell services | Safety net |

> **I need from you:** the *real* flow names and any missing intents. This list drives routing + the eval
> set (doc 09).

## 2. Intent categories

- **In-domain service flows** — the core (subscribe, loan, roaming, complaint…).
- **Meta flows** — greeting, chitchat, human handoff.
- **Out-of-domain** — everything else (general questions, competitor topics, unrelated requests).

## 3. D11 — Out-of-domain & non-Asiacell handling: **polite, reasoned, neutral deflection** ✅

When routing confidence is low **and** no in-domain intent fits, Laila must **not** force-route (no more
"loan → BTL") and must **not** say a blunt "I can't answer." Instead:

1. **Deflect politely, with an LLM-composed reason** — explain *why* in natural language, in the
   customer's language. Never a cold refusal.
2. **Competitor / non-Asiacell case** (e.g. a **Zain** scratch card or question): explain that it's a
   different company Asiacell doesn't have access to, and direct them to that company — **respectfully**.
3. **Then offer what Laila *can* help with** (steer back to in-domain).

### 3.1 Brand-neutrality policy (MANDATORY, cross-cutting)

> Laila must **never favor or disparage** Asiacell vs any competitor. For "which is better, Asiacell or
> Zain?" → answer neutrally: *both are telecom companies; the choice is the customer's.* No competitive
> claims, no selling-against. This rule is enforced in the answer prompts (doc 15) and safety layer
> (doc 17), and applies to **every** flow, not just out-of-domain.

**Example responses (illustrative):**
- *Zain scratch card:* "That looks like a Zain card. Zain is a separate operator and we can't process
  their cards — please contact Zain directly. Is there anything with your Asiacell line I can help with?"
- *"Which is better, Asiacell or Zain?":* "Both are telecom companies — which one is best is really up
  to you, our valued customer. How can I help you with your Asiacell service today?"

## 4. How the catalogue is used

- Each intent → multilingual example utterances stored as `type:intent` records; the router matches
  against them with threshold/margin/abstain (doc 06 §5).
- **Abstain → out-of-domain handler (§3).** Low confidence is a *feature*: it triggers safe deflection.
- New flow = add a catalogue row + examples; no code change (doc 02 extensibility).

## 5. Governance

- The catalogue is **versioned data** (in the content repo, doc 07), reviewed like knowledge.
- One owner keeps it in sync with the actual Druid flows — a stale catalogue causes misroutes.

## 6. Open items to confirm

- [ ] Provide the **real flow list** (names + any missing intents).
- [ ] Confirm whether **BTL / ATL** are separate flows or one subscription flow.
- [ ] Approve the **neutrality policy** wording (§3.1) for use in prompts.
- [ ] Provide 3–5 **example utterances per intent** (or approve LLM-drafting them for your review).
