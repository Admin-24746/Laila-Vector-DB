// End-to-end against a REAL Qdrant + REAL TEI, on the CURRENT pipeline
// (src/ingest/run.js → src/lib/* → src/service/*). Rewritten 2026-09-10: the previous
// version drove the legacy `src/*.js` tree and `content/entities/`, which is why that dead
// tree could not be deleted — this was the project's only integration coverage.
//
// It shells out rather than importing, for two reasons: the pipeline reads CONFIG at
// module-import time (so the throwaway COLLECTION has to be set before import), and driving
// the real `node src/ingest/run.js` CLI is what actually exercises the shipped entry point.
//
// Auto-skips when the stack is down, so `npm test` stays green on a cold machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
const TEI_URL = process.env.TEI_URL ?? 'http://localhost:8080';
const COLLECTION = 'laila_knowledge_test';

const reachable = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
};

const qdrantUp = await reachable(QDRANT_URL);
const teiUp = await reachable(`${TEI_URL}/health`);
const skip = !qdrantUp ? 'Qdrant not reachable — start it and re-run'
  : !teiUp ? 'TEI not reachable — `docker compose up -d tei` and re-run'
    : false;

test('end-to-end: ingest → hybrid retrieval → filters → routing', { skip }, async (t) => {
  // A temp state file: the real .ingest-state.json describes the LIVE collection and must
  // not be rewritten to describe this throwaway one.
  const stateDir = mkdtempSync(path.join(tmpdir(), 'laila-int-'));
  const env = {
    ...process.env,
    COLLECTION,
    INGEST_STATE_FILE: path.join(stateDir, 'state.json'),
  };
  const run = (args, extraEnv = {}) =>
    execFileSync(process.execPath, args, { cwd: ROOT, env: { ...env, ...extraEnv }, encoding: 'utf8' });

  const dropCollection = () =>
    fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { method: 'DELETE' }).catch(() => {});

  await dropCollection();

  try {
    let ingestOut;
    await t.test('the ingest CLI populates a fresh collection', () => {
      ingestOut = run(['src/ingest/run.js', '--rebuild']);
      assert.match(ingestOut, /0 rejected/, `seed data must validate cleanly:\n${ingestOut}`);
      assert.match(ingestOut, /collection now holds \d+ points/);
    });

    // One child process answers every query, so the stack is paid for once.
    const probe = JSON.parse(run(['scripts/integration-probe.mjs']));

    await t.test('every chunk written is queryable', () => {
      const claimed = Number(ingestOut.match(/collection now holds (\d+) points/)[1]);
      assert.equal(probe.points, claimed, 'ingest report and live count must agree');
      assert.ok(probe.points > 100, `expected >100 chunks from the seed set, got ${probe.points}`);
    });

    await t.test('hybrid retrieval finds the right entity and section', () => {
      assert.equal(probe.combo.ids[0], 'bundle_1601', `got ${JSON.stringify(probe.combo)}`);
      assert.equal(probe.combo.topSection, 'subscribe', 'a "how do I subscribe" question wants the subscribe chunk');
      assert.ok(probe.combo.topScore > 0.5, `weak top score: ${probe.combo.topScore}`);
    });

    await t.test('a language filter is hard', () => {
      assert.ok(probe.arabicOnly.n > 0, 'the Arabic slice must not be empty');
      assert.deepEqual(probe.arabicOnly.langs, ['ar']);
    });

    await t.test('location filter: empty condition means unrestricted (docs/02)', () => {
      assert.ok(!probe.basra.includes('bundle_1601'), 'combo is baghdad-only, so Basra must not see it');
      assert.ok(probe.basra.length > 0, 'unrestricted bundles must still surface in Basra');
      assert.ok(probe.baghdad.includes('bundle_1601'), 'and Baghdad must see it');
    });

    await t.test('routing: a stored utterance routes, nonsense abstains', () => {
      assert.equal(probe.loan.action, 'route', `got ${JSON.stringify(probe.loan)}`);
      assert.equal(probe.loan.flow, 'loan_flow');
      assert.notEqual(probe.nonsense.action, 'route', `nonsense must never route: ${JSON.stringify(probe.nonsense)}`);
    });

    await t.test('the payload carries what the answer guardrail needs', () => {
      // Per-entity number binding reads payload.name/aliases; if ingestion stops writing
      // them the guardrail silently degrades to the old flat-bag behaviour.
      assert.equal(typeof probe.payloadShape.name, 'string');
      assert.ok(Array.isArray(probe.payloadShape.aliases));
    });

    await t.test('re-ingest is a no-op (hash skip, docs/07 §6)', () => {
      const out = run(['src/ingest/run.js']);
      assert.match(out, /0 changed/, `second run must skip everything:\n${out}`);
      assert.match(out, /0 chunks to write/);
    });
  } finally {
    await dropCollection();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
