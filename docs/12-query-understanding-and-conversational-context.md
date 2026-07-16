# 12 — Query Understanding & Conversational Context

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> Retrieval is only as good as the text we embed. Real customer messages are messy: follow-ups that
> depend on earlier turns, mixed scripts, typos, Arabizi, abbreviations. This doc defines the
> **pre-retrieval** step that turns a raw message into a clean, self-contained query — *before* embedding.
> Resolves **D8**.

---

## 1. The problems (all corrupt retrieval if ignored)

| Problem | Example | Effect |
|---------|---------|--------|
| **Follow-up reference** | "and how do I cancel **it**?" | "it" is meaningless alone → wrong retrieval |
| **Script vari/mixing** | Arabic-Indic digits, mixed Latin/Arabic | exact-term mismatch |
| **Typos / spelling** | "combbo", "كومبو" misspelled | dense ok, sparse misses |
| **Arabizi / romanization** | "3ndi mushkila", romanized Kurdish | weak model coverage (D5) |
| **Abbreviations / slang** | "unsub", "bal", colloquial bundle names | no match without expansion |

## 2. The query-understanding pipeline (runs before embed)

```
 raw message + history
   │
   1. DETECT      language + script (ar / en / ckb / kmr; Arabic vs Latin script)
   │
   2. NORMALIZE   unify digits (٠١٢→012), strip/standardize diacritics, whitespace,
   │              Arabic/Kurdish letter normalization (ي/ی, ك/ک, ة/ه, etc.)
   │
   3. REWRITE?    is this a context-dependent follow-up?  ── no ──┐
   │                     │ yes                                     │
   │              coreference-resolve using recent history        │
   │              → standalone query                              │
   │                     │                                         │
   4. EXPAND      add known aliases/synonyms (line=primary offer=service class) ◄┘
   │
   ▼
 clean, self-contained query  →  embed (doc 06)
```

Steps 1–2 are cheap/deterministic and **always run**. Steps 3–4 run **conditionally** (cost control).

## 3. D8 — Conversational rewriting: **gated LLM rewrite** ✅

**When to rewrite:** only when the message is **context-dependent** — detected cheaply first:
- Heuristic gate: short message + pronoun/deictic ("it", "that one", "وە", "هەمان") + an active topic in
  history → candidate for rewrite. Standalone questions skip it.

**How:** a **fast, cheap LLM call** (the same Gemini/ChatGPT already in flows) rewrites the follow-up into
a standalone query using the last *N* turns:
```
 history: user "tell me about Combo bundle" / assistant "…"
 follow-up: "how do I cancel it?"
 → rewrite: "how do I unsubscribe from the Combo bundle?"
```

**Why gated (not always-on):**
- Rewriting every message adds an LLM call (~100–400 ms) and cost; most messages don't need it.
- The gate keeps standalone queries fast (steps 1–2 only) and spends the LLM only where it pays off.

**Fallback:** if rewrite is low-confidence or the gate is unsure, retrieve with **both** the raw and the
rewritten query and merge results — safer than betting on one.

## 4. Multilingual / Arabizi handling (supports D5)

- **Script detection** routes the query to same-script chunks (per-language chunks, doc 03) via the
  `language` filter.
- **Romanized input** (Arabizi, Latin Kurdish): the **hybrid sparse signal** (doc 06) already helps with
  exact transliterated tokens; optionally add a light **transliteration normalizer** for common patterns
  ("3"→"ع", "7"→"ح") to improve matching. Measured in the doc-09 Kurdish slice.
- **Answer language:** detected language is passed through so the answer returns in the user's language.

## 5. Query expansion (light)

- Inject known **aliases/synonyms** from the terminology entities (doc 02) so "primary offer", "line",
  and "service class" all retrieve the same thing.
- Keep it conservative — over-expansion adds noise. Driven by the curated terminology list, not guessed.

## 6. Where it lives & cost

- A **pre-processing module** inside the retrieval service, applied at the top of `/route` and `/retrieve`
  (doc 08), before embedding.
- **Deterministic steps (1–2, 5):** ~1–5 ms. **Rewrite (3):** only when gated, ~100–400 ms.
- History is **passed in by Druid** (doc 08, stateless) — we don't store conversations.

## 7. Failure handling

| Case | Behaviour |
|------|-----------|
| Language undetectable | default to multi-language search (no `language` filter) |
| Rewrite LLM fails/slow | fall back to raw query (don't block retrieval) |
| Ambiguous follow-up | retrieve on raw+rewrite merged; if still weak → clarify (doc 06 §7) |

## 8. Open items to confirm

- [ ] Confirm the **history window** size Druid will pass (last N turns).
- [ ] Approve **gated rewrite** (vs always-on vs none) for the prototype.
- [ ] Decide whether to add the **transliteration normalizer** now or after the doc-09 Kurdish measurement.
- [ ] Confirm aliases come from the curated **terminology** entities.
