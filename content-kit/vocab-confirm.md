# Vocabulary & CONFIRM Checklist

Every ⚠️ CONFIRM item across `data/vocab/*.json` and docs 14 / 18 / 19 / 26 / 27 / 28 (plus the
closely related open items from docs 16 / 25). For each: the **current placeholder**, and a blank
**Confirmed value** column to fill. Dirty vocab silently breaks filters (docs/26) — these are cheap
to confirm and everything downstream validates against them.

Most of these need no system access — just your knowledge, the Druid flow list, and one chat with
the product/BSS team. Estimated ~1–2 hours total.

---

## 1. `data/vocab/service_classes.json` (docs/26 §2, docs/28)

Current file has only two guessed entries.

| Item | Current placeholder | Confirmed value | Done |
|---|---|---|---|
| Full service-class list | `red`, `yooz` — "CONFIRM full list" | | ☐ |
| Labels per language for each class | ar «رد» / ckb «ڕێد» etc. (machine-drafted) | | ☐ |
| Aliases per class (how customers say it) | none captured | | ☐ |
| Which classes can buy which bundle families (Red vs Yooz etc.) | unknown | | ☐ |
| Is "line" / "primary offer" / "service class" truly the same concept? (docs/28) | assumed yes in `terminology_line.json` | | ☐ |

## 2. `data/vocab/locations.json` (docs/26 §2)

File has 9 entries; docs/26 lists 19 governorates.

| Item | Current placeholder | Confirmed value | Done |
|---|---|---|---|
| Granularity: do offers vary by **governorate or city**? | assumed governorate | | ☐ |
| Missing governorates to add (if governorate-level): anbar, diyala, wasit, maysan, dhi_qar, muthanna, babil, qadisiyyah, saladin, halabja | only 9 of 19 present | | ☐ |
| `mosul` vs `nineveh` — which is canonical? | file uses `mosul` "(Nineveh)" | | ☐ |
| ar/ckb/kmr labels for each (machine-drafted) | e.g. kmr "Bexda", "Besra" | | ☐ |
| Aliases (e.g. "Sully" → sulaymaniyah) | none captured | | ☐ |

## 3. `data/vocab/flows.json` (docs/14 — the big one for routing)

File header: "Replace with the real Druid flow ids."

| Item | Current placeholder | Confirmed value | Done |
|---|---|---|---|
| Real Druid flow id for loans | `loan_flow` | | ☐ |
| Real Druid flow id for BTL offers | `btl_flow` | | ☐ |
| Real Druid flow id for complaints | `complaint_flow` | | ☐ |
| Real Druid flow id for shop locator | `shop_locator_flow` | | ☐ |
| Real Druid flow id for knowledge questions | `knowledge_flow` | | ☐ |
| Real Druid flow id for human handoff | `human_handoff` | | ☐ |
| **Missing flows** — docs/14 §1 also lists: `atl_flow`, `purchase_bundle`, `unsub_flow`, `eligibility_flow`, `balance_flow`, `recharge_flow`, `roaming_flow`, `scratch_card_flow`, `smalltalk` | not in vocab file at all | | ☐ |
| Are ATL / BTL **separate info flows** or one? (docs/14 §6) | modeled as separate | | ☐ |
| Is purchase truly **one shared function** for ATL+BTL? (docs/14 §1) | assumed yes | | ☐ |
| Any flows in Druid that docs/14 §1 is missing entirely | — | | ☐ |
| 3–5 example utterances per intent — or approve LLM-drafting for your review (docs/14 §6) | placeholders in `data/seed/intents/` | see `utterances-instructions.md` | ☐ |
| Approve the brand-neutrality wording (docs/14 §3.1) for prompts | drafted | | ☐ |

## 4. `data/vocab/entity_types.json` + bundle subtypes (docs/26)

| Item | Current placeholder | Confirmed value | Done |
|---|---|---|---|
| `bundle_subtype` list beyond `atl` / `btl` / `corporate` | "CONFIRM" in docs/26 | | ☐ |
| What do ATL / BTL actually stand for & mean at Asiacell? (docs/28: "Above/Below The Line — confirm") | guessed | | ☐ |
| Future entity types to reserve (quality, process…? docs/02 §8) | none | | ☐ |

## 5. `data/vocab/languages.json` (docs/26, docs/21 §7, docs/25 §7)

| Item | Current placeholder | Confirmed value | Done |
|---|---|---|---|
| Are all four (en, ar, ckb, kmr) **required** before an entity can go live? | all marked `required: true` | | ☐ |
| Provider list to recognize (docs/26 §2): `asiacell, zain, korek, other` — complete? | as listed | | ☐ |

