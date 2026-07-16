# 26 — Controlled Vocabularies

**Status:** 🟡 Draft (lists need your real values) · **Owner:** Yousif · **Last updated:** 2026-06-28

> Canonical fixed lists that authoring and validation reference, so the same thing is always written the
> same way. No free-typing `baghdad`/`Baghdad`/`بغداد` — one canonical code, with display names per
> language. Dirty vocab silently breaks filters; this prevents it.

---

## 1. How vocabularies work

- Each vocabulary is a list of **{ code, display_names{lang}, aliases[] }**.
- **Authors pick a code**, never free-type. **Validation rejects** values not in the vocab (doc 25 §5).
- Vocabularies are **versioned data** (doc 07); adding a value is a small reviewed change.

## 2. Vocabularies ⚠️ CONFIRM & COMPLETE (placeholders — give me your real lists)

### `service_class` (a.k.a. line / primary offer)
```
red, yooz, …   ← CONFIRM full list + which buy what
```
> e.g. `{ code:"red", names:{en:"Red", ar:"…", ckb:"…"}, aliases:["red line"] }`

### `location` (Iraqi governorates — canonical)
```
baghdad, basra, sulaymaniyah, erbil, duhok, kirkuk, najaf, karbala, anbar, diyala,
wasit, maysan, dhi_qar, muthanna, babil, qadisiyyah, saladin, nineveh, halabja
```
> Each with names in en / ar-IQ / ckb / kmr + aliases (Sully→sulaymaniyah). **Confirm coverage.**

### `provider`
```
asiacell, zain, korek, other
```

### `language`
```
en, ar-IQ (Iraqi Arabic), ckb (Sorani), kmr (Badini)
```

### `bundle_subtype`
```
atl, btl, corporate, …   ← CONFIRM
```

### `units`
```
currency: IQD (int)   data: MB (int; 1GB=1024)   validity: days (int)
voice: minutes (int)  sms: count (int)
```

### `entity_type`
```
bundle, service, roaming, intent, error, image_ref, terminology  (+future)
```

### `flow_id` / `intent_id`  → from doc 14 (the flow catalogue)
### `image_category`        → from doc 18
### `error_severity`        → info, warning, blocking, sensitive (always escalate)
### `status`                → draft, needs_review, verified, retired

## 3. Cross-references

- `service_class` ↔ used by bundle `eligible_service_classes`, eligibility (doc 02 §4b), terminology (doc 28).
- `location` ↔ bundle `eligible_locations`, roaming countries (doc 16).
- `provider` ↔ images (doc 18), out-of-domain competitor handling (doc 14).

## 4. Governance
- One **owner** per vocabulary keeps it authoritative and in sync with the systems.
- Renames are **migrations** (update all referencing records) — avoid; prefer add + deprecate.

## 5. Open items to confirm (your real values)
- [ ] Full **service_class** list (+ which classes can buy which bundle families, e.g. Red vs Yooz).
- [ ] Confirm **location** list (governorates vs cities; do bundles vary by city or governorate?).
- [ ] Confirm **providers** to recognize.
- [ ] Confirm **bundle_subtype** list beyond ATL/BTL/Corporate.
