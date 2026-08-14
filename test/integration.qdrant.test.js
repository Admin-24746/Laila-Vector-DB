// End-to-end against a REAL Qdrant (mock embedder): collection setup → ingest →
// hybrid query → filters → routing → idempotent re-ingest. Auto-skips when no
// Qdrant is reachable, so `npm test` stays green on a cold machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createEmbedder } from "../src/embedder.js";
import { createQdrant } from "../src/qdrant.js";
import { createEngine } from "../src/retrieve.js";
import { ingest } from "../src/pipeline.js";

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const COLLECTION = "laila_knowledge_test";

async function qdrantUp() {
  try {
    const res = await fetch(QDRANT_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

const up = await qdrantUp();

test("qdrant end-to-end (mock embedder)", { skip: !up && "Qdrant not reachable — start it and re-run" }, async (t) => {
  const embedder = createEmbedder({ kind: "mock" });
  const qdrant = createQdrant({ url: QDRANT_URL, collection: COLLECTION });
  const engine = createEngine({ embedder, qdrant });
  const dir = fileURLToPath(new URL("../content/entities", import.meta.url));

  // fresh collection
  await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { method: "DELETE" });
  await qdrant.ensureCollection();

  await t.test("ingest populates chunks", async () => {
    const s = await ingest({ dir, embedder, qdrant, log: () => {} });
    assert.equal(s.rejected, 0);
    assert.ok(s.chunks > 40, `expected >40 chunks, got ${s.chunks}`);
    assert.equal(await qdrant.countPoints(), s.chunks);
  });

  await t.test("re-ingest is a no-op (hash skip, doc 07 §6)", async () => {
    const s = await ingest({ dir, embedder, qdrant, log: () => {} });
    assert.equal(s.ingested, 0);
    assert.equal(s.skipped, s.read);
  });

  await t.test("hybrid retrieval finds the fees edge-case chunk", async () => {
    const out = await engine.retrieve("extra fee if I subscribe to Elna w lil Kul 3 times in one month?");
    assert.ok(out.chunks.length > 0);
    const top = out.chunks[0];
    assert.equal(top.entity_id, "bundle_1750");
    assert.equal(out.grounded_facts.bundle_1750.price_iqd, 10000);
  });

  await t.test("arabic query retrieves the arabic chunk (soft language boost)", async () => {
    const out = await engine.retrieve("شلون الغي اشتراك باقة كومبو");
    assert.equal(out.language.language, "ar");
    assert.equal(out.chunks[0].entity_id, "bundle_1601");
    assert.equal(out.chunks[0].language, "ar");
  });

  await t.test("location filter excludes ineligible bundles, keeps unrestricted ones", async () => {
    const basra = await engine.retrieve("bundle", { types: ["bundle"], topK: 10, filters: { location: "basra" } });
    assert.ok(basra.chunks.every((c) => c.entity_id !== "bundle_1601"), "combo is baghdad-only");
    assert.ok(basra.chunks.some((c) => c.entity_id === "bundle_1750"), "elna has no location restriction");
    const baghdad = await engine.retrieve("combo bundle", { types: ["bundle"], topK: 10, filters: { location: "baghdad" } });
    assert.ok(baghdad.chunks.some((c) => c.entity_id === "bundle_1601"));
  });

  await t.test("routing: exact known utterance routes; nonsense abstains", async () => {
    const loan = await engine.route("سلفوني رصيد");
    assert.equal(loan.action, "route");
    assert.equal(loan.flow, "loan_flow");
    const nonsense = await engine.route("qq zz xx yy ww vv");
    assert.notEqual(nonsense.action, "route");
  });

  await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { method: "DELETE" });
});
