# 03 — Chunking Strategy ⭐

**Status:** ✅ Accepted 2026-07-15 · **Owner:** Yousif · **Last updated:** 2026-06-28

> This is the **highest-impact decision** in the whole system. Embeddings and vector DBs are
> commodities you can swap later; chunking decides *what can ever be retrieved at all*. Get it wrong and
> no model or database can save you — the right fact will be split apart, buried, or diluted.

---

## 1. What "chunking" is, and why it decides everything

Before text can be embedded, it must be cut into pieces ("chunks"). **Each chunk becomes one
searchable unit** — one vector, one thing that can be returned. Therefore:

- If a fact is **split across two chunks**, neither chunk fully answers the question → bad retrieval.
- If a chunk **mixes many unrelated facts**, its vector is an averaged blur → it matches everything
  weakly and nothing strongly → bad retrieval.
- The ideal chunk is **"one self-contained answer to one question."**

### The core trade-off

```
   TOO BIG (whole bundle in one chunk)          TOO SMALL (one sentence per chunk)
   ─────────────────────────────────           ────────────────────────────────
   + full context in one hit                   + laser-precise matching
   - vector is a blur of many topics           - loses surrounding context
   - retrieves irrelevant sub-parts            - one fact fragmented across chunks
   - hard for LLM to find the needle           - more chunks to manage

                 SWEET SPOT  ►  "one answerable question per chunk"
                 (a coherent section, self-contained, with its entity named)
```

## 2. The standard strategies (survey + when to use)

| Strategy | How it works | Pros | Cons | Fit for us |
|----------|--------------|------|------|-----------|
| **Fixed-size** | Cut every N characters/tokens, optional overlap | Trivial, fast | Splits mid-sentence/mid-rule; blind to meaning | ❌ Wrong for structured data |
| **Recursive** | Split on a hierarchy of separators (¶ → sentence → word) until under size | Respects text boundaries; good default for prose | Still meaning-blind; needs a size target | 🟡 Fallback for long prose fields |
| **Semantic** | Split where embedding similarity drops (topic shift) | Topic-coherent chunks | Slower, needs tuning, can be unpredictable | 🟡 Overkill for short entity text |
| **Document / structure-aware** | Split along the document's own structure (headings, fields, records) | Chunks = natural units; metadata-rich | Requires structured input | ✅ **Our primary** — our data *is* structured entities |
| **Hierarchical / parent–child ("small-to-big")** | Retrieve small precise chunks, then return the larger parent for context | Precision *and* context | More plumbing | ✅ **Adopt** for entity context |
| **Contextual augmentation** | Prepend a short context blurb (entity name/type) to each chunk so it stands alone | Big precision gain; cheap | Slight storage overhead | ✅ **Adopt** |
| **Agentic** | An LLM decides chunk boundaries per document | Can be very good | Slow, costly, non-deterministic | ❌ Not worth it at our size |

## 3. Why our data changes the answer

Most RAG tutorials assume **long free-form documents** (PDFs, wikis) → they reach for fixed/recursive
splitting. **We are the opposite case:** our knowledge is **short, structured entities** (bundles,
services) with well-defined fields. That means:

> We should **not** blindly slice text by size. We should **chunk along the entity's own structure** —
> one chunk per *answerable section* of each entity — and attach rich metadata for filtering.

This is **structure-aware chunking**, and it's both simpler and more accurate than size-based splitting
for our case.

## 4. RECOMMENDED STRATEGY

### 4.1 Section-aware entity chunking

Each entity (doc 02) is split into a small set of **section chunks**, one per answerable unit:

| Chunk role | Built from | Answers questions like |
|------------|------------|------------------------|
| `overview` | `description` | "What is the Combo bundle? What do I get?" |
| `subscribe` | `how_to.subscribe` | "How do I subscribe?" |
| `unsubscribe` | `how_to.unsubscribe` | "How do I cancel?" |
| `eligibility` | `conditions` (locations, service_classes, dates) | "Can Red lines get it? Is it Baghdad-only?" |
| `fees_edgecases` | `conditions` (fees, thresholds) | "Extra fee if I subscribe 3×?" (Elna w lil Kul) |
| `conflicts` | `conflicts_with` | "Does it clash with bundle X?" |

Only sections that exist are emitted — a service with no `conflicts_with` produces no conflicts chunk.

### 4.2 Contextual header on every chunk (self-containment)

Each chunk is **prefixed with a short context line** so it makes sense in isolation (the retriever may
return it alone, with no neighbours):

```
[Combo Bundle · BTL bundle · aliases: combo, كومبو]
Unsubscribe: send "STOP COMBO" to 1234, or dial *123#. No cancellation fee.
```

