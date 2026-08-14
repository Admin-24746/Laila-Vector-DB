import { test } from "node:test";
import assert from "node:assert/strict";
import { toSparseVector, termHash } from "../src/sparse.js";
import { uuid5, PROJECT_NAMESPACE } from "../src/uuid5.js";

test("sparse vectors are deterministic and dedupe repeated terms", () => {
  const a = toSparseVector("combo combo bundle");
  const b = toSparseVector("combo combo bundle");
  assert.deepEqual(a, b);
  assert.equal(a.indices.length, 2); // combo, bundle
  assert.ok(a.values.includes(2));   // combo tf=2
});

test("normalized variants produce identical sparse vectors", () => {
  assert.deepEqual(toSparseVector("باقة كومبو ٥٠٠٠"), toSparseVector("باقه کومبو 5000"));
});

test("termHash is a stable uint32", () => {
  assert.equal(termHash("combo"), termHash("combo"));
  assert.ok(Number.isInteger(termHash("كومبو")));
  assert.ok(termHash("كومبو") >= 0 && termHash("كومبو") <= 0xffffffff);
});

test("uuid5 is deterministic, well-formed, version 5", () => {
  const key = "bundle_1601::fees_edgecases::en";
  const a = uuid5(key);
  assert.equal(a, uuid5(key));
  assert.notEqual(a, uuid5("bundle_1601::fees_edgecases::ar"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(PROJECT_NAMESPACE, /^[0-9a-f-]{36}$/);
});
