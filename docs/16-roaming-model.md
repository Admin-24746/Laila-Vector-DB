# 16 — Roaming Model

**Status:** ✅ Draft — **CONFIRMED:** both **packs + pay-as-you-go rates**, **per-country**; rate/coverage
data already mapped by Yousif (also available via API). · **Owner:** Yousif · **Last updated:** 2026-06-28

> Roaming is in v1, but it's **structurally different** from bundles: it's organized by **geography**
> (countries/zones) and **partner operators**, with per-destination rates. This doc models roaming as its
> own entity type so retrieval can answer "I'm traveling to Türkiye — what are my options?"

---

## 1. Why roaming ≠ bundle

| Bundle | Roaming |
|--------|---------|
| One product, fixed contents | Varies by **destination country / zone** |
| Eligibility by service class/location | Also depends on **partner operator** abroad |
| Price = one number | **Per-destination rates** (data/call/SMS), or a roaming bundle |
| "Subscribe" | "Activate roaming" + sometimes buy a roaming pack |

So roaming needs **country/zone** as a first-class, filterable dimension.

## 2. Entity model (`type: roaming`)

Two complementary subtypes:

```jsonc
// (a) A roaming PACK (a buyable bundle that works abroad)
{ "id":"roaming_pack_gulf_5gb", "type":"roaming", "subtype":"pack",
  "names": { "en":"Gulf Roaming 5GB", "ar":"…", "ckb":"…", "kmr":"…" },
  "description": { "en":"5GB data valid in Gulf zone for 7 days…", … },
  "how_to": { "activate": {…}, "deactivate": {…} },
  "conditions": { "zones":["gulf"], "countries":["sa","ae","kw","qa","bh","om"],
                  "eligible_service_classes":[…], "valid_days":7 },
  "facts": { "price_iqd": 50000, "data_gb":5 } }

// (b) Pay-as-you-go RATES for a destination (no pack)
{ "id":"roaming_rates_tr", "type":"roaming", "subtype":"rates",
  "names": { "en":"Roaming rates — Türkiye", … },
  "conditions": { "countries":["tr"], "zone":"europe_neighbours",
                  "partner_operators":["Turkcell","Vodafone TR"] },
  "facts": { "data_per_mb_iqd": X, "call_out_per_min_iqd": Y,
             "call_in_per_min_iqd": Z, "sms_iqd": W } }
```

## 3. Sections / chunks (doc 03 applied)

| Section | Answers |
|---------|---------|
| `overview` | "What is this roaming pack / how does roaming work?" |
| `activate` / `deactivate` | "How do I turn roaming on/off?" |
| `coverage` | "Which countries/operators are covered?" |
| `rates` | "How much is data/calls in <country>?" |
| `troubleshooting` | "Roaming not working abroad" |

Per language, with contextual headers, as usual.

## 4. Retrieval specifics

- **Country/zone as metadata filter:** "traveling to Türkiye" → resolve country → `countries: contains "tr"`
  → return only relevant roaming entities.
- **Country entity resolution:** multilingual + variant names (Türkiye/Turkey/تركيا/تورکیا) → canonical
  ISO code. Store these as **aliases** (doc 02) / terminology so all forms match.
- **Eligibility stays deterministic** (doc: service class, whitelist) — same Bucket-A rule; roaming
  activation eligibility is a code check, not the LLM.

## 5. Data sourcing

- Rates and coverage likely come from a **roaming/partner system or sheet** → an API extractor or manual
  mapping (your authoring, doc 07). Rates change → incremental update (doc 07 §6).
- Flag **stale rates** risk: roaming prices are sensitive; reconciliation (doc 07 §8) matters here.

## 6. Open items to confirm

- [ ] Is roaming sold as **packs**, **pay-as-you-go rates**, or **both**? (decides subtypes)
- [ ] Are destinations grouped into **zones**, or strictly per-country?
- [ ] Where does roaming **rate/coverage data** live (system/sheet/partner feed)?
- [ ] Confirm **activation/deactivation** steps and whether eligibility differs from normal bundles.
- [ ] List the **top destinations** customers ask about (seed set for roaming).
