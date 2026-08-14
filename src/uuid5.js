// UUIDv5 point IDs (doc 05 §4): Qdrant point IDs must be unsigned ints or UUIDs,
// so the human-readable chunk key {entity_id}::{section}::{language} is hashed to
// a UUIDv5 under a fixed project namespace. Deterministic: same key → same UUID →
// upsert overwrites in place. The key itself rides in payload as chunk_key.
import { createHash } from "node:crypto";

// Project namespace. NEVER change this value — every stored point ID depends on it.
export const PROJECT_NAMESPACE = "8f14b7c2-6b6a-4d5e-9a3c-2f1e0d4b7a91";

function uuidToBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export function uuid5(name, namespace = PROJECT_NAMESPACE) {
  const hash = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
