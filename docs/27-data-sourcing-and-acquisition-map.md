# 27 — Data Sourcing & Acquisition Map

**Status:** 🟡 Draft (sources need your confirmation) · **Owner:** Yousif · **Last updated:** 2026-06-28

> Where each entity and field actually **comes from**, and how we get it in. Without this, "the data" is
> an abstraction; with it, ingestion (doc 07) has concrete inputs.

---

## 1. Source systems (confirm)

| Source | Provides | Notes |
|--------|----------|-------|
| **productOfferingQualification API** | Bundle list: bundleId, offerId, names×lang, price, expiry, detail, btlProductName | Seen in `ExtractBundles.JS`; **two formats — TMF & YOOZ** — extractor must handle both |
| **BSS / CBS** | Eligibility rules, errors, billing facts | APIs described as low-quality → expect manual cleanup |
| **CDR / BSS** | Live customer state (service class, whitelist, history) | **Runtime only — never stored** (doc 02 §4b) |
| **Roaming system / sheet** | Roaming packs + per-country rates | Already **mapped by Yousif**; also via API |
| **Manual mapping (Yousif)** | Most rules, edge cases, descriptions, intents, errors, terminology | The bulk of authored content |

## 2. Field-source map (authority & precedence)

| Entity / field group | Source | Refresh | Authority on conflict |
|----------------------|--------|---------|-----------------------|
| Bundle `facts` (price, validity, ids) | API (productOfferingQualification) | scheduled | **API wins** |
| Bundle `conditions` (locations, classes, fees) | mixed (API + manual) | mixed | case-by-case, documented |
| `description`, `how_to`, edge-cases | **manual** | on edit | **human wins** |
| `names`, `aliases`, `terminology` | manual (curated) | on edit | human |
| Roaming rates/coverage | manual map (+API) | on change | human/API |
| Errors | manual (+ BSS error list) | on edit | human |
| Intents (examples) | manual | on edit | human |

This is the **merge precedence** the normalizer applies (doc 07 §3).

## 3. Extraction approach

- **API sources:** a per-source **extractor** maps the raw response → canonical schema (doc 25). The
  bundle extractor normalizes **both TMF and YOOZ** shapes and **normalizes units** (doc 25 §4).
- **Manual sources:** authored via the CRUD/bulk tools + style guide (docs 20, 21).
- All paths converge at **normalize → validate → chunk → embed** (doc 07).

## 4. Bundle disambiguation (important for clean data)

Many bundles share a **display name** (e.g. several "Combo Bundle" with different `bundleId`/price). Rules:
- **Identity = `bundleId`** (doc 25), never the display name.
- When presenting options to a customer, **disambiguate by price + validity + contents** (e.g. "Combo
  5,000 IQD / 4 weeks" vs "Combo 7,500 IQD / 4 weeks").
- Entity resolution returns the **specific bundleId**, not a name, before any action.

## 5. Access & credentials
- List each API endpoint, auth method, and who owns access. (To fill once APIs are confirmed.)
- Reconciliation job (doc 07 §8) compares indexed data vs source to catch drift/staleness.

## 6. Open items to confirm
- [ ] Which **APIs are actually accessible** to you (endpoints/auth), and which entity types they cover?
- [ ] Confirm bundle source = **productOfferingQualification** (TMF + YOOZ) — any others?
- [ ] Where do **errors** and **eligibility rules** come from (BSS export? manual)?
- [ ] Confirm **per-field precedence** in §2 (API vs manual).
