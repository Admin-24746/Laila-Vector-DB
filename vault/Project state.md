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
- **Both audits fixed**, plus the four findings from the 2026-09-12 usefulness probe — every
  one pinned by a regression test.
- **Tests:** 190 passing. **Red team:** 21/21 safe. **`npm audit`:** 0 vulnerabilities.
- **Content:** real Asiacell catalogue in the index — 75 entities / 409 chunks. The invented
  placeholders are **retired**.
- **Branch:** `fix/audit-blocking-issues`, pushed.
- **Gates:** retrieval ✅ (**87.5%** / **85.7%** Kurdish) · routing ❌ (**8.9%**) —
  the first numbers measured against real content rather than placeholders. See
  [[Evaluation]] for why they moved.

## Is it usable by a chatbot? (probed 2026-09-12)

| Layer | Verdict |
|---|---|
| `/v1/retrieve` + `grounded_facts` | **Yes.** Correct facts in three languages at 80–160 ms. Threshold on `relevance`, never on `score` |
| `/v1/answer` | **Behind a human, or for number-shaped questions.** The number guardrail is strong and the new guards close the two fabrication routes, but a 3B model on this hardware takes 17–42 s and its Arabic prose is still rough |
| `/v1/route` | **No.** 8.9%, waiting on the log export |

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

### Blocked on people, not code

1. **The Laila log export.** The only thing that moves the routing gate. `npm run logs:extract`
   takes CSV / JSONL / a JSON array / a `{"value":[…]}` envelope, so the format is not the
   blocker — the file's existence is.
2. **Decide the subscription-answer strategy** (see the finding above): product/BSS supplies
   the codes, or `/v1/answer` hands subscription questions off to the tool that owns them.
3. **A small BSS lookup.** `bundle_1025`'s validity; which of the colliding ids 1013/1012 is
   Iran and which is UAE.
4. **Human verification.** Nothing is `status: verified`, which is why production serves
   nothing. This is the deployment gate — [[Managing the data]].
5. **A docs/21 native review** of the imported Arabic and Sorani text. It is prompt copy
   written for a bot, not customer-facing prose.
6. **`kmr` (Badini) copy** — absent from every source we have, so the Badini slice of the
   eval is honestly at zero.

### Open engineering work

7. **Deterministic deflections for neutrality / abuse / scope.** Introduced by the relevance
   floor on 2026-09-12: those baits score in the same band as unanswerable questions, so the
   floor catches them before the model can apply its own rules and they get the fixed scope
   reply instead of a composed one. Injection already has a deterministic deflection; these
   three need the same. Safe today, blunter than designed — [[Safety and security]].
8. **Comparison questions.** *"which is cheaper, X or Y?"* scores **0.520** and abstains even
   though both entities are in the top 5. A single max-relevance gate is the wrong shape for a
   two-entity question; it needs a higher `top_k` or a per-entity gate.
9. **Aliases.** A live probe for *"شكد سعر باقة يووز 25 مكس؟"* matched the **English** chunk,
   because the Arabic name in the export is the semantic "متوازن – يووز 25,000"; and
   *"پاکێجی ئینتەرنێتی مانگانە"* scores 0.415 because the real Sorani names say "4 هەفتەیی",
   not "مانگانە". The mechanical half can be generated from the names already in the
   entities; real customer phrasings still need the logs.
10. **Restore the eval coverage the gold migration lost** once real content allows it: a
    location-restricted bundle (worksheet row 16), `unsubscribe`, and fee items.
11. **Open a PR.** 18 commits ahead of `master`, all pushed, none reviewed by anyone but us.

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
| `a0432fd` | The hand-authored RED Line entity, and this vault |
| `08f06b8` | **The four usefulness-probe fixes** — placeholders retired, `relevance` exposed, the solicitation guard and relevance floor, `service_red_line` split, gold set migrated |
| `6dd32e6` | `npm run probe` |
| `37421d0` | The testing guide, and the production-mode finding |
| `5251ca0` | Docker, data/embedding management and terminal reference notes |
| `264aeec` | Said plainly which terminal the commands run in |

18 commits ahead of `origin/master`. All pushed; **none merged, no PR open.**

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
