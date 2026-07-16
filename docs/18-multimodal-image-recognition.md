# 18 — Multimodal Input: Image Recognition

**Status:** 🟡 Draft (categories need your confirmation) · **Owner:** Yousif · **Last updated:** 2026-06-28

> Laila receives **images** (e.g. a damaged scratch card). She must **recognize** what an image is, **route**
> it to the right flow, and where relevant **read** it (the card code). This reuses our routing pattern —
> with image vectors instead of text. Resolves **D10**.

---

## 1. Two distinct jobs

| Job | Example | Technique |
|-----|---------|-----------|
| **A. Classify & route** | "Is this an Asiacell scratch card? Zain? a SIM? an ID?" | Image embedding → nearest reference in image vector DB → category + provider + `target_flow` |
| **B. Extract / read** | "What's the 14-digit code on this card?" | Vision-LLM **OCR** (text reading) + damage assessment |

Job A decides *where it goes*; Job B reads *what's on it*. They're separate models.

## 2. Key technical fact: images need their own vector space

Image embeddings (from a multimodal model) are **not comparable** to BGE-M3 text vectors. So images live
in a **separate Qdrant collection** (`laila_images`) with their own model — never mixed with text chunks.

## 3. D10 — Approach: **Hybrid** ✅

| Component | Role | Why |
|-----------|------|-----|
| **Self-hosted multimodal embeddings** (OpenCLIP / SigLIP) | Job A — visual matching: Asiacell vs Zain vs Korek card, damaged vs intact, SIM vs ID | **Private** (no images leave the network), cheap, runs on the RTX 5060; provider/logo matching is exactly what visual embeddings are good at |
| **Vision-LLM** (Gemini Vision) | Job B — OCR the code, judge "damaged" | Best at reading text/condition; used **only when needed** after Job A classifies |

> **Why not vision-LLM for everything:** images may contain **PII** (national IDs). Doing classification
> locally means most images never leave the network; the vision-LLM is invoked narrowly (e.g. only to read
> a scratch-card code), and **ID images should be OCR'd locally** or not sent externally at all (doc 17).

### 3.5 Two image families (important refinement)

Most images Laila receives are **screenshots of SMS / app notifications**, not physical objects. They split
into two families needing different handling:

| Family | Examples | Primary technique |
|--------|----------|-------------------|
| **Text-bearing screenshots** | sub-notification SMS, PSMS-deduction SMS, balance SMS (after USSD), bundle-confirmation SMS, app screenshots, error screenshots | **OCR-first**: read the text → then it's a normal *text* problem → classify intent (doc 14) + retrieve knowledge. The image is just a delivery vehicle for text. |
| **Physical objects** | scratch card (Asiacell vs Zain/Korek), SIM, national ID | **Visual-embedding** classification (CLIP/SigLIP) for category + provider |

> Key consequence: for screenshots, the **vector DB's text side** does the real work after OCR — the same
> bundle/error/knowledge entities answer "what is this bundle, is it available on my line?" or "what is this
> deduction?". Visual embeddings are mainly for the physical-object family.

## 4. Image categories ⚠️ CONFIRM & COMPLETE

User confirms there are **many** categories (more to be added). Known so far — confirm actions per category:

| category | family | target_flow | Action |
|----------|--------|-------------|--------|
| `scratch_card` (intact) | object | scratch_card_flow | OCR code → validate via backend |
| `scratch_card` (damaged) | object | scratch_card_flow | OCR if possible → replacement process |
| `scratch_card` (competitor Zain/Korek) | object | out_of_domain | Neutral deflection (doc 14 §3) |
| `sim_card` | object | ? | ? |
| `national_id` | object | KYC? | **PII — process locally, never send out** |
| `sub_notification_sms` | screenshot | bundle_info / knowledge | OCR → identify bundle → explain |
| `bundle_confirmation_sms` | screenshot | bundle_info / eligibility | OCR → "what is this bundle, is it on my line?" |
| `psms_deduction_sms` | screenshot | deduction/complaint | OCR → explain the deduction |
| `balance_sms` | screenshot | balance_inquiry | OCR → read & explain balance |
| `loan_inquiry` | screenshot | loan_flow | OCR → explain loan status |
| `app_inquiry` | screenshot | knowledge/support | OCR → interpret app screen |
| `error_screenshot` | screenshot | error handling (doc 19) | OCR → look up error → explain |
| `payment_receipt` | screenshot | ? | ? |

## 5. Runtime flow

```
 image in
   │
   1. EMBED image (OpenCLIP/SigLIP, local)
   │
   2. SEARCH laila_images → nearest reference(s) → {category, provider, target_flow, score}
   │
   3. CONFIDENCE? ── low ──► ask customer to resend / clarify, or human handoff
   │      │ high
   4. PROVIDER? ── competitor ──► neutral deflection (doc 14 §3.1)
   │      │ asiacell
   5. NEED CODE/CONDITION?  ── yes ──► Vision-LLM OCR/damage  ── (ID? do locally) ──┐
   │                                                                                 │
   6. DISPATCH to target_flow with extracted data ◄─────────────────────────────────┘
```

## 6. Reference data (what we store)

- A small **reference set** of example images per `category`/`provider`, embedded into `laila_images`,
  each with payload `{category, provider, target_flow, instructions_ref}`.
- Linked **knowledge** (in the text DB) describing *what to do* for each category (e.g. damaged-card
  replacement steps) — so after recognition, Laila retrieves the procedure normally.
- **We do NOT store customer-submitted images** (privacy) — they're embedded/processed transiently. Only
  curated reference examples are stored.

## 7. Privacy & safety (ties to doc 17)

- **National ID / KYC images = sensitive PII.** Classify locally; do **not** send to external vision-LLMs;
  process transiently; log only the *category*, never the image or its contents.
- Reference images must be non-PII samples.
- Confidence threshold + abstain (as text routing) — a wrong image route (e.g. treating a Zain card as
  Asiacell) is a real error; prefer "please resend / let me get an agent."

## 8. Models & serving

- **Embeddings:** OpenCLIP or SigLIP via a small self-hosted service (similar pattern to TEI), GPU-backed.
- **OCR/condition:** Gemini Vision (non-PII cases) and/or a local OCR (e.g. for IDs). Confirm in §10.
- **Eval:** add an **image test set** to doc 09 (category accuracy, provider accuracy, OCR accuracy,
  false-accept of competitor cards).

## 9. Phasing

Image support is **not Phase-1-critical** (text first). Suggested: land text retrieval + routing, then add
images in Phase 2 — unless scratch-card handling is a top customer driver (your call).

## 10. Open items to confirm

- [ ] Provide the **real image categories** + desired action per category (§4).
- [ ] Confirm **OCR** is needed (scratch-card codes) and whether IDs must be read at all.
- [ ] Approve **local-only processing for ID/PII** images (doc 17).
- [ ] Confirm **competitor providers** to recognize (Zain, Korek, others?).
- [ ] Decide image phase: Phase 2 (default) vs sooner.
