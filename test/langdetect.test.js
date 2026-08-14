import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "../src/langdetect.js";

test("arabic without kurdish letters → ar", () => {
  const d = detectLanguage("شلون اشحن رصيد بالكارت");
  assert.equal(d.language, "ar");
  assert.equal(d.script, "arabic");
});

test("sorani with kurdish-specific letters → ckb", () => {
  const d = detectLanguage("پاکێجی کۆمبۆ چییە");
  assert.equal(d.language, "ckb");
  assert.equal(d.confidence, "high");
});

test("english → en", () => {
  const d = detectLanguage("how do I cancel the combo bundle");
  assert.equal(d.language, "en");
  assert.equal(d.script, "latin");
});

test("kurmanji latin markers → kmr", () => {
  assert.equal(detectLanguage("ez deynê dixwazim").language, "kmr");
  assert.equal(detectLanguage("pakêja combo çi ye").language, "kmr");
});

test("short/ambiguous input → low confidence, never crashes", () => {
  assert.equal(detectLanguage("ok").confidence, "low");
  assert.equal(detectLanguage("").language, null);
  assert.equal(detectLanguage("123 !!").language, null);
});

test("detector reads RAW text (kurdish ە signal not yet collapsed)", () => {
  const d = detectLanguage("باڵانسم چەندە");
  assert.equal(d.language, "ckb");
});
