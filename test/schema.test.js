import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVocab, validateEntity, validateBatch } from "../src/schema.js";
import { readEntitiesDir } from "../src/pipeline.js";
import { fileURLToPath } from "node:url";

const vocab = loadVocab();
const contentDir = fileURLToPath(new URL("../content/entities", import.meta.url));

test("all shipped sample entities pass validation", () => {
  const entities = readEntitiesDir(contentDir);
  assert.ok(entities.length >= 8, `expected sample entities, got ${entities.length}`);
  for (const r of validateBatch(entities, vocab)) {
    assert.deepEqual(r.errors, [], `${r.entity_id}: ${r.errors.join("; ")}`);
  }
});

test("bundle without price/validity/bundleId is rejected", () => {
  const combo = JSON.parse(readFileSync(new URL("../content/entities/bundle_1601_combo.json", import.meta.url), "utf8"));
  const broken = { ...combo, facts: { data_mb: 300 } };
  const r = validateEntity(broken, vocab);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("price_iqd")));
  assert.ok(r.errors.some((e) => e.includes("validity_days")));
  assert.ok(r.errors.some((e) => e.includes("bundleId")));
});

test("vocab violations and date inversion are rejected", () => {
  const combo = JSON.parse(readFileSync(new URL("../content/entities/bundle_1601_combo.json", import.meta.url), "utf8"));
  const bad = {
    ...combo,
    conditions: { ...combo.conditions, eligible_locations: ["atlantis"], valid_from: "2026-09-01", valid_to: "2026-08-01" },
  };
  const r = validateEntity(bad, vocab);
  assert.ok(r.errors.some((e) => e.includes("atlantis")));
  assert.ok(r.errors.some((e) => e.includes("valid_from")));
});

test("intent without target_flow or examples is rejected", () => {
  const r = validateEntity({
    entity_id: "intent_x", type: "intent", status: "draft", source: "manual",
    version: 1, updated_at: "2026-07-13T00:00:00Z", names: { en: "X" },
  }, vocab);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("target_flow")));
  assert.ok(r.errors.some((e) => e.includes("examples")));
});

test("duplicate entity_id in a batch is rejected; unknown refs warn", () => {
  const base = {
    type: "terminology", status: "draft", source: "manual", version: 1,
    updated_at: "2026-07-13T00:00:00Z", names: { en: "T" }, definition: { en: "d" },
  };
  const rs = validateBatch([{ ...base, entity_id: "terminology_a" }, { ...base, entity_id: "terminology_a" }], vocab);
  assert.ok(rs.every((r) => !r.ok));

  const r = validateEntity({ ...base, entity_id: "terminology_b", conflicts_with: ["bundle_ghost"] }, vocab, new Set(["terminology_b"]));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("bundle_ghost")));
});

test("missing languages warn but do not reject (doc 07 §4)", () => {
  const r = validateEntity({
    entity_id: "terminology_en_only", type: "terminology", status: "draft", source: "manual",
    version: 1, updated_at: "2026-07-13T00:00:00Z", names: { en: "English only" }, definition: { en: "d" },
  }, vocab);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes("missing language")));
});
