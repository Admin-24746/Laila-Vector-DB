# 06 — Retrieval Architecture

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

> This doc turns the components (chunking 03, embedding 04, Qdrant 05) into a **working retrieval
> engine**, and defines how that one engine serves both **knowledge retrieval** and **intent routing**.
> It is a single, parameterized service — not two subsystems (see doc 00 §4b).

---

## 1. One engine, one function

All retrieval is one function, called with different arguments:

```
retrieve(text, { typeFilter, topK, filters, threshold }) → ranked results

  routing   = retrieve(msg, { typeFilter:"intent",         topK:3, threshold:0.80 })
  knowledge = retrieve(msg, { typeFilter:"bundle|service", topK:5, filters:{location,…} })
```

Same embedding model, same Qdrant, same search path. The only differences are **what `type` we filter
to** and **what we do with the result** (route-with-threshold vs hand-text-to-LLM).

## 2. The retrieval pipeline (shared by both uses)

```
 text
  │
  1. NORMALIZE      detect language; normalize script/spacing/diacritics; light cleanup
  │
  2. EMBED          BGE-M3 → dense vector (+ sparse terms)         [reused if already embedded upstream]
  │
  3. FILTER         Qdrant payload filter narrows candidates       e.g. type, language, location, valid dates
  │                 (a "pre-filter": applied during the search, not after)
  4. HYBRID SEARCH  score = fuse(dense similarity, sparse/lexical) → ranked candidates
  │
  5. (RERANK)       optional cross-encoder re-scores top-N         [OFF for prototype — see §5]
  │
  6. ASSEMBLE       attach chunk text; optional small-to-big expansion to full entity card
  │
  ▼
 results (ranked chunks + scores + metadata)
```

### 2.1 Hybrid search (step 4) — why both halves matter

| Signal | Catches | Example |
|--------|---------|---------|
| **Dense** (meaning) | paraphrases, cross-lingual, synonyms | "advance me credit" ≈ "I need a loan" |
| **Sparse** (exact terms) | names, codes, transliterations, rare words | "Combo", "كومبو", "Elna w lil Kul" |

Fusing them covers each other's blind spots — critical for our messy, multilingual, name-heavy data
(doc 04). Qdrant fuses the two scores in a single query.

**Sparse source (resolves the doc-05 open item):**
- **Prototype:** dense from BGE-M3 (via TEI) **+ Qdrant's built-in lexical/BM25** sparse. Simplest to
  stand up, no extra serving complexity, fully JS-driven.
- **Upgrade (Phase 2):** swap the lexical half for **BGE-M3's native sparse vectors** if eval shows it
  helps transliterated Kurdish. Same Qdrant hybrid plumbing — drop-in.

### 2.2 Metadata filtering (step 3) — exactness, for free

Conditions from doc 02 become **pre-filters** so the search only ever considers valid candidates:

```
filters: { type:"bundle", language:"ar",
           eligible_locations: contains "baghdad",
           valid_from <= today <= valid_to }
```

This is how "Baghdad-only" or "Red service-class" rules are enforced **deterministically** at retrieval
time — the model never has to "remember" them, and ineligible bundles simply can't surface.

## 3. Decision D6 — Reranking: **OFF for the prototype** ✅

A reranker is a slower, more accurate model (a cross-encoder, e.g. `bge-reranker-v2-m3`) that re-scores
the top-N candidates by reading query+chunk *together*.

| | Without reranker (prototype) | With reranker (Phase 2 option) |
|---|---|---|
| Precision | Good (hybrid + tiny corpus) | Higher on hard/ambiguous queries |
| Latency | ~20–120 ms | +20–60 ms per query |
| Complexity | One model to serve | Two models to serve |

**Decision:** **skip it for the prototype.** Our corpus is tiny and hybrid search is already strong, so
the payoff is small while it adds a second model and latency. **Revisit in Phase 2** *only if* the doc-09
eval shows precision gaps. (Kept behind the same `retrieve()` interface, so adding it later is a config flag.)

## 4. Knowledge use — retrieve → route to bucket → answer

After `retrieve(..., typeFilter:"bundle|service")`, results flow into the three-bucket logic (doc 00 §4):

