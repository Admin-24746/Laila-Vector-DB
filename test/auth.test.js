// Auth gate regression suite (docs/10 service auth) — added after the 2026-08-21 audit found
// a complete /v1/* bypass.
//
// These tests run over a REAL SOCKET on purpose. `app.inject()` builds the request target
// itself and normalizes it, so it can never reproduce an absolute-form request line — the
// bypass was invisible to inject-based contract tests and has to be driven at the wire level.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { buildApp } from '../src/service/app.js';

const TOKEN = 'test-token-do-not-reuse';

function stubbedApp(seen) {
  return buildApp({
    serviceToken: TOKEN,
    understandQuery: async (t) => ({ raw: t, rewritten: null, language: 'en' }),
    mergedRetrieve: async () => { seen.push('retrieve'); return []; },
    routeMessage: async () => { seen.push('route'); return { matches: [], flow: null, suggested_flow: null, action: 'fallback', reason: 'stub', confidence: null }; },
    composeAnswer: async () => { seen.push('answer'); return { answer: 'x', grounded: true, citations: [], guardrail: {} }; },
    detectInjection: () => false,
    llmConfigured: () => true,
    qdrantHealthy: async () => true,
    embedderHealthy: async () => true,
    countPoints: async () => 1,
    audit: async () => {},
  });
}

// Write a raw HTTP/1.1 request line verbatim — no URL parsing between us and the server.
function rawRequest(port, requestTarget, headers = '') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text: 'hi' });
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `POST ${requestTarget} HTTP/1.1\r\n`
        + 'Host: 127.0.0.1\r\n'
        + 'Content-Type: application/json\r\n'
        + `Content-Length: ${Buffer.byteLength(body)}\r\n`
        + headers
        + 'Connection: close\r\n\r\n'
        + body,
      );
    });
    let out = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('data', (d) => { out += d; });
    socket.on('end', () => resolve(Number(out.split(' ')[1])));
    socket.on('error', reject);
  });
}

test('auth gate holds against every request-target form (docs/10)', async (t) => {
  const seen = [];
  const app = stubbedApp(seen);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();

  const unauthenticated = [
    ['origin-form', '/v1/retrieve'],
    ['origin-form with query', '/v1/retrieve?debug=1'],
    // RFC 9112 §3.2.2: servers MUST accept this. req.url becomes the whole URI, so a
    // startsWith('/v1/') check on req.url skips auth while the router still dispatches.
    ['absolute-form, own host', 'http://127.0.0.1/v1/retrieve'],
    ['absolute-form, foreign host', 'http://evil.example/v1/retrieve'],
    ['absolute-form, https scheme', 'https://evil.example/v1/retrieve'],
    ['absolute-form with query', 'http://evil.example/v1/retrieve?x=1'],
  ];

  for (const [label, target] of unauthenticated) {
    await t.test(`401 without a token — ${label}`, async () => {
      seen.length = 0;
      assert.equal(await rawRequest(port, target), 401, `${target} must be rejected`);
      assert.deepEqual(seen, [], 'the route handler must not run');
    });
  }

  await t.test('absolute-form with a WRONG token is still rejected', async () => {
    seen.length = 0;
    const status = await rawRequest(port, 'http://evil.example/v1/retrieve', 'Authorization: Bearer wrong\r\n');
    assert.equal(status, 401);
    assert.deepEqual(seen, []);
  });

  await t.test('absolute-form with the CORRECT token is served', async () => {
    seen.length = 0;
    const status = await rawRequest(port, 'http://127.0.0.1/v1/retrieve', `Authorization: Bearer ${TOKEN}\r\n`);
    assert.equal(status, 200);
    assert.deepEqual(seen, ['retrieve'], 'a valid caller must still reach the handler');
  });

  await t.test('every /v1 endpoint is gated, not just retrieve', async () => {
    for (const ep of ['/v1/route', '/v1/answer']) {
      seen.length = 0;
      assert.equal(await rawRequest(port, `http://evil.example${ep}`), 401, `${ep} must be gated`);
      assert.deepEqual(seen, [], `${ep} handler must not run`);
    }
  });

  await app.close();
});

test('auth is off entirely when no token is configured (local dev)', async () => {
  const seen = [];
  const app = buildApp({
    serviceToken: null,
    understandQuery: async (t) => ({ raw: t, rewritten: null, language: 'en' }),
    mergedRetrieve: async () => { seen.push('retrieve'); return []; },
    audit: async () => {},
  });
  const res = await app.inject({ method: 'POST', url: '/v1/retrieve', payload: { text: 'hi' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, ['retrieve']);
  await app.close();
});
