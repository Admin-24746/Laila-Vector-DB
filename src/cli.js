// Alpha CLI (doc 20 §7): init · ingest · query · route · eval · serve
import { config } from "./config.js";
import { createEmbedder } from "./embedder.js";
import { createQdrant } from "./qdrant.js";
import { createEngine } from "./retrieve.js";
import { ingest } from "./pipeline.js";
import { runEval, formatReport } from "../eval/harness.js";

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(args[i]);
  }
  return { flags, positional };
}

const [, , command, ...rest] = process.argv;
const { flags, positional } = parseFlags(rest);

const embedder = createEmbedder();
const qdrant = createQdrant();
const engine = createEngine({ embedder, qdrant });

const commands = {
  async init() {
    const { created } = await qdrant.ensureCollection();
    console.log(`collection "${qdrant.collection}" ${created ? "created" : "already exists"} (qdrant ${await qdrant.ping()})`);
  },

  async ingest() {
    const dir = positional[0] ?? "content/entities";
    await qdrant.ensureCollection();
    await ingest({ dir, embedder, qdrant, requireVerified: Boolean(flags["require-verified"]) });
    console.log(`points in collection: ${await qdrant.countPoints()}`);
  },

  async query() {
    const text = positional.join(" ");
    if (!text) throw new Error('usage: cli query "<text>" [--types bundle,service] [--topk 5] [--location baghdad] [--class red]');
    const out = await engine.retrieve(text, {
      topK: Number(flags.topk ?? 5),
      ...(flags.types ? { types: String(flags.types).split(",") } : {}),
      filters: { location: flags.location, serviceClass: flags.class },
    });
    console.log(`language: ${out.language.language ?? "?"} (${out.language.confidence})`);
    for (const c of out.chunks) console.log(`  ${c.score.toFixed(3)}  ${c.chunk_key}\n         ${c.text.slice(0, 140)}`);
    if (Object.keys(out.grounded_facts).length > 0) console.log(`grounded_facts: ${JSON.stringify(out.grounded_facts)}`);
  },

  async route() {
    const text = positional.join(" ");
    if (!text) throw new Error('usage: cli route "<text>"');
    const out = await engine.route(text);
    console.log(JSON.stringify(out, null, 2));
  },

  async eval() {
    const goldPath = positional[0] ?? "eval/gold.sample.jsonl";
    const report = await runEval({ goldPath, engine });
    console.log(formatReport(report));
    if (config.embedder === "mock") {
      console.log("\nNOTE: EMBEDDER=mock — plumbing check only; quality numbers are NOT meaningful (doc 29 §2).");
    }
  },

  async serve() {
    const { startServer } = await import("./server.js");
    startServer();
  },
};

if (!commands[command]) {
  console.log(`laila-knowledge-base CLI (doc 20 alpha)

  node src/cli.js init                     create the Qdrant collection
  node src/cli.js ingest [dir]             validate + chunk + embed + upsert  [--require-verified]
  node src/cli.js query "<text>" [...]     hybrid retrieval  [--types a,b --topk N --location X --class Y]
  node src/cli.js route "<text>"           routing decision (route/clarify/fallback)
  node src/cli.js eval [gold.jsonl]        Hit@k / MRR / routing accuracy / langdetect
  node src/cli.js serve                    start the HTTP service (:${config.port})

  env: QDRANT_URL TEI_URL EMBEDDER=tei|mock COLLECTION PORT TAU_HIGH TAU_LOW MARGIN`);
  process.exit(command ? 1 : 0);
}

commands[command]().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
