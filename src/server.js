// The stateless HTTP service Druid calls (doc 08). Three endpoints over the one
// engine. /v1/answer is 501 by design — alpha runs LLM-OFF (doc 08 §5b).
import { createServer } from "node:http";
import { config } from "./config.js";
import { createEmbedder } from "./embedder.js";
import { createQdrant } from "./qdrant.js";
import { createEngine } from "./retrieve.js";

const MAX_BODY = 32 * 1024; // input size cap (doc 17 §2.1)

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on("data", (d) => {
      size += d.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("payload too large"), { status: 413 })); req.destroy(); return; }
      parts.push(d);
    });
    req.on("end", () => {
      try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("invalid JSON body"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

export function startServer({ port = config.port } = {}) {
  const embedder = createEmbedder();
  const qdrant = createQdrant();
  const engine = createEngine({ embedder, qdrant });

  const server = createServer(async (req, res) => {
    const started = Date.now();
    try {
      if (config.serviceToken && req.url.startsWith("/v1/")) {
        if (req.headers.authorization !== `Bearer ${config.serviceToken}`) {
          return send(res, 401, { error: "unauthorized" });
        }
      }

      if (req.method === "GET" && req.url === "/health") {
        let qdrantVersion = null;
        try { qdrantVersion = await qdrant.ping(); } catch { /* reported as null */ }
        return send(res, qdrantVersion ? 200 : 503, {
          status: qdrantVersion ? "ok" : "degraded",
          qdrant: qdrantVersion,
          embedder: embedder.name,
          collection: qdrant.collection,
        });
      }

      if (req.method === "POST" && req.url === "/v1/retrieve") {
        const body = await readBody(req);
        if (typeof body.text !== "string" || body.text.trim() === "") return send(res, 400, { error: "text (string) is required" });
        const out = await engine.retrieve(body.text, {
          topK: Number.isInteger(body.top_k) ? body.top_k : 5,
          filters: { location: body.filters?.location, serviceClass: body.filters?.service_class },
          ...(Array.isArray(body.types) ? { types: body.types } : {}),
        });
        log("retrieve", body.text, out.chunks[0]?.score, started);
        return send(res, 200, out);
      }

      if (req.method === "POST" && req.url === "/v1/route") {
        const body = await readBody(req);
        if (typeof body.text !== "string" || body.text.trim() === "") return send(res, 400, { error: "text (string) is required" });
        const out = await engine.route(body.text);
        log("route", body.text, `${out.action}:${out.flow ?? "-"}@${out.confidence}`, started);
        return send(res, 200, out);
      }

      if (req.method === "POST" && req.url === "/v1/answer") {
        return send(res, 501, {
          error: "answer is disabled in alpha: the service has no LLM credential (doc 08 §5b). Use /v1/retrieve and compose in the flow.",
        });
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      // Graceful failure (doc 08 §5): a clear status so Druid can fall back.
      return send(res, err.status ?? 502, { error: String(err.message ?? err) });
    }
  });

  // Routing/retrieval audit line (doc 06 §5 auditability). Truncated, PII-free by scope.
  function log(endpoint, text, result, started) {
    console.log(JSON.stringify({ at: new Date().toISOString(), endpoint, text: String(text).slice(0, 120), result, ms: Date.now() - started }));
  }

  server.listen(port, () => console.log(`retrieval-svc listening on :${port} (embedder=${embedder.name}, qdrant=${config.qdrantUrl}, collection=${qdrant.collection})`));
  return server;
}
