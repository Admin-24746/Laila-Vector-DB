# 21 — Content Authoring Style Guide

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> You author most content **by hand**, so *how* you write it directly determines retrieval quality.
> Inconsistent authoring = inconsistent answers. This guide makes every entity findable and answerable.

---

## 1. Golden rules

1. **One answerable idea per section** (doc 03). Don't merge "how to subscribe" with "fees".
2. **Write the way customers ask**, not the way systems describe. ("How do I cancel?" not "Deactivation procedure.")
3. **Name the entity + aliases** so the contextual header works (doc 03 §4.2).
4. **State conditions explicitly** — never bury "Baghdad only" or "Red lines only".
5. **Numbers go in structured fields too** (`facts`/`conditions`), not just prose (doc 02) — the guardrail checks them.
6. **Author all required languages** with equivalent meaning.

## 2. Per-section checklist

| Section | Must include |
|---------|--------------|
| `overview` | What it is, what the customer gets, price, validity — in one tight paragraph |
| `subscribe` | Exact steps (USSD/SMS/app), any prerequisite |
| `unsubscribe` | Exact steps, any fee/consequence |
| `eligibility` | Service classes, locations, dates — plainly stated |
| `fees_edgecases` | Repeat-purchase fees, hidden charges, special rules (e.g. Elna w lil Kul) |
| `conflicts` | Which bundles/services clash, and what happens |

## 3. Language & dialect rules

- **Iraqi-dialect Arabic** (colloquial, not MSA), **Kurdish Sorani**, **Kurdish Badini**, **plain English**.
- Keep meaning equivalent across languages — don't add facts in one language only.
- Include **colloquial names & spellings** as `aliases` (how real customers say it, incl. romanized forms).
- Spell out abbreviations; add common synonyms (the terminology entities, doc 02).

## 4. Good vs bad (example)

```
❌ BAD  (vague, mixed ideas, no name, number only in prose)
   "Costs 5000. Subscribe and enjoy. Note region limits apply."

✅ GOOD (named, one idea, explicit condition, structured fact present)
   overview: "[Combo Bundle · BTL] 4 weeks of 500 on-net minutes, 25 on-net SMS, and 300MB data for
              5,000 IQD."
   eligibility: "[Combo Bundle · BTL] Available to Red service-class lines in Baghdad only."
   facts: { price_iqd: 5000 }   conditions: { eligible_locations:["baghdad"], eligible_service_classes:["red"] }
```

## 5. Always add test questions

For every entity, write **3–5 real-phrasing test questions** (per language) → these power the auto-test
(doc 20) so you instantly see the new entity is retrievable. Example: "extra fee if I sub Combo 3 times?"

## 6. Review checklist (before promote)

- [ ] One idea per section; named header; conditions explicit.
- [ ] Numbers also in `facts`/`conditions`.
- [ ] All required languages present and equivalent.
- [ ] Aliases incl. colloquial/romanized forms.
- [ ] 3–5 test questions added.
- [ ] Passes auto-test + sandbox (doc 20).

## 7. Open items to confirm
- [ ] Approve this as the team standard (and translate the checklist for authors).
- [ ] Decide minimum languages required per entity before it can go live.
