# 28 — Domain Glossary

**Status:** 🟡 Draft (terms need your validation) · **Owner:** Yousif · **Last updated:** 2026-06-28

> A human-readable dictionary of every domain term — for onboarding, consistent language, and to **seed
> the `terminology` entities** (doc 02) so synonyms resolve in retrieval. Many entries below are my best
> guess — **please correct/complete**.

---

## 1. How this connects

Each glossary entry also becomes a `type:terminology` record (doc 02 §2) → so customer/agent synonyms map
to the same canonical thing during retrieval and entity resolution.

## 2. Glossary ⚠️ CONFIRM & COMPLETE

| Term | Meaning (CONFIRM) | Aliases / synonyms |
|------|-------------------|--------------------|
| **Line** | The customer's subscription/plan type | = primary offer = service class |
| **Primary offer** | Same as line/service class | |
| **Service class** | The line category that governs eligibility | |
| **Red** | A service-class/line type (?) — **confirm** | |
| **Yooz** | A brand/line type; Yooz bundles need a Yooz line | |
| **ATL** | "Above The Line" bundle category — **confirm** | |
| **BTL** | "Below The Line" bundle category — **confirm** | |
| **Corporate** | Corporate bundle category | |
| **Bundle** | A buyable package (data/voice/SMS/balance) | باقة / پاکێج |
| **Service** | A capability/feature (may contain bundles) | Shukran, Bye Bye, … |
| **On-net / Off-net** | Calls within Asiacell vs to other networks | inside/outside network |
| **All-net** | Applies to all networks | |
| **Elna w lil Kul** | Bundle with a repeat-purchase fee (3×/month → +2,500 IQD) | |
| **Shukran** | A service — **confirm what it does** | |
| **Bye Bye** | A service — **confirm** | |
| **PSMS** | Premium SMS (charged) — **confirm** | psms deduction |
| **USSD** | Dial-code interface (e.g. *123#) | |
| **Scratch card** | Recharge card with a code | |
| **Whitelist** | Per-customer eligibility config (live) | |
| **Roaming** | Using the line abroad | |
| **CBS / BSS** | Billing/business support systems (source of truth) | |

## 3. Rules for the glossary
- Each term: canonical meaning + **aliases per language** (incl. romanized/colloquial).
- Keep it the **single source of truth** for terminology; when a term changes, update here → re-seed the
  `terminology` entity.
- Owner keeps it current; it's reviewed like other content (doc 07).

## 4. Open items to confirm
- [ ] Validate/define the **CONFIRM** terms above (Red, Yooz, ATL, BTL, Shukran, Bye Bye, PSMS…).
- [ ] Add any missing house terms / acronyms your team uses.
- [ ] Provide **aliases per language** for the high-traffic terms.
