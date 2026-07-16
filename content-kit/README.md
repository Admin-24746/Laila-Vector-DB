# Content-Collection Kit

Everything Yousif needs to collect/confirm so the Laila Knowledge Base runs on **real data**
instead of placeholders. The code (Phase 0+1) is done and verified — content is the only thing
between the current numbers and the prototype gates (root README, "⚠️ Everything marked
PLACEHOLDER" section).

**How to use this kit:** work the master checklist below top-to-bottom (ordered by impact). Each
item links to a worksheet in this directory that specifies the exact format, so nothing needs to be
re-asked. Nothing in `content-kit/` is read by the code — it's a human workspace; the results get
transcribed into `data/seed/`, `data/vocab/`, and `eval/gold/`.

| File | What it's for |
|---|---|
| `seed-20-worksheet.md` | Capture the real top ~20 bundles/services, field by field |
| `utterances-template.csv` + `utterances-instructions.md` | Dump real customer utterances from Laila logs |
| `vocab-confirm.md` | Every CONFIRM-marked placeholder, as fill-in tables |
| `native-review-pack.md` | All machine-drafted ar/ckb/kmr text, ready for a native reviewer |
| `extract-review-text.js` | Regenerates the review pack from `data/seed/` (`node content-kit/extract-review-text.js`) |

---

## Master checklist (in impact order)

### 1. Seed-20: the real top ~20 bundles/services  → `seed-20-worksheet.md`

The single highest-impact item — real entities unblock retrieval quality, the gold set, native
review, and the answer layer at once. Today only 3 bundles + 1 service exist and **their prices,
shortcodes, and definitions are invented** (flagged in-file via `attributes.review_note`).

- [ ] Get the bundle ranking: which ~20 bundles/services are most purchased / most asked about
      (BSS purchase stats or product team; Laila logs for "most asked").
- [ ] Pull facts per bundle from the **productOfferingQualification API** (both TMF and YOOZ
      formats — docs/27 §1): bundleId, offerId, names×lang, price, expiry, btlProductName.
      If API access isn't set up yet, a screenshot/export from the product catalogue works for v1.
- [ ] Fill eligibility + fees per bundle (BSS/CBS or your own knowledge — docs/27 says expect
      manual cleanup).
- [ ] Write the how-to steps (real USSD codes / SMS shortcodes — the current `*123#`-style codes
      are all invented).
- [ ] Confirm the real **Shukran** and **Bye Bye** service definitions.
- **Where from:** productOfferingQualification API + BSS/CBS + product team + you (docs/27 §2).
- **Format:** `seed-20-worksheet.md` Part B form (or a spreadsheet with the same columns), then
  transcribe into `data/seed/` using the `_TEMPLATE.*.json` files.
- **Time:** ~2–4 h if the API/catalogue export is available; +1–2 h transcription.

### 2. Real intent utterances from Laila logs  → `utterances-template.csv` + instructions

The routing-accuracy blocker. Routing sits at ~28.6% (sweep ceiling ~78–83%) because the router
has only invented example utterances. This is what pushes it past the **0.85 gate**.

- [ ] Confirm/obtain access to Laila production chat logs (docs/09 §8 open item).
- [ ] Mine 30–50 utterances per intent (min ~10), all four languages, **verbatim** incl. typos and
      romanized Kurdish. Priority: `loan` (the historic "loan → BTL" misroute) first.
- [ ] Label each with its TRUE intent (not the old dispatcher's routing decision).
- [ ] Include 10–20 out-of-domain messages (competitor/random) for abstain testing.
- **Where from:** Laila logs; fallback call-center transcripts; last resort colleagues.
- **Format:** the CSV — columns `utterance, language, script, intent_id, target_flow, source, notes`.
- **Time:** ~2–3 h of log mining for the first pass (given log access).

### 3. Vocabulary + catalogue CONFIRMs  → `vocab-confirm.md`

Cheap and wide: ~10 tables of fill-in-the-blank. Two items here are **blocking**:

- [ ] **Real Druid flow list** (`data/vocab/flows.json` is guessed) — without it, every routing
      label in items 2 and 5 is provisional. Source: the Druid flow-builder team / your own list.
- [ ] **Service-class list** (`red`, `yooz` are guesses) + which classes buy which bundles.
      Source: BSS / product team.
- [ ] The rest: locations granularity, bundle subtypes, glossary terms (Red/Yooz/ATL/BTL/
      Shukran/Bye Bye/PSMS), error sources, image categories, roaming model.
- **Format:** fill the "Confirmed value" column in `vocab-confirm.md`, then update `data/vocab/*.json`.
- **Time:** ~1–2 h total, mostly from memory + one chat with product/BSS + the Druid flow list.

### 4. Native-speaker review of ar/ckb/kmr text  → `native-review-pack.md`

All non-English seed text is machine-drafted; docs/21+20 require native sign-off before
`status: "verified"`. **Sequencing note:** the full pass only pays off *after* item 1 replaces the
placeholder text — but the terminology/intent strings and the review *process* can be validated now.

- [ ] Identify one native reviewer each for Iraqi Arabic, Sorani, Badini (can be colleagues).
- [ ] Hand them `native-review-pack.md` (currently 116 strings ≈ 30–60 min sitting).
- [ ] After seed-20 lands: regenerate
      (`node content-kit/extract-review-text.js > content-kit/review-text.generated.md`) and re-review.
- **Where from:** native-speaking colleagues.
- **Format:** tick boxes / inline corrections in the pack.
- **Time:** ~1 h per reviewer per pass.

### 5. Grow the gold set to 150–300 items  → format in `eval/gold/gold.jsonl`

The measurement instrument (docs/09 §3). Currently 42 items, all about invented bundles. Mostly
**falls out of items 1–2**: the worksheet's per-bundle test questions and the held-out 20% of log
utterances become gold items.

- [ ] 3–5 real-phrasing questions × language × seed-20 entity (captured in the worksheet, Part B).
- [ ] Hold out ~20% of the mined utterances (item 2) as routing gold items.
- [ ] Keep the mandatory **Kurdish slice** incl. romanized forms (docs/09 §3 — closes D5).
- [ ] Label each: `expected_chunk`, `expected_flow`, `gold_answer` (JSONL, one object per line —
      see existing `eval/gold/gold.jsonl` lines for the exact shape).
- **Time:** ~2–4 h labeling, can grow incrementally.

---

## After each batch lands (the loop that turns content into quality)

```
transcribe into data/seed + data/vocab
  → npm run ingest
  → npm run eval            (regression gate, docs/09 §6)
  → npm run eval -- --sweep (recalibrate ROUTE_TAU_HIGH / ROUTE_MARGIN in .env)
```

Prototype gates to beat (docs/09 §5): Hit@5 ≥ 0.85 overall / ≥ 0.70 Kurdish (already passing),
**routing accuracy ≥ 0.85** (the one waiting on this kit), false-route ≤ 0.05.

## Ground rules (apply to every worksheet)

- **Never estimate a number.** Blank = "needs lookup" and is safe; a guessed price/shortcode
  becomes a wrong answer to a customer. Everything currently invented is flagged with
  `attributes.review_note` in `data/seed/` — the audit table is in `seed-20-worksheet.md` Part C.
- **Verbatim beats clean.** For utterances and aliases, keep real spelling, dialect, and typos —
  that's what the embedder must match.
- **Redact PII** (phone numbers, names) from anything copied out of logs.
- One field confirmed ≠ entity confirmed: `review_note` comes off a file only when *every* field
  in it is real.
