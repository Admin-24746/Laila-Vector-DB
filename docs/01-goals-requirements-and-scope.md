# 01 — Goals, Requirements & Scope

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

This document states *what the system must do and how well*, separate from *how we'll build it*
(that's docs 02–11). It is the yardstick every later decision is measured against.

---

## 1. Business Goals

| # | Goal | Why it matters |
|---|------|----------------|
| BG1 | Stop relying on human memory / doc-sleuthing for bundle & service rules | Slow, error-prone flow-building; inconsistent customer answers |
| BG2 | Let flow-builders find any rule/edge-case in seconds | Faster, more correct flow development |
| BG3 | Give Laila accurate, grounded facts to answer customers | Fewer wrong answers, better CX at scale |
| BG4 | Make knowledge updatable quickly when bundles/services change | Data changes daily–monthly; stale answers are harmful |
| BG5 | Keep it cheap & self-hostable for the prototype | Avoid funding/approval friction to prove value first |

## 2. Functional Requirements

| # | Requirement |
|---|-------------|
| FR1 | Store knowledge about **bundles** and **services**, including conditional rules (location, activation date, repeat-purchase fees, service-class eligibility). |
| FR2 | Retrieve relevant facts from a **natural-language query** in any supported language/script. |
| FR3 | Support **metadata filtering** at query time (e.g. location = Baghdad, service_class = Red). |
| FR4 | Perform **entity resolution**: map colloquial/multilingual names to a canonical bundle/service. |
| FR5 | Expose retrieval to Druid via **REST webhook / function-calling**. |
| FR6 | Return results as plain text usable by **either Gemini or ChatGPT** as context. |
| FR7 | Ingest from **two source types** (hand-authored docs + API-extracted data) through one normalization layer. |
| FR8 | Support **incremental updates** (add/modify/delete a single bundle) without full re-index. |
| FR9 | Store and resolve **terminology synonyms** (`line` = `primary offer` = `service class`, etc.). |

## 3. Non-Functional Requirements

| # | Requirement | Target (prototype) | Target (production) |
|---|-------------|--------------------|--------------------|
| NFR1 — Languages | Kurdish (Arabic+Latin script), Arabic, English; cross-lingual retrieval | All supported, best-effort romanized Kurdish | High accuracy across all |
| NFR2 — Retrieval latency | Vector search only | < 50 ms | < 50 ms |
| NFR3 — End-to-end latency | Query→answer (incl. LLM) | Not a priority yet | Define after correctness is met |
| NFR4 — Correctness | Retrieval returns the right fact | "Good enough" to demo | **Must be measurably correct** (see doc 09) |
| NFR5 — Throughput | Concurrent queries | Single user / dev | Very high; via caching + replicas |
| NFR6 — Update speed | Time to reflect a data change | Minutes, manual OK | Minutes, automated |
| NFR7 — Availability | Uptime | Best-effort | Production HA |
| NFR8 — Footprint | Runs on dev hardware | RTX 5060 / 32GB RAM | VM with GPU/CPU as needed |

> **Priority order for the prototype:** Correctness-of-retrieval ▶ Coverage ▶ Update-ease ▶ Latency ▶ Throughput.
> Latency and throughput are deliberately *deprioritized now* (the corpus is tiny; the DB was never the
> bottleneck). They become first-class in Phase 2.

## 4. Success Criteria

**Prototype is successful when:**
- A flow-builder can ask "what are the rules for *<bundle/service>*?" and get the correct, complete
  answer for the top ~20 most-used bundles/services, in all three languages.
- Adding or editing one bundle's knowledge takes minutes and is reflected in search immediately after.
- Retrieval returns the correct chunk in the top results for an agreed test set of real questions
  (the formal metric is defined in doc 09 — Evaluation).

**Production is successful when:** correctness is measured and meets an agreed bar, the system sustains
Laila's live traffic, and updates are automated. (Detailed in docs 09–11.)

## 5. Explicit Non-Goals (what we will NOT do)

- ❌ Make eligibility decisions in the LLM or vector DB (stays deterministic in code).
- ❌ Store customer PII or live account state (the BSS/CDR APIs own that).
- ❌ Replace existing Druid flows — we *augment* them with a retrieval call.
- ❌ Build a giant general-purpose document store — scope is bundles, services, rules, terminology.
- ❌ Optimize latency/throughput before correctness is proven.

## 6. Constraints

- Open-source & self-hostable strongly preferred.
- Maintainer stack: **mainly JS**, Python acceptable.
- Internet-connected, no sensitive data in this corpus → cloud embedding APIs allowed but not required.
- Small team (mainly one person now).

## 7. Assumptions (flag if wrong)

- A1: Kurdish dialect is **Sorani** (Iraqi). *(Confirm — affects model coverage, decision D5.)*
- A2: The knowledge corpus stays small (thousands–tens-of-thousands of chunks), even fully expanded.
- A3: Bundle/service names and IDs are stable enough to serve as canonical keys.
- A4: We can get read access to the relevant APIs for the API-extracted portion of the data.

## 8. Open Questions feeding later docs

- Canonical storage language (D1) → docs 03/04
- Structured-vs-vectorized rules (D2) → docs 02/03
- Embedding model & dialect mitigation (D3, D5) → doc 04
- Vector DB product (D4) → doc 05
- Evaluation metric & test set (NFR4) → doc 09
