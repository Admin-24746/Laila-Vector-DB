# 25 — Data Dictionary & Validation

**Status:** ✅ Draft · **Owner:** Yousif · **Last updated:** 2026-06-28

> The rigorous, field-by-field schema for every entity type — the contract authoring and validation
> enforce so the data stays clean. Resolves **D16** (canonical ID), **D17** (relationships), **D18**
> (unit normalization).

---

## 1. Canonical identity (D16)

- **Primary key:** `entity_id = "{type}_{systemId}"` (e.g. `bundle_1601`). The `{systemId}` for bundles is
  the **numeric `bundleId`** — stable, present on every record.
- **`offerId`** is stored as a **secondary identifier** (may be null) — searchable, not the key.
- **Save the COMPLETE record** (user requirement): names ×all languages, descriptions ×all languages,
  prices, all rules/conditions, validity, product codes, relationships — nothing dropped.

## 2. Universal fields (every entity)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `entity_id` | string | ✅ | `{type}_{systemId}`; unique |
| `type` | enum | ✅ | vocab `entity_type` (doc 26) |
| `subtype` | enum | ⚪ | vocab per type |
| `names` | map<lang,string> | ✅ | all required languages (doc 26 `language`) |
| `aliases` | list<string> | ⚪ | colloquial/romanized forms |
| `status` | enum | ✅ | `draft` \| `needs_review` \| `verified` \| `retired` |
| `source` | enum | ✅ | `api` \| `manual` \| `mixed` (doc 27) |
| `version` | int | ✅ | bumped on change |
| `updated_at` | datetime | ✅ | ISO 8601 |
| `languages_present` | list<lang> | ✅ | for completeness checks |

## 3. Bundle entity (full field set)

| Field | Type | Required | Allowed / Unit |
|-------|------|----------|----------------|
| `subtype` | enum | ✅ | `atl` \| `btl` \| `corporate` (vocab) |
| `bundleId` | int | ✅ | system id |
| `offerId` | string | ⚪ | secondary id |
| `btlProductName` / `subProductName` | string | ⚪ | product code |
| `serviceName` | string | ⚪ | link to parent service (§6) |
| `names` | map<lang,string> | ✅ | display name per language |
| `description` | map<lang,string> | ✅ | prose per language |
| `how_to.subscribe` / `.unsubscribe` | map<lang,string> | ⚪ | steps |
| **Normalized facts (D18)** | | | |
| `price_iqd` | int | ✅ | integer IQD (no separators) |
| `validity_days` | int | ✅ | normalized (4 Weeks→28, 7 days→7) |
| `data_mb` | int | ⚪ | normalized (1GB→1024) |
| `minutes_onnet` / `minutes_offnet` | int | ⚪ | |
| `sms_onnet` / `sms_offnet` | int | ⚪ | |
| `display.price` / `display.validity` | map<lang,string> | ⚪ | original strings kept for display |
| **Conditions** | | | |
| `eligible_service_classes` | list<enum> | ⚪ | vocab `service_class`; empty=all |
| `eligible_locations` | list<enum> | ⚪ | vocab `location`; empty=everywhere |
| `valid_from` / `valid_to` | date | ⚪ | promo windows |
| `repeat_purchase_fee_iqd` | int | ⚪ | e.g. 2500 |
| `repeat_purchase_threshold` | int | ⚪ | e.g. 3 |
| **Relationships (D17)** | | | |
| `belongs_to_service` | entity_id | ⚪ | parent service |
| `conflicts_with` | list<entity_id> | ⚪ | |
| `offers` | list<string> | ⚪ | related offer ids |

*(Service, roaming, intent, error, image_ref, terminology each get their own field table — same pattern;
drafted alongside this doc as the schema files.)*

## 4. Unit normalization rules (D18)

| Source seen | Normalize to |
|-------------|--------------|
| "10,000 IQD", Arabic-Indic digits | `price_iqd: 10000` (int) |
| "4 Weeks" / "7 days" / "28 days" | `validity_days` (int) |
| "1GB" / "500MB" | `data_mb` (int; GB×1024) |
| "500 minutes" | `minutes_*` (int) |
| mixed digit scripts | convert ٠-٩ → 0-9 |

Always **keep the original display string** (per language) for showing the customer; **filter/compute on
the normalized number.**

## 5. Validation rules (gate, extends doc 07 §4)

- **Required** universal + per-type fields present.
- **Types** correct; **enums** ∈ controlled vocab (doc 26).
- **Units** within sane ranges (price>0, validity_days>0).
- **Dates**: `valid_from ≤ valid_to`.
- **Referential**: `belongs_to_service`, `conflicts_with`, `target_flow` point to existing entities/vocab.
- **Language completeness**: all required languages present (policy, doc 21).
- **Uniqueness**: `entity_id` unique.
- **Status**: only `verified` content may be promoted to live (doc 20).

## 6. Relationships model (D17)

```
 Service ──contains──► Bundle ──conflicts_with──► Bundle
    ▲                    │
    └──belongs_to_service┘     Bundle ──offers──► OfferId
```

Stored as `entity_id` references in payload; resolvable both ways. Enables "what bundles are in the
Shukran service?" and conflict/eligibility reasoning.

## 7. Open items to confirm
- [ ] Approve `entity_id = {type}_{systemId}` and **bundleId** as the bundle system id.
- [ ] Confirm the **required languages** per entity (gate).
- [ ] Confirm the **status workflow** (draft→needs_review→verified→retired).
- [ ] Review the per-type field tables (service/roaming/intent/error/image_ref) as they're finalized.
