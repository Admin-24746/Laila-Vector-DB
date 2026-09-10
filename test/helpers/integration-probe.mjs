// Query probe for test/integration.qdrant.test.js.
//
// It runs as a CHILD PROCESS because the whole pipeline reads CONFIG at module-import time
// (collection name, URLs, timeouts), so pointing it at a throwaway collection means setting
// the environment before import — which an in-process test cannot do after the fact.
// Prints one JSON object on stdout; the parent asserts on it.

import { retrieve } from '../../src/service/retrieve.js';
import { routeMessage } from '../../src/service/route.js';
import { countPoints } from '../../src/lib/qdrant.js';

const ids = (rs) => rs.map((r) => r.entity_id);

const out = {
  points: await countPoints(),

  // Hybrid retrieval: an English "how do I subscribe" question must land on Combo.
  combo: await retrieve('How do I subscribe to the combo bundle?', { topK: 5 })
    .then((rs) => ({ ids: ids(rs), topSection: rs[0]?.section, topScore: rs[0]?.score })),

  // A hard language filter must return only that language.
  arabicOnly: await retrieve('باقة كومبو', { topK: 5, language: 'ar' })
    .then((rs) => ({ langs: [...new Set(rs.map((r) => r.language))], n: rs.length })),

  // docs/02 "empty condition = unrestricted": bundle_1601 is baghdad-only, 1602/1603 are
  // unrestricted, so a Basra query must drop 1601 and keep the others.
  basra: await retrieve('bundle', { types: ['bundle'], topK: 20, filters: { location: 'basra' } })
    .then((rs) => [...new Set(ids(rs))]),
  baghdad: await retrieve('bundle', { types: ['bundle'], topK: 20, filters: { location: 'baghdad' } })
    .then((rs) => [...new Set(ids(rs))]),

  // Routing: a verbatim stored example is the strongest possible signal.
  loan: await routeMessage('سلفوني رصيد').then((d) => ({ action: d.action, flow: d.flow, confidence: d.confidence })),
  nonsense: await routeMessage('qq zz xx yy ww vv').then((d) => ({ action: d.action, flow: d.flow })),

  // The payload fields the per-entity answer guardrail depends on must survive ingestion.
  payloadShape: await retrieve('combo bundle', { topK: 1 })
    .then((rs) => ({ name: rs[0]?.payload?.name ?? null, aliases: rs[0]?.payload?.aliases ?? null })),
};

process.stdout.write(JSON.stringify(out));
