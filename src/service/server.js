// Entry point: build the app (src/service/app.js — the docs/08 contract) and listen.
// Kept separate so the contract tests can inject requests without opening a port.

import { CONFIG } from '../lib/config.js';
import { llmConfigured } from '../lib/llm.js';
import { buildApp } from './app.js';

const app = buildApp();

const HOST = process.env.HOST ?? '127.0.0.1';
app.listen({ port: CONFIG.port, host: HOST }).then(() => {
  console.log(`retrieval-svc + sandbox console on http://${HOST}:${CONFIG.port} (Qdrant ${CONFIG.qdrantUrl}, TEI ${CONFIG.teiUrl}, LLM ${llmConfigured() ? CONFIG.llm.model : 'off'})`);
});
