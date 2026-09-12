---
title: Project state
tags: [status, laila]
updated: 2026-09-12
---

# Project state

> [!info] `README.md` in the repo is the authority
> This note is the orientation version. When they disagree, the README is right — it is
> updated in the same commit as the work.

## Where things stand — 2026-09-12

- **Phase 0 + Phase 1: done.** Engineering backlog **empty**.
- **Both audits: fully fixed**, every finding pinned by a regression test.
- **Tests:** 179 passing. **`npm audit`:** 0 vulnerabilities (fastify 5.12.3).
- **Content:** real Asiacell catalogue in the index — 73 entities / 402 chunks.
- **Branch:** `fix/audit-blocking-issues`, pushed.
- **Gates:** retrieval ✅ (96.6% / 100% Kurdish) · routing ❌ (28.6%).

## What is blocking what

```
routing gate (0.85)  ←── real customer utterances  ←── THE LOG EXPORT  ← nobody has requested it
                                                        (everything downstream is built)

"how do I subscribe?" ←── how_to on the 50 bundles ←── A DESIGN CALL (see below)

trustworthy answers   ←── status: verified         ←── human review of every review_note
```

## The one finding that changes the plan

> [!danger] The bundles' subscription steps are not written down anywhere
> The ATL prompt file instructs the bot:
> *"Use only the tool, don't provide information about the subscription, renewal, stop or
> unsubscribe methods here, don't invent any steps"*
>
> The codes live behind a **`User_Self_Subscription` tool**, not in any document. So filling
> `how_to` is **not a transcription job**. Either the codes come from product/BSS, or
> `/v1/answer` learns to hand subscription questions off to that tool.
>
> Doing neither is the current state: retrieval returns a bundle card and the answer layer has
> nothing to say about subscribing. The 12 RED services are the exception — their steps were
> in the source and are indexed.

## Next, in order

1. **Get the log export.** The only thing that moves the routing gate. `npm run logs:extract`
   accepts CSV / JSONL / JSON array / `{"value":[…]}`, so the format is not a blocker — the
   file's existence is.
2. **Decide the subscription-answer strategy** (above).
3. **Aliases from the logs.** Without them the Arabic and English names of one bundle do not
   find each other — a live probe for *"شكد سعر باقة يووز 25 مكس؟"* matched the **English**
   chunk, because the Arabic name in the export is the semantic "متوازن – يووز 25,000".
4. **Retire the invented placeholders.** `bundle_1601/1602/1603`, `service_shukran` and
   `terminology_line` still hold invented prices and shortcodes. They were left in place
   because the gold set and `conflicts_with` point at them — retiring them has to move the
   eval with it.
5. **A small BSS lookup.** `bundle_1025`'s validity; which of the colliding 1013/1012 ids is
   Iran and which is UAE.
6. **`kmr` (Badini) copy** — absent from every source we have.
7. **The docs/21 native review** of the imported Arabic and Sorani text. It is prompt copy
   written for a bot, not customer-facing prose.

## Commit history that matters

| Commit | What |
|---|---|
| `ab98c99` | The six blocking findings from the 2026-08-21 audit |
| `567404c` | Recorded the audit; marked `HANDOVER.md` superseded |
| `9d4e62b` | The nine remaining 2026-08-22 findings |
| `418e5a4` | Brought the stack up on this laptop; fixed what that exposed |
| `7817ecd` | Per-entity number guardrail; deleted the legacy tree |
| `974aabf` | Verified the safety surface with a real LLM; fixed two real failures |
| `f83f6e5` | Scripted the routing-content pipeline |
| `e862789` | **Imported the real bundle catalogue** (50 bundles) |
| `a59b233` | **Imported the RED line plans as services** (12, with real subscribe steps) |

## Documents, and which to trust

| Document | Status |
|---|---|
| `docs/00–28` | ✅ The design contract. Authoritative on intent |
| `README.md` | ✅ Authoritative on current state |
| This vault | ✅ Orientation and runbook |
| `content-kit/` | ✅ The authoring worksheets |
| `content-kit/febra-import-report.md` | ✅ Generated; what imported and what did not |
| **`HANDOVER.md`** | ❌ **Describes a DELETED implementation** (`src/*.js`, port 7100, `content/entities/`). Every command in it targets modules that no longer exist |
| **`docs/29`** | ❌ Same |
| `content/` | ⚠️ Hand-authored data that nothing reads any more. Migrate what is useful into `data/seed/`, then delete |

Related: [[Evaluation]] · [[Content pipelines]] · [[Safety and security]]
