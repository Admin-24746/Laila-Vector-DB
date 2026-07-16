# Seed-20 Worksheet — the top ~20 real bundles/services

**Goal (docs/07 §9, docs/02 §8):** replace the invented seed with the **real top ~20 bundles/services**
customers actually ask about. This one deliverable unblocks retrieval quality, the gold set, and the
answer layer all at once.

**Primary source (docs/27):** the **productOfferingQualification API** (both **TMF** and **YOOZ**
response formats) for facts — `bundleId`, `offerId`, names per language, price, expiry, detail,
`btlProductName`. **BSS/CBS** (or your own knowledge) for eligibility rules and fees. **You (manual)**
for descriptions, how-to steps, edge cases, aliases.

**Rules while filling (docs/25, docs/27 §4):**
- Identity = **`bundleId`** (numeric), never the display name — several bundles share a name
  ("Combo 5,000 IQD / 4 weeks" vs "Combo 7,500 IQD / 4 weeks" are different rows).
- Normalized units (D18): price as **integer IQD**, validity in **days** (4 weeks → 28), data in
  **MB** (1 GB → 1024). Keep the original display strings too.
- Empty `eligible_locations` / `eligible_service_classes` means **everywhere / everyone** — only
  leave empty if that is genuinely true.
- Every number must be **real or left blank** — never estimated. A blank cell is data ("needs BSS
  lookup"); a guessed number is a future wrong answer to a customer.

---

## Part A — Pick the 20 (candidate slots)

Rows 1–8 are names that already exist in the repo/docs. Rows 9–20 are **category slots** — replace
each with the real best-seller in that category (pull the ranking from BSS purchase stats or the
product team; "most purchased + most asked-about in Laila logs" is the selection rule).

| # | Slot / working name | Where it came from | Status in repo | Real bundleId | Real name | Keep? |
|---|---|---|---|---|---|---|
| 1 | Combo Bundle (5,000 IQD tier) | docs/03 §5 worked example → `bundle_1601.json` | in repo — facts from docs example, **shortcodes invented** | | | ☐ |
| 2 | Combo Bundle (7,500 IQD tier) | docs/27 §4 disambiguation example | not in repo | | | ☐ |
| 3 | "Elna w lil Kul" | docs/28 glossary (repeat-purchase-fee bundle: 3×/month → +2,500 IQD) | not in repo — pattern only | | | ☐ |
| 4 | Monthly data bundle (ATL) | placeholder `bundle_1602.json` "Super Net Monthly" | in repo — **entirely invented** | | | ☐ |
| 5 | Weekly data bundle (ATL) | placeholder `bundle_1603.json` "Weekly Net" | in repo — **entirely invented** | | | ☐ |
| 6 | Shukran (service) | docs/02, `service_shukran.json` | in repo — name real, **definition invented** | n/a (service) | | ☐ |
| 7 | Bye Bye (service) | docs/28 glossary — "confirm what it does" | not in repo | n/a (service) | | ☐ |
| 8 | Top Yooz-line bundle | docs/28 ("Yooz bundles need a Yooz line") | not in repo | | | ☐ |
| 9 | Daily data bundle — best seller | category slot | — | | | ☐ |
| 10 | Weekly data bundle #2 (different size/price) | category slot | — | | | ☐ |
| 11 | Monthly data bundle #2 (bigger tier) | category slot | — | | | ☐ |
| 12 | Voice/minutes bundle — best seller | category slot | — | | | ☐ |
| 13 | Combo/mixed bundle #3 (another tier) | category slot | — | | | ☐ |
| 14 | Social-media / app-specific bundle (if exists) | category slot | — | | | ☐ |
| 15 | Night / off-peak bundle (if exists) | category slot | — | | | ☐ |
| 16 | A location-restricted bundle (e.g. Sulaymaniyah-only — the docs/19 error example) | category slot — **must include one** to exercise eligibility | — | | | ☐ |
| 17 | A BTL/personalized offer example | category slot — exercises `btlProductName` | — | | | ☐ |
| 18 | A corporate bundle example | category slot — exercises `subtype: corporate` | — | | | ☐ |
| 19 | Top roaming pack / destination (docs/16 — you already mapped roaming) | roaming sheet | — | | | ☐ |
| 20 | Loan / balance-advance service terms (fee, limit, repayment) | docs/14 `loan` intent — the historic misroute | not in repo | n/a (service) | | ☐ |

> Fewer than 20 real categories? Fill what exists — 12 real bundles beat 20 half-guessed ones.
> More than 20 candidates? Prioritize by Laila-log question frequency.

---

## Part B — Per-bundle capture form

Copy this block **once per row of Part A** (a spreadsheet with these as columns also works — one
row per bundle; docs/20 §2 supports CSV/JSON bulk import). Then transcribe into
`data/seed/bundles/bundle_{bundleId}.json` using `data/seed/bundles/_TEMPLATE.bundle.json`.

Every value below shows **where to get it** per docs/27 §2 (API = productOfferingQualification;
manual = you/product team).

```
Bundle: ______________________            Source row confirmed by: __________  Date: ________

IDENTITY (API)
  bundleId (int, the key): ______         offerId: ______        btlProductName: ______
  subtype: atl / btl / corporate

NAMES (API + manual curation)
  en: ______________________              ar: ______________________
  ckb: _____________________              kmr: _____________________
  aliases (how customers actually type it, incl. romanized/colloquial — from logs):
  ____________________________________________________________________

FACTS (API — API wins on conflict, docs/27 §2)
  price_iqd (int): ________               validity_days (int): ________
  data_mb (int, 1GB=1024): ________       minutes_onnet: ______  minutes_offnet: ______
  sms_onnet: ______  sms_offnet: ______
  display.price as shown to customer (en/ar/ckb/kmr): ______________________
  display.validity as shown (en/ar/ckb/kmr): ______________________

HOW-TO (manual — human wins, docs/27 §2)   ← today's invented *123# codes get replaced here
  subscribe steps (exact USSD code / SMS keyword+shortcode / app path):
  ____________________________________________________________________
  unsubscribe steps + any cancellation fee/consequence:
  ____________________________________________________________________
  auto-renew? yes / no    renewal behavior: ______________________

CONDITIONS (mixed API + manual/BSS)
  eligible_service_classes (empty = all): ______________________
  eligible_locations (empty = everywhere): ______________________
  valid_from: ________   valid_to: ________  (promo window, if any)
  repeat_purchase_fee_iqd: ______   repeat_purchase_threshold: ______  (Elna-w-lil-Kul pattern)
  other hidden fees / edge cases (docs/21 §2 fees_edgecases): _______________

RELATIONSHIPS (manual, D17)
  belongs_to_service: ______________  conflicts_with (bundleIds): ______________
  what happens on conflict (blocked? replaces? stacks?): ______________________

TEST QUESTIONS (manual — docs/21 §5, powers the auto-test in docs/20 §3)
  3–5 real-phrasing questions PER LANGUAGE this bundle must answer
  (best: lift verbatim from Laila logs; these also become gold-set items):
  en: 1) ____________  2) ____________  3) ____________
  ar: 1) ____________  2) ____________  3) ____________
  ckb: 1) ____________  2) ____________  3) ____________
  kmr: 1) ____________  2) ____________  3) ____________
```

---

## Part C — What in the CURRENT seed is invented (audit of `review_note` flags)

Everything below is flagged in-file via `attributes.review_note`. **None of it may survive into
`status: "verified"` unconfirmed.**

| File | Field(s) | Current value | Verdict |
|---|---|---|---|
| `bundles/bundle_1601.json` | `how_to.subscribe` codes | `*123*1#`, `COMBO` → `1234` | **INVENTED** — replace |
| `bundles/bundle_1601.json` | `how_to.unsubscribe` codes | `STOP COMBO` → `1234`, `*123#` | **INVENTED** — replace |
| `bundles/bundle_1601.json` | facts | 5,000 IQD / 28 d / 500+25 on-net / 25+25 off-net / 300 MB | from the docs' worked example — **confirm against API** |
| `bundles/bundle_1601.json` | conditions | `red` + `baghdad` only; repeat fee 2,500 IQD @ 3rd | from docs example — **confirm** |
| `bundles/bundle_1601.json` | `valid_from` | 2026-06-20 | example date — **confirm** |
| `bundles/bundle_1602.json` | everything | name "Super Net Monthly", 10 GB/30 d/10,000 IQD, `*321*1#`, `NET10`→`1234`, conflict with 1603 | **ENTIRELY INVENTED** — replace with a real ATL bundle |
| `bundles/bundle_1603.json` | everything | name "Weekly Net", 2 GB/7 d/3,000 IQD, `*321*2#`, `NET2`→`1234`, conflict with 1602 | **ENTIRELY INVENTED** — replace with a real weekly bundle |
| `services/service_shukran.json` | definition + how-to | "rewards program", `SHUKRAN`→`333` | name is real; **definition + shortcode INVENTED** |
| `terminology/terminology_line.json` | ar/ckb/kmr text | line = primary offer = service class | meaning from docs — translations need **native review** |
| `intents/*.json` (all 5) | all example utterances | hand-written guesses | replace/extend with **real Laila-log utterances** (see `utterances-template.csv`) |
| `eval/gold/gold.jsonl` | all 42 items | questions about the invented bundles above | rebuild from real entities + real phrasings (kit README, item 5) |

Also inherited by the invented bundleIds: **`1601`/`1602`/`1603` themselves** — if the real Combo
has a different bundleId, the file names, `entity_id`s, `conflicts_with` references, and every
`expected_chunk` in `eval/gold/gold.jsonl` must change with it.

---

## Part D — After the worksheet is filled

1. Transcribe each bundle → `data/seed/bundles/bundle_{bundleId}.json` (copy `_TEMPLATE.bundle.json`).
2. Delete or overwrite the placeholder files (1602/1603; 1601 if the real Combo differs).
3. Remove each file's `attributes.review_note` only when every field in it is confirmed.
4. `npm run ingest` → `npm run eval` → `npm run eval -- --sweep` → update `ROUTE_TAU_HIGH` /
   `ROUTE_MARGIN` in `.env` (root README, "Next session").
5. Send the new ar/ckb/kmr text through `native-review-pack.md` (regenerate it first —
   `node content-kit/extract-review-text.js > content-kit/review-text.generated.md`).
