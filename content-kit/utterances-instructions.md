# Collecting real intent utterances (docs/09 §3, workstream 2)

This is what fixes routing. Routing accuracy is stuck at ~28.6% (sweep ceiling ~78–83%) **because
the intent examples are invented** — the router has never seen how Iraqi customers actually phrase
things. Real log utterances are the single highest-leverage routing fix.

## Where to get them (docs/27: Laila logs are the source)

- **Laila production chat logs** — the customer's first message in a session (before any bot reply)
  is usually the cleanest intent expression. docs/09 §8 has "confirm access to real Laila logs" as
  an open item — if access is blocked, that's the first thing to unblock.
- Second best: **call-center transcripts / complaint tickets** for intents Laila rarely sees.
- Last resort: ask 3–4 colleagues to phrase each intent naturally in their dialect — better than
  nothing, mark `source` = `colleague`.

## ▶ There is now a script for the boring half (added 2026-09-10)

You do not have to hand-transcribe the export. Point stage 1 at whatever the log system gives
you — CSV, JSONL, a JSON array, or a `{"value": [...]}` envelope — and it works out the shape,
the columns, and who spoke:

```bash
npm run logs:extract -- <export-file> --inspect     # show what it detected, write nothing
npm run logs:extract -- <export-file>               # → content-kit/utterances-<date>.csv
```

It keeps the **first customer turn per conversation** (see below for why), drops bot turns,
dedupes (noting `seen 12x` so you can see what is common), **redacts phone numbers and
emails**, and fills in `language`/`script` using the service's own detector. If it guesses a
column wrong: `--text-col`, `--session-col`, `--role-col`, `--customer-role`. `--all-turns`
keeps every customer message, not just the first.

**`intent_id` is left blank on purpose.** That is the one step a script must not do — see the
`intent_id` row in the table below.

Once you have labelled it, stage 2 does the 80/20 split and writes the seed files:

```bash
npm run utterances:import -- content-kit/utterances-<date>.csv --dry-run   # report only
npm run utterances:import -- content-kit/utterances-<date>.csv             # apply
```

It refuses to run if a language is unknown, a `target_flow` is not in `data/vocab/flows.json`,
or one intent is labelled with two different flows. It warns when an intent has fewer than 10
rows, when an intent ends up with no held-out rows (nothing would measure it), and when you
are about to create a new intent that looks like a duplicate of an existing one.

## Format — fill `utterances-template.csv`

One row per utterance. UTF-8, comma-separated, quote any field containing a comma.
(CSV chosen because log exports and Excel both speak it; docs/20 §2 lists CSV as a supported bulk
format. Conversion to the `data/seed/intents/*.json` shape is a trivial script once rows exist.)

| Column | What goes in it |
|---|---|
| `utterance` | The customer's text **verbatim** — keep typos, dialect, mixed script, emoji. Do NOT translate or clean. Redact only PII (phone numbers → `<msisdn>`, names → `<name>`). |
| `language` | `en`, `ar` (Iraqi Arabic), `ckb` (Sorani), `kmr` (Badini/Kurmanji). Best guess is fine; mixed → dominant language. |
| `script` | `arab` or `latin` — matters because romanized Kurdish ("shlon aghayer package") is a required slice (docs/09 §3). |
| `intent_id` | The TRUE intent, judged by you from the conversation — **not** what the old dispatcher routed it to (that dispatcher misroutes; copying its labels would teach the new router the old bugs). Use ids from docs/14 §1 (`loan`, `knowledge_query`, `purchase_bundle`, `unsubscribe_bundle`, `balance_inquiry`, `recharge`, `roaming`, `complaint_no_internet`, `shop_locator`, `eligibility_check`, `greeting_chitchat`, `human_handoff`, `out_of_domain`, …). New intent that fits nothing? Add a row anyway with a proposed id and note it in `vocab-confirm.md` §Flows. |
| `target_flow` | The real Druid flow this intent should dispatch to (pending the flow-list confirm in `vocab-confirm.md`; leave blank if unsure — intent_id is the important label). |
| `source` | `laila_logs`, `call_center`, `colleague`, or `EXAMPLE`. |
| `notes` | Anything useful: "was misrouted to BTL", "sarcastic", "follow-up turn", date/session id if allowed. |

The 4 rows already in the file are **EXAMPLE rows lifted from the current placeholder seed** so you
can see the shape — delete them before submitting.

## How many

- **Target: 30–50 per intent**, spread over the four languages, minimum ~10 per intent to be usable.
- Priority order: the historic misroutes first — **`loan`** (the "loan → BTL" bug), then
  `purchase_bundle` vs `knowledge_query` vs `btl` confusions, then `complaint_no_internet`,
  then the rest of docs/14 §1.
- Include the awkward ones: misspellings, one-word messages ("قرض"), mixed Arabic/Kurdish, romanized
  Kurdish. Those are exactly what the router fails on today.
- Also grab 10–20 genuinely **out-of-domain** messages (competitor questions, random chat) — they
  become abstain/deflection test cases (docs/14 §3).

## What happens with the file

1. `npm run utterances:import` splits the rows ~80/20: 80% → `examples` in
   `data/seed/intents/intent_*.json` (router training examples), 20% held out →
   `eval/gold/gold.jsonl` (so we never test the router on its own examples).
   The split is **hash-based, not random**: adding another 200 utterances later leaves every
   existing row on the side it was already on, so eval numbers stay comparable between runs.
   By default real utterances **replace** the invented placeholder examples — that is the
   point of the exercise. Pass `--merge` to add to them instead.
2. `npm run ingest` → `npm run eval` → `npm run eval -- --sweep` → set `ROUTE_TAU_HIGH` /
   `ROUTE_MARGIN` in `.env`. This is the step expected to push routing accuracy past the 0.85
   prototype gate.

## Time estimate

~2–3 hours of log mining for the first pass (loan + top 5 intents), assuming log access exists.
Labeling is the slow part — batch by intent, not by session.
