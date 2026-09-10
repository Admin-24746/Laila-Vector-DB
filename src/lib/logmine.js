// Turning a raw Laila log export into labelled router training data
// (content-kit/utterances-instructions.md, docs/09 §3).
//
// The pure logic lives here rather than in scripts/ so it can be unit-tested: a script that
// runs a CLI at import time cannot be imported by a test. scripts/logs-to-utterances.mjs and
// scripts/utterances-to-seed.mjs are thin CLIs over these functions.

import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseCsv } from './csv.js';

// ── format sniffing ──────────────────────────────────────────────────────────
// The export format is not known in advance — a portal CSV, JSONL, a JSON array, or the
// {"value": [...]} envelope Power Automate produces — so detect rather than demand.

/**
 * @param {string} text raw file contents
 * @param {string} [filename] used only for the extension hint
 * @returns {{records: object[], format: string}}
 */
export function loadRecords(text, filename = '') {
  const trimmed = String(text).replace(/^﻿/, '').trimStart();
  const ext = path.extname(filename).toLowerCase();

  if (trimmed.startsWith('[')) return { records: JSON.parse(trimmed), format: 'json-array' };

  if (trimmed.startsWith('{')) {
    // Either JSONL (many objects, one per line) or a single wrapping object.
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((l) => l.startsWith('{'))) {
      return { records: lines.map((l) => JSON.parse(l)), format: 'jsonl' };
    }
    const obj = JSON.parse(trimmed);
    const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (arrayKey) return { records: obj[arrayKey], format: `json-wrapped(${arrayKey})` };
    return { records: [obj], format: 'json-object' };
  }

  if (ext === '.csv' || ext === '.tsv' || trimmed.includes(',')) {
    const rows = parseCsv(text);
    if (!rows.length) return { records: [], format: 'csv-empty' };
    const [header, ...body] = rows;
    return {
      records: body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? '']))),
      format: 'csv',
    };
  }

  throw new Error(`cannot determine the format of ${filename || 'input'} — pass a .csv, .json or .jsonl export`);
}

// ── column detection ─────────────────────────────────────────────────────────
// Ranked candidates; exports in the wild use all of these. Every pick is overridable from
// the CLI, because a wrong guess here silently produces the wrong corpus.
export const TEXT_KEYS = ['utterance', 'text', 'message', 'messagetext', 'content', 'body', 'userinput',
  'user_message', 'usermessage', 'query', 'question', 'input', 'customer_message', 'msg'];
export const SESSION_KEYS = ['conversationid', 'conversation_id', 'sessionid', 'session_id', 'chatid',
  'chat_id', 'threadid', 'thread_id', 'correlationid', 'dialogid', 'caseid'];
export const ROLE_KEYS = ['role', 'sender', 'author', 'from', 'direction', 'speaker', 'actor',
  'participant', 'issentbybot', 'isbot', 'type'];
export const TIME_KEYS = ['timestamp', 'loggedat', 'createdat', 'created_at', 'time', 'datetime', 'date', 'sentat'];

const norm = (k) => String(k).toLowerCase().replace(/[\s_-]/g, '');

/** First candidate present among the records' keys; exact match wins over substring. */
export function pickColumn(records, candidates, explicit = null) {
  if (explicit) return explicit;
  const keys = [...new Set(records.flatMap((r) => Object.keys(r ?? {})))];
  for (const want of candidates) {
    const hit = keys.find((k) => norm(k) === norm(want));
    if (hit) return hit;
  }
  for (const want of candidates) {
    const hit = keys.find((k) => norm(k).includes(norm(want)));
    if (hit) return hit;
  }
  return null;
}

const BOT_ROLE = /^(bot|assistant|agent|system|laila|outbound|out|true|1)$/i;
const HUMAN_ROLE = /^(user|customer|human|client|inbound|in|caller|false|0)$/i;

/**
 * Is this row a human customer turn? Covers role vocabularies (`user`/`bot`), direction
 * (`inbound`/`outbound`) and boolean flags (`isSentByBot: true`).
 * Unknown vocabulary is KEPT, not dropped: a false negative silently shrinks the corpus,
 * whereas a bot line that slips through is obvious to the human labeller.
 */
export function isCustomerTurn(value, customerRole = null) {
  if (value == null || value === '') return true; // no role column → treat everything as customer text
  const v = String(value).trim();
  if (customerRole) return v.toLowerCase() === String(customerRole).toLowerCase();
  if (HUMAN_ROLE.test(v)) return true;
  if (BOT_ROLE.test(v)) return false;
  return true;
}

// ── PII redaction (required by content-kit/utterances-instructions.md) ───────
// Iraqi mobiles are 07XXXXXXXXX; also catch +964 forms, any long digit run, and emails.
// Deliberately over-eager: over-redacting a shortcode is recoverable, leaking a subscriber
// number into a file that gets shared around is not. Shortcodes (*123#, 1602) are 3–4
// digits and untouched.
const MSISDN = /(?:\+?964[\s-]?|\b0)(?:7\d{2})[\s-]?\d{3}[\s-]?\d{4}\b/g;
const LONG_DIGITS = /\b\d{9,}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;

export function redact(text) {
  return String(text)
    .replace(EMAIL, '<email>')
    .replace(MSISDN, '<msisdn>')
    .replace(LONG_DIGITS, '<msisdn>');
}

// ── train / gold split ───────────────────────────────────────────────────────
/**
 * Should this utterance be HELD OUT into eval/gold/gold.jsonl instead of becoming a router
 * example? If a gold item is also a training example the eval measures memorisation and the
 * 0.85 routing gate stops meaning anything.
 *
 * Hash-based, not random, so the answer never changes between runs: add 200 new utterances
 * and every existing one stays on the side it was already on, keeping eval numbers
 * comparable run to run.
 */
export function isHeldOut(utterance, intentId, holdout = 0.2) {
  const digest = createHash('sha256').update(`${intentId}::${utterance}`).digest();
  return (digest.readUInt32BE(0) / 0xffffffff) < holdout;
}