## 6. docs/27 — Data sourcing (§6 open items)

| Item | Current assumption | Confirmed value | Done |
|---|---|---|---|
| Which APIs are actually accessible to you (endpoints + auth) and which entity types they cover | unknown | | ☐ |
| Bundle source = productOfferingQualification (TMF + YOOZ formats) — any others? | assumed sole source | | ☐ |
| Where errors & eligibility rules come from (BSS export? manual?) | "BSS, low quality, expect manual cleanup" | | ☐ |
| Per-field precedence: API wins on facts, human wins on prose (§2) | proposed | | ☐ |

## 7. docs/19 — Errors (§9 open items)

| Item | Current assumption | Confirmed value | Done |
|---|---|---|---|
| Do backend errors have **stable codes**, or only message text? | both modeled (`match.codes` + `message_patterns`) | | ☐ |
| Source of the error list (BSS doc / API / your mapping) | unknown | | ☐ |
| Error classes that must **always escalate** (payment, fraud, security…) | drafted: payment failure, fraud, unknown | | ☐ |
| The **top ~10 errors driving today's escalations** (the seed error set) | none collected — there are **zero `error` entities** in `data/seed/` yet | | ☐ |

## 8. docs/18 — Image categories (§10 open items — Phase 2, low urgency)

| Item | Current assumption | Confirmed value | Done |
|---|---|---|---|
| Real image category list + action per category (§4 has 13 guessed rows; `sim_card` and `payment_receipt` have "?" for flow/action) | 13 guessed categories | | ☐ |
| Is scratch-card **OCR** needed? Must IDs be read at all? | assumed yes / undecided | | ☐ |
| Approve local-only processing for ID/PII images | proposed | | ☐ |
| Competitor providers to recognize (Zain, Korek, others?) | zain, korek | | ☐ |
| Image support phase: Phase 2 (default) or sooner? | Phase 2 | | ☐ |

## 9. docs/28 — Glossary terms marked CONFIRM

These become `terminology` entities (synonym resolution in retrieval), so wrong guesses here
directly cause wrong retrievals.

| Term | Current guess | Confirmed meaning + aliases per language | Done |
|---|---|---|---|
| **Red** | "a service-class/line type (?)" | | ☐ |
| **Yooz** | "a brand/line type; Yooz bundles need a Yooz line" | | ☐ |
| **ATL** | "Above The Line bundle category" | | ☐ |
| **BTL** | "Below The Line bundle category" | | ☐ |
| **Shukran** | "a service — confirm what it does" (seed guesses "rewards program") | | ☐ |
| **Bye Bye** | "a service — confirm" | | ☐ |
| **PSMS** | "Premium SMS (charged)" | | ☐ |
| **Elna w lil Kul** | "bundle with repeat-purchase fee (3×/month → +2,500 IQD)" | | ☐ |
| **Whitelist** | "per-customer eligibility config (live)" | | ☐ |
| Missing house terms/acronyms your team uses | — | | ☐ |
| Aliases per language for the high-traffic terms (باقة / پاکێج etc.) | partial | | ☐ |

## 10. Related open decisions (docs 16 / 25 / 09 / 20 — quick yes/no while you're at it)

| Item | Doc | Current assumption | Confirmed | Done |
|---|---|---|---|---|
| Roaming: packs, pay-as-you-go, or both? zones or per-country? where does rate data live? top destinations? | 16 §6 | modeled generically | | ☐ |
| `entity_id = {type}_{bundleId}` approved | 25 §7 | in use | | ☐ |
| Status workflow draft→needs_review→verified→retired | 25 §7 | in use | | ☐ |
| Acceptance bars (Hit@5 ≥0.85 etc.) approved as starting targets | 09 §8 | in use | | ☐ |
| Access to real Laila logs confirmed | 09 §8 | assumed | | ☐ |
| Who owns gold-set labeling | 09 §8 | Yousif (implicit) | | ☐ |
| Bulk format (CSV/JSON/Excel), self-promote in alpha, CLI-first OK, undo window | 20 §9 | CSV+JSON, yes, yes, TBD | | ☐ |
| Style guide approved as team standard; minimum languages per entity | 21 §7 | assumed 4 required | | ☐ |

---

**When a vocabulary is confirmed:** update the matching `data/vocab/*.json`, remove its
`_comment` PLACEHOLDER banner, and re-run `npm run ingest` — validation (docs/25 §5) enforces the
new list immediately. Flow-id changes also require updating `target_flow` in
`data/seed/intents/*.json` and `expected_flow` in `eval/gold/gold.jsonl`.