That bracketed header is generated from the entity's `names`/`subtype`/`aliases`. It massively improves
matching for short or pronoun-y text and folds your **synonyms/terminology** into the searchable text.

### 4.3 Per-language chunks (resolves Decision D1 — proposed)

Because retrieval is most accurate when the **query and chunk are in the same language/script**, and our
corpus is tiny, we **emit one chunk per language per section**:

```
combo::unsubscribe::en   combo::unsubscribe::ar   combo::unsubscribe::ckb   combo::unsubscribe::kmr
```

- ✅ An Arabic query best-matches the Arabic chunk; a romanized-Kurdish query matches the `kmr` chunk —
  the safest answer to the romanized-Kurdish risk (doc 04).
- ✅ Each chunk tagged `language` for optional filtering, and we can return the answer in the user's language.
- Cost: ~4× chunk count — but 4× of "small" is still small (doc 02 §7). Worth it for accuracy.
- **This proposes D1 = "store all languages as separate chunks."** Confirm in doc 04.

### 4.4 Small-to-big retrieval (parent–child)

We retrieve at the **section** grain (precise), but keep each chunk linked to its **parent entity** so we
can, if needed, hand the LLM the *whole* entity card for richer context before it composes an answer.
Best of both: precise matching, complete context.

### 4.5 Structured fields are NOT chunked

`facts` and raw `conditions` values (price, dates, fee amounts, eligible locations) are **stored as
metadata on the chunks**, not embedded as searchable prose-by-size. They power **exact filtering**
(doc 06) and feed deterministic code (Principle 1). The *prose rendering* of those facts (the
`fees_edgecases`/`eligibility` chunks) is what gets embedded.

## 5. Worked example — "Combo Bundle" → chunks

```
Entity: bundle_combo_monthly_2  (type=bundle, subtype=btl)

Produces (per language ×4):
  ┌ overview        "[Combo Bundle · BTL] 4 weeks: 500 on-net min, 25 on-net SMS … for 5,000 IQD."
  ├ subscribe       "[Combo Bundle · BTL] Subscribe: dial *123*1# …"
  ├ unsubscribe     "[Combo Bundle · BTL] Unsubscribe: send STOP COMBO …"
  ├ eligibility     "[Combo Bundle · BTL] Available to Red & X service classes; Baghdad only; valid 2026-06-20…"
  └ fees_edgecases  "[Combo Bundle · BTL] Subscribing 3× in one month adds a 2,500 IQD fee."

Each chunk metadata:
  { entity_id, type:bundle, subtype:btl, section:fees_edgecases, language:en,
    eligible_locations:[baghdad], eligible_service_classes:[red,…],
    valid_from, valid_to, price_iqd:5000, version, updated_at }
```

A query *"do I pay extra if I get Combo three times this month?"* → matches the `fees_edgecases::en`
chunk directly. A query filtered to `location=baghdad` won't surface bundles ineligible there.

## 6. Chunk identity & re-chunking on update

- **Chunk ID:** `{entity_id}::{section}::{language}` — deterministic, so an update is a clean
  **delete-by-entity_id + re-insert** (no orphaned vectors). Supports FR8 (incremental updates).
- When an entity changes, we re-chunk *only that entity* and upsert. Corpus-wide re-index never needed.
- `version`/`updated_at` on every chunk → easy staleness checks and rollbacks.

## 7. What we deliberately AVOID

- ❌ Dumping raw JSON into the DB (vectors of JSON match poorly; not how users phrase questions).
- ❌ Blind fixed-size character splitting (would cut rules in half).
- ❌ One giant chunk per entity (blurred vector, imprecise retrieval).
- ❌ Mixing multiple entities in one chunk.
- ❌ Embedding the structured numbers as prose-by-size (kept as metadata instead).

## 8. Sizing notes

- Our sections are naturally short (1–4 sentences) → comfortably within any embedding model's window
  (BGE-M3 handles up to 8192 tokens; we use a tiny fraction). **Size is bounded by the section, not a
  token limit**, so we avoid arbitrary cutoffs.
- For any unusually long authored prose (a multi-paragraph "how-to guide"), apply **recursive splitting**
  as a fallback within that one section, targeting ~200–300 tokens with ~15% overlap.

## 9. Open items to confirm

- [ ] Confirm **D1 = per-language chunks** (§4.3).
- [ ] Confirm the **section list** in §4.1 — add/remove roles (e.g. a `roaming` section? `requirements`?).
- [ ] Confirm the **contextual header format** (§4.2).
- [ ] Agree we keep **agentic/semantic chunking out of scope** for the prototype.
