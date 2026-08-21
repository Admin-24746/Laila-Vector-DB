// Entry point: build the app (src/service/app.js — the docs/08 contract) and listen.
// Kept separate so the contract tests can inject requests without opening a port.

import { CONFIG } from '../lib/config.js';
import { llmConfigured } from '../lib/llm.js';
import { buildApp } from './app.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PRODUCTION = process.env.NODE_ENV === 'production';

// Auth fails OPEN: CONFIG.serviceToken is null whenever .env is absent or SERVICE_TOKEN is
// unset, and a null token disables the /v1/* hook entirely. The Dockerfile copies src/ and
// data/ but not .env, and a container is unreachable until someone sets HOST=0.0.0.0 — which
// is exactly the moment an unauthenticated service becomes network-reachable. Refuse that
// combination outright, and never start silently either way (audit 2026-08-21).
if (!CONFIG.serviceToken) {
  const exposed = HOST !== '127.0.0.1' && HOST !== 'localhost';
  if (PRODUCTION || exposed) {
    console.error(
      `FATAL: SERVICE_TOKEN is not set and the service would bind ${HOST}`
      + `${PRODUCTION ? ' with NODE_ENV=production' : ''} — every /v1/* endpoint would be`
      + ' unauthenticated. Set SERVICE_TOKEN (see .env.example) or bind 127.0.0.1.',
    );
    process.exit(1);
  }
  console.warn('WARNING: SERVICE_TOKEN is not set — /v1/* is UNAUTHENTICATED (loopback only).');
}

const app = buildApp();

app.listen({ port: CONFIG.port, host: HOST }).then(() => {
  console.log(
    `retrieval-svc + sandbox console on http://${HOST}:${CONFIG.port} `
    + `(auth ${CONFIG.serviceToken ? 'on' : 'OFF'}, `
    + `draft content ${CONFIG.excludeDraft ? 'hidden' : 'VISIBLE'}, `
    + `Qdrant ${CONFIG.qdrantUrl}, TEI ${CONFIG.teiUrl}, `
    + `LLM ${llmConfigured() ? CONFIG.llm.model : 'off'})`,
  );
});
