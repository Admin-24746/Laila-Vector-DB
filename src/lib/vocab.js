// Controlled vocabularies (docs/26) — data, not code. Keys starting with "_" are
// authoring comments and are stripped on load.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const VOCAB_DIR = path.join(ROOT_DIR, 'data', 'vocab');

function stripComments(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));
}

/** @returns {{languages:object, service_classes:object, locations:object, entity_types:object, flows:object}} */
export function loadVocab() {
  const vocab = {};
  for (const file of readdirSync(VOCAB_DIR).filter((f) => f.endsWith('.json'))) {
    const name = path.basename(file, '.json');
    vocab[name] = stripComments(JSON.parse(readFileSync(path.join(VOCAB_DIR, file), 'utf8')));
  }
  return vocab;
}

export function requiredLanguages(vocab) {
  return Object.entries(vocab.languages ?? {})
    .filter(([, v]) => v.required)
    .map(([k]) => k);
}
