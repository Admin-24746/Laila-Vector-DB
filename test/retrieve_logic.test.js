import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLangBoost, decideRoute, collectGroundedFacts } from "../src/retrieve.js";

const hit = (score, language, extra = {}) => ({ score, payload: { language, ...extra } });

test("same-language boost reorders near ties but never filters", () => {
  const hits = [hit(0.80, "en"), hit(0.78, "ar")];
  const boosted = applyLangBoost(hits, { language: "ar", confidence: "high" }, 0.05);
  assert.equal(boosted[0].payload.language, "ar"); // 0.83 > 0.80
  assert.equal(boosted.length, 2);                  // nothing dropped
});

test("low-confidence detection applies no boost", () => {
  const hits = [hit(0.80, "en"), hit(0.78, "ar")];
  const out = applyLangBoost(hits, { language: "ar", confidence: "low" }, 0.05);
  assert.equal(out[0].payload.language, "en");
});

test("boost cannot overturn a clear winner", () => {
  const hits = [hit(0.90, "en"), hit(0.60, "ar")];
  const out = applyLangBoost(hits, { language: "ar", confidence: "high" }, 0.05);
  assert.equal(out[0].payload.language, "en");
});

const intentHit = (score, flow, key = "intent_x::example_1::en") =>
  hit(score, "en", { target_flow: flow, chunk_key: key });

test("routing: confident top with margin → route", () => {
  const d = decideRoute([intentHit(0.91, "loan_flow"), intentHit(0.62, "btl_flow")], { tauHigh: 0.82, tauLow: 0.65, margin: 0.08 });
  assert.equal(d.action, "route");
  assert.equal(d.flow, "loan_flow");
});

test("routing: below tau_low or empty → fallback (never guess)", () => {
  assert.equal(decideRoute([intentHit(0.40, "loan_flow")], { tauHigh: 0.82, tauLow: 0.65, margin: 0.08 }).action, "fallback");
  assert.equal(decideRoute([], {}).action, "fallback");
});

test("routing: ambiguous close top-2 → clarify (tie-breaker OFF in alpha)", () => {
  const d = decideRoute([intentHit(0.85, "loan_flow"), intentHit(0.83, "btl_flow")], { tauHigh: 0.82, tauLow: 0.65, margin: 0.08 });
  assert.equal(d.action, "clarify");
  assert.equal(d.flow, null);
  assert.ok(d.alternatives.length > 0);
});

test("routing: strong but sub-tau_high → clarify not route", () => {
  const d = decideRoute([intentHit(0.75, "loan_flow"), intentHit(0.50, "btl_flow")], { tauHigh: 0.82, tauLow: 0.65, margin: 0.08 });
  assert.equal(d.action, "clarify");
});

test("grounded facts collected per entity, first hit wins", () => {
  const facts = collectGroundedFacts([
    hit(0.9, "en", { entity_id: "bundle_1601", facts: { price_iqd: 5000 } }),
    hit(0.8, "en", { entity_id: "bundle_1601", facts: { price_iqd: 9999 } }),
    hit(0.7, "en", { entity_id: "bundle_1750", facts: { price_iqd: 10000 } }),
  ]);
  assert.deepEqual(facts, { bundle_1601: { price_iqd: 5000 }, bundle_1750: { price_iqd: 10000 } });
});
