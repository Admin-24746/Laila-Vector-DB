---
title: Content pipelines
tags: [content, laila]
updated: 2026-09-12
---

# Content pipelines

Two pipelines turn raw company data into seed entities. Both share one rule, taken from
`content-kit/seed-20-worksheet.md`:

> [!important] Every number must be real or left blank — never estimated
> A blank field is data: it says "needs a lookup". A guessed number is a future wrong answer
> to a customer. Both importers refuse rows rather than half-fill them, and put the refusal
> in a report with its reason.

## 1. Bundles — the FEBRA import

```bash
npm run bundles:import -- --dry-run   # report only, writes nothing
npm run bundles:import                # writes entities + content-kit/febra-import-report.md
```

**Source:** `D:\Projects\DevOps\febra\FEBRA PROJECT\` — the bot-flow export.
**Code:** `src/lib/febra.js` (logic) + `scripts/febra-to-seed.mjs` (CLI), pinned by
`test/febra.test.js`.

It reads two different things and joins them:
- `bundles_{ATL,Line,Yooz}_FEBRA_En.json` — the facts (id, price, validity, description)
- `ATL/Yooz/Line FEBRA Ar|Ku` — prompt files whose per-bundle blocks carry the **Arabic and
  Sorani copy**, keyed by `BundleID` (or, for the RED plans, by name)

**Result: 62 of 73 rows.** 50 bundles + 12 RED plans as services. 11 refused.

### What it refuses, and why

| Refused | Why |
|---|---|
| 2 rows, ids 1013 / 1012 | Each id is claimed by **two different products** (Iran *and* UAE roaming). Importing either would answer one country's question with the other's facts |
| 9 roaming rows | Structurally broken — empty names, or one row that is bot instruction text listing six countries' packages under a single id and price |
| `bundle_1025` | Its `validity` cell was mangled by the export and no translation states a duration. The name says "Daily" — **a name is not a stated validity** |

### Four deliberate refusals inside the import

1. **No invented `how_to`.** The ATL/Yooz export carries no subscription steps, and inventing
   a `*123#` is how the placeholder seed went wrong.
2. **An unlimited bundle's GB figure is the FUP threshold, not an allowance.** "Unlimited for
   24 hours … FUP applied after using (3GB)" imports with `data_mb` **blank**.
3. **No machine translation.** `ar`/`ckb` are the export's own copy. **`kmr` is absent from
   the export** and stays blank.
4. **No minutes/SMS split.** "500 mins , 500 SMS To all networks" does not map onto
   `minutes_onnet`/`minutes_offnet`. The figures survive in the description, which is what
   gets embedded.

### Two traps in the source it handles

> [!danger] The Arabic file's shortcodes are corrupted
> It writes `*230#` as `#230` — ten times — while the Kurdish file and the Arabic file's own
> other codes (`*133#`, `*244#`) are intact. It is the RTL mangling the source itself warns
> against. `repairUssd()` rewrites `#NNN` **only** when `*NNN#` appears in the English row for
> that same plan, so the fix is grounded rather than guessed, and a legitimate `*#313#` is
> left alone. Without it the index would teach customers a code that does not dial.

> [!warning] The translated files rename the plans
> "RED Family 50" is "RED العائلي 50"; "RED 15 — 12 Weeks" is "RED 15 لمدة 12 أسبوعاً". Exact
> name matching found six of twelve. `redSignature()` keys on the tier attached to RED plus
> family / 12-week markers — reading the tier from **RED's own** number, since the first
> number in the line makes "RED 15 — 12 Weeks" the 12 tier.

### Why the RED plans are services

They have no `bundleId`, so they cannot be bundles. That is not a workaround: a RED plan is a
**tariff on a line**, not a bundle bought against one. They are also the only rows in the
whole export that state how to subscribe — eight of twelve carry real steps; the four 12-week
app-exclusive plans state none and get no `subscribe` chunk rather than an invented one. All
twelve point at `service_red_line` via `belongs_to_service`.

`service_red_line` itself is **hand-authored**, not generated — it comes from the prose
sections of the Line files, and a parser for prose would be fragile. Its languages carry
deliberately different depth: the standard tariff, the one-way switch to RED, and "send 0 to
230" to cancel a package exist only in the Arabic source, so they appear only in
`description.ar`.

## 2. Routing utterances — the log pipeline

```bash
npm run logs:extract -- <export> --inspect   # sniff format/columns, write nothing
npm run logs:extract -- <export>             # → content-kit/utterances-<date>.csv
#   ... a human fills in intent_id ...
npm run utterances:import -- <csv> --dry-run # report the 80/20 split
npm run utterances:import -- <csv>           # write intent examples + gold items
```

**Code:** `src/lib/logmine.js` + `src/lib/csv.js`, pinned by `test/logmine.test.js`.

**Status: blocked — the export does not exist yet.** Everything else is built.

Stage 1 does not assume a schema, because nobody knows what the log system will hand over: it
sniffs CSV / JSONL / JSON array / `{"value":[…]}`, works out the text, session, role and time
columns across naming conventions, keeps the first customer turn per conversation, drops bot
turns, dedupes with a "seen 12×" note, **redacts MSISDNs and emails**, and labels
language/script with the service's own detector.

> [!important] `intent_id` is left blank on purpose
> It is the one step that must be human. Copying the old dispatcher's routing decisions would
> teach the new router the old bugs — including the "loan → BTL" misroute this whole exercise
> exists to fix.

Stage 2 validates against `data/vocab/flows.json`, then splits 80/20. The split is
**hash-based, not random**, so adding 200 more utterances later leaves every existing row on
the side it was already on. A reshuffle would silently break comparability between eval runs.
It warns when an intent has under 10 rows, when an intent ends up with zero held-out rows, and
when a new intent id looks like a duplicate of an existing one.

Related: [[Data model]] · [[Evaluation]] · [[Project state]]
