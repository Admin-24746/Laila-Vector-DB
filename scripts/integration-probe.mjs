// Query probe for test/integration.qdrant.test.js.
//
// It lives in scripts/ rather than test/ ON PURPOSE: `node --test` collects EVERY .mjs/.js
// under a test/ directory, so while it sat in test/helpers/ the runner executed it as a
// test file — firing real queries at the LIVE collection and printing raw JSON into the
// runner's output stream. Do not move it back.
//
// It runs as a CHILD PROCESS because the whole pipeline reads CONFIG at module-import time
// (collection name, URLs, timeouts), so pointing it at a throwaway collection means setting
// the environment before import — which an in-process test cannot do after the fact.
// Prints one JSON object on stdout; the parent asserts on it.

import { retrieve } from '../src/service/retrieve.js';
import { routeMessage } from '../src/service/route.js';
import { countPoints } from '../src/lib/qdrant.js';

const ids = (rs) => rs.map((r) => r.entity_id);

const out = {
  points: await countPoints(),

  // Hybrid retrieval: an English "how do I subscribe" question must land on the subscribe
  // chunk of the right entity. Retargeted 2026-09-12 from the Combo placeholder (retired,
  // its shortcodes were invented) to RED 15, whose steps come from the FEBRA source.
  subscribeQuery: await retrieve('How do I subscribe to RED 15?', { topK: 5 })
    .then((rs) => ({ ids: ids(rs), topSection: rs[0]?.section, topScore: rs[0]?.score })),

  // A hard language filter must return only that language.
  arabicOnly: await retrieve('باقة تيك توك', { topK: 5, language: 'ar' })
    .then((rs) => ({ langs: [...new Set(rs.map((r) => r.language))], n: rs.length })),

  // docs/02 "empty condition = unrestricted": every live entity has an empty
  // eligible_locations, so both governorates must see the same unrestricted set.
  // ⚠ The RESTRICTED half of this rule is no longer covered. bundle_1601 was the only
  // location-restricted entity and it was invented (baghdad-only was made up along with its
  // prices). None of the 62 real FEBRA rows states a location, so nothing real exercises
  // exclusion — and inventing a restriction to keep a test green is the practice this
  // migration exists to remove. content-kit/seed-20-worksheet.md row 16 already requires a
  // real location-restricted bundle; that is where this coverage comes back.
  basra: await retrieve('bundle', { types: ['bundle'], topK: 20, filters: { location: 'basra' } })
    .then((rs) => [...new Set(ids(rs))]),
  baghdad: await retrieve('bundle', { types: ['bundle'], topK: 20, filters: { location: 'baghdad' } })
    .then((rs) => [...new Set(ids(rs))]),

  // Routing: a verbatim stored example is the strongest possible signal.
  loan: await routeMessage('سلفوني رصيد').then((d) => ({ action: d.action, flow: d.flow, confidence: d.confidence })),
  nonsense: await routeMessage('qq zz xx yy ww vv').then((d) => ({ action: d.action, flow: d.flow })),

  // The payload fields the per-entity answer guardrail depends on must survive ingestion.
  payloadShape: await retrieve('weekly tiktok bundle', { topK: 1 })
    .then((rs) => ({ name: rs[0]?.payload?.name ?? null, aliases: rs[0]?.payload?.aliases ?? null })),
};

process.stdout.write(JSON.stringify(out));