```
 results
   │
   ├─ Bucket B (lookup)     → small-to-big expand → send chunks → LLM composes answer (user's language)
   │
   ├─ Bucket C (reasoning)  → send MULTIPLE chunks → LLM compares/synthesizes → answer
   │
   └─ Bucket A (eligibility)→ results used only for ENTITY RESOLUTION
                              → call DETERMINISTIC code (BSS/CDR, service-class, whitelist)
                              → LLM explains the verdict using the explanation chunk
```

- **Small-to-big (doc 03 §4.4):** retrieve precise sections, but pass the LLM the fuller entity card when
  helpful, so it has complete context without sacrificing match precision.
- **Grounding rule:** the LLM answers **only** from retrieved text. If nothing relevant is retrieved, it
  must say "I don't have that" / hand off — never invent. (Anti-hallucination; enforced in doc 08 prompt.)

## 5. Routing use — the semantic router (resolves D7)

After `retrieve(msg, typeFilter:"intent", topK:3)`:

```
 top intent matches (with scores)
   │
   ├─ top score ≥ τ_high  AND  (top − 2nd) ≥ margin   →  ROUTE to its target_flow   ✅ confident
   │
   ├─ top score <  τ_low                              →  no good match → CLARIFY / fallback flow
   │
   └─ ambiguous (close top-2, both ≥ τ_low)           →  LLM TIE-BREAKER among the 2–3 candidates
                                                          (or ask a short clarifying question)
```

### D7 decision — **vector-first, LLM only as tie-breaker** ✅

- **Default = pure vector nearest-neighbour** with a **confidence threshold (`τ`) + margin**. Fast,
  cheap, deterministic, auditable (you can log which example matched and the score).
- **LLM tie-breaker only when ambiguous** (top candidates within `margin`). Keeps cost/latency low while
  resolving the genuinely hard cases.
- **Abstain-and-clarify when weak.** A wrong route is worse than one clarifying question — this is what
  eliminates the "loan → BTL" misroutes. **Never guess on low confidence.**
- **Thresholds (`τ_high`, `τ_low`, `margin`) are calibrated on the eval set** (doc 09), not guessed.
  Start conservative (favor clarifying) and loosen as data proves it safe.

> **Auditability:** every routing decision logs `{utterance, top matches, scores, chosen_flow,
> reason}`. This makes misroutes diagnosable instead of mysterious — a direct fix for today's problem.

## 6. Caching (pointer)

A query/result cache sits in front of `retrieve()` keyed by `{normalized_text, filters}`. Most live
traffic is repeated questions → high hit rate → Qdrant barely loaded. Technology and policy decided in
doc 10; mentioned here so the interface reserves a cache hook.

## 7. Failure modes & fallbacks

| Situation | Behaviour |
|-----------|-----------|
| No results pass the filter | Relax non-critical filters once; else "no eligible match" → clarify/handoff |
| Low knowledge relevance | LLM must NOT answer from memory → say it doesn't know / escalate |
| Low routing confidence | Abstain → clarifying question or safe default flow |
| Embedding service down | Fail safe to existing dispatcher logic; alert; (cache may still serve hits) |
| Stale data suspected | `version`/`updated_at` on chunks lets us detect & refresh (doc 07) |

## 8. End-to-end picture

```
 customer message
   │ embed once
   ├──────────────► ROUTING:  retrieve(type:intent) → threshold/margin → flow (or clarify)
   │                                   │
   │                          dispatched into a flow
   │                                   │
   └─ (reuse embedding) ─────► KNOWLEDGE: retrieve(type:bundle|service, filters) → bucket A/B/C
                                          → deterministic checks where needed
                                          → LLM composes grounded answer → customer
```

## 9. Open items to confirm

- [ ] Approve **D6 = no reranker in prototype** (revisit via eval).
- [ ] Approve **D7 = vector-first routing + threshold/margin + LLM tie-breaker + abstain**.
- [ ] Approve **sparse = Qdrant BM25 for prototype**, BGE-M3 native sparse as a Phase-2 upgrade.
- [ ] Confirm the **grounding rule** (LLM answers only from retrieved text) as a hard requirement for doc 08.
