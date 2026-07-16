# 00 — Project Overview & Vision

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

---

## 1. The Problem

Asiacell sells **hundreds of bundles**, **tens of services**, and roaming solutions, each governed by
a thick layer of rules, edge cases, and special conditions:

- *"Elna w lil Kul"* charges an extra **2,500 IQD** if you subscribe 3 times in one month.
- Some bundles are eligible **only in certain locations** (e.g. Baghdad).
- Some are eligible **only for a certain activation date**.
- Eligibility depends on the customer's **primary offer / service class** (e.g. a "Red" line cannot buy
  Yooz bundles, and vice-versa).
- Services (Shukran, Bye Bye, and many more) carry their own rules.

This knowledge is **buried in poor documentation or in people's heads**. Today it has to be *memorized*
or *hand-mapped* into each conversational flow. That makes building a new flow slow and error-prone,
because the author must remember every edge case — and even then, customers get wrong or incomplete answers.

## 2. The Vision

A single, authoritative **knowledge base** that any consumer can query in natural language and get the
right fact back instantly — without memorizing anything or sleuthing through bad docs.

Technically, this is a **RAG (Retrieval-Augmented Generation)** system:

```
            ┌─────────────────────────── KNOWLEDGE BASE (this project) ───────────────────────────┐
            │                                                                                       │
 Sources    │   Manual docs (edge-case rules, how-tos)        API-extracted data (prices, IDs)      │
   │        │            │                                              │                           │
   ▼        │            └──────────────► Normalize ◄──────────────────┘                           │
 (author)   │                                 │                                                     │
            │                            Chunk + Embed                                              │
            │                                 │                                                     │
            │                          ┌──────▼───────┐                                             │
            │                          │  VECTOR DB    │  (+ structured metadata for filtering)     │
            │                          └──────┬───────┘                                             │
            └─────────────────────────────────┼─────────────────────────────────────────────────────┘
                                              │  semantic + filtered search
                ┌─────────────────────────────┼─────────────────────────────┐
                ▼                                                             ▼
   CONSUMER 1: Laila (runtime)                                  CONSUMER 2: Flow-builders (design time)
   customer asks → retrieve facts →                            "what are the rules for X?" →
   LLM (Gemini/ChatGPT) composes answer                        retrieve → stop memorizing edge cases
```

## 3. What This Is — and Is Not

**This system IS:** a retrieval layer for *knowledge* — facts, rules, explanations, how-tos, terminology.

**This system is NOT:**
- ❌ An eligibility engine. Whether a specific line can buy a specific bundle is a **deterministic check
  in code** over live account data (service class, whitelist, 3-month history, location). The LLM and the
  vector DB never make that call. *(See Principle 1.)*
- ❌ A replacement for your BSS/CDR APIs. Those remain the source of live customer state.

## 4. The Three Kinds of Questions (the model everything hangs on)

Every question Laila receives sorts into exactly one bucket. Each has a different owner:

| Bucket | Example | Owner | Role of this project |
|--------|---------|-------|----------------------|
| **A — Deterministic decision** | "Is *my* line eligible for the Mega Family bundle?" | **Code** (over API data) | Supporting only: resolve the entity, explain the *why* afterward |
| **B — Knowledge lookup** | "What's the fee if I sub to Elna w lil Kul 3×?" · "How do I unsub from X?" | **Vector DB** | **Core value** — this is the project |
| **C — Reasoning / synthesis** | "I use 30GB and call Syria a lot — cheapest bundle?" | **LLM** over multiple retrieved chunks | Provide the chunks to reason over |

> **The project's center of gravity is Bucket B.** It is the easiest to build, the highest value, and
> the lowest risk. Buckets A and C are *supported* by the knowledge base but not *owned* by it.

## 4b. A Third Job: Intent Routing for the Dispatcher

The same vector DB is **also a semantic router** for Laila's dispatcher. Today the dispatcher sometimes
mis-routes a request (e.g. a *loan* question gets sent to *BTL* or the knowledge base). Because the DB
already understands meaning across languages, we use it to **classify the customer's intent** and pick
the right flow:

```
 customer: "I need loan bundles"  →  embed  →  match stored intent examples  →  target_flow: loan_flow
                                                  (not BTL)  →  dispatch correctly
```

This makes routing **grounded and controllable** (decided by curated examples, not LLM guesswork),
**multilingual**, and **extensible** (a new intent = new examples, no retraining). A confidence
threshold makes the router **abstain and clarify** rather than mis-send. Stored as `type: intent`
records (doc 02 §2b); mechanics in doc 06; dispatcher integration in doc 08.

> So the system has **three jobs on one infrastructure**: (1) knowledge retrieval, (2) entity
> resolution, and (3) intent routing. All three are "embed the text, search, use the result" — the same
> machinery pointed at different problems.

## 5. Two Supporting Roles in the Eligibility (Bucket A) Flow

Even though the vector DB never decides eligibility, it helps the flow in two ways:

1. **Entity resolution (before the check):** customer says *"the red line bundle"* or a colloquial/Kurdish/
   Arabic name → semantic search maps it to the canonical bundle ID + service class → that feeds the
   deterministic code. Valuable given messy, trilingual, synonym-heavy terminology
   (`line` = `primary offer` = `service class`).
2. **Explanation (after the check):** code returns "not eligible" → the DB supplies the human-readable
   reason ("Yooz bundles require a Yooz primary offer; your line is Red").

## 6. Key Constraints (carried into every doc)

- **Trilingual + mixed script:** Kurdish (Arabic *and* Latin script), Arabic (native script), English.
  Romanized Kurdish is the hardest retrieval case.
- **Hybrid authoring:** some knowledge hand-written, some API-extracted → needs a normalization layer.
- **Changes are frequent and irregular** (daily/weekly/monthly) → needs fast incremental updates.
- **Open-source & self-hostable preferred**, to avoid funding/approval friction.
- **Internet-connected** (not air-gapped) → cloud embedding APIs are *possible* but local is preferred.
- **Production-grade, very large user base, but small corpus** → scale via caching + replicas.
- **Maintainers prefer JS**, though Python is acceptable.

## 7. Phased Intent

1. **Phase 1 — Prototype (now):** local, open-source, single machine. Aim Bucket B at *flow-builders*
   first (lower risk). Prove that retrieval returns the right facts.
2. **Phase 2 — Production:** harden for Laila's runtime traffic — HA infra, caching, evaluation gates,
   correctness guarantees. Requires organizational buy-in (see Roadmap, doc 11).

> ⚠️ **Tension to resolve openly:** the ambition (serve all of Iraq, production-grade) eventually
> outgrows "free tools on a laptop to dodge approvals." That's fine for the prototype, but Phase 2 will
> need real infrastructure and sponsorship. We name this now so it isn't a surprise later.
