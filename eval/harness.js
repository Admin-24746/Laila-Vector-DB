// Offline eval harness (doc 09 §4): exact-match metrics, no LLM needed.
// Gold item: { query, language, expected_chunk? | expected_entity?, expected_flow? }
// Metrics A (retrieval: Hit@3/5, MRR, per-language), B (routing: accuracy,
// confusion, false-route, abstain), + language-detection accuracy (doc 12/09 patch).
import { readFileSync } from "node:fs";
import { detectLanguage } from "../src/langdetect.js";

export function loadGold(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("//"))
    .map((line, i) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`gold line ${i + 1} is not valid JSON`); }
    });
}

function hitRank(chunks, item) {
  return chunks.findIndex((c) =>
    (item.expected_chunk && c.chunk_key === item.expected_chunk) ||
    (item.expected_entity && c.entity_id === item.expected_entity),
  );
}

export async function runEval({ goldPath, engine, bars = { hit5: 0.85, routing: 0.85, falseRoute: 0.05 } }) {
  const gold = loadGold(goldPath);
  const perLang = {};
  const retrieval = { n: 0, hit3: 0, hit5: 0, mrrSum: 0 };
  const routing = { n: 0, correct: 0, falseRoute: 0, abstain: 0, confusion: {} };
  const langdet = { n: 0, correct: 0 };
  const misses = [];

  for (const item of gold) {
    if (item.language) {
      langdet.n++;
      if (detectLanguage(item.query).language === item.language) langdet.correct++;
    }

    if (item.expected_chunk || item.expected_entity) {
      const out = await engine.retrieve(item.query, { topK: 5 });
      const rank = hitRank(out.chunks, item);
      retrieval.n++;
      const lang = (perLang[item.language ?? "?"] ??= { n: 0, hit5: 0 });
      lang.n++;
      if (rank >= 0) {
        if (rank < 3) retrieval.hit3++;
        if (rank < 5) { retrieval.hit5++; lang.hit5++; }
        retrieval.mrrSum += 1 / (rank + 1);
      } else {
        misses.push({ kind: "retrieval", query: item.query, expected: item.expected_chunk ?? item.expected_entity, got: out.chunks[0]?.chunk_key ?? "(nothing)" });
      }
    }

    if (item.expected_flow) {
      const out = await engine.route(item.query);
      routing.n++;
      const actual = out.action === "route" ? out.flow : `(${out.action})`;
      (routing.confusion[item.expected_flow] ??= {})[actual] = (routing.confusion[item.expected_flow]?.[actual] ?? 0) + 1;
      if (out.action === "route" && out.flow === item.expected_flow) routing.correct++;
      else if (out.action === "route") { routing.falseRoute++; misses.push({ kind: "false-route", query: item.query, expected: item.expected_flow, got: out.flow }); }
      else routing.abstain++;
    }
  }

  return {
    counts: { gold: gold.length },
    retrieval: retrieval.n === 0 ? null : {
      n: retrieval.n,
      hit3: retrieval.hit3 / retrieval.n,
      hit5: retrieval.hit5 / retrieval.n,
      mrr: retrieval.mrrSum / retrieval.n,
      perLanguage: Object.fromEntries(Object.entries(perLang).map(([l, v]) => [l, { n: v.n, hit5: v.hit5 / v.n }])),
    },
    routing: routing.n === 0 ? null : {
      n: routing.n,
      accuracy: routing.correct / routing.n,
      falseRouteRate: routing.falseRoute / routing.n,
      abstainRate: routing.abstain / routing.n,
      confusion: routing.confusion,
    },
    langdetect: langdet.n === 0 ? null : { n: langdet.n, accuracy: langdet.correct / langdet.n },
    misses,
    bars,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function formatReport(r) {
  const lines = [`eval: ${r.counts.gold} gold item(s)`];
  if (r.retrieval) {
    const gate = r.retrieval.hit5 >= r.bars.hit5 ? "PASS" : "FAIL";
    lines.push(`A. retrieval (n=${r.retrieval.n}): Hit@3 ${pct(r.retrieval.hit3)} · Hit@5 ${pct(r.retrieval.hit5)} [bar ${pct(r.bars.hit5)} → ${gate}] · MRR ${r.retrieval.mrr.toFixed(3)}`);
    for (const [lang, v] of Object.entries(r.retrieval.perLanguage)) lines.push(`     ${lang}: Hit@5 ${pct(v.hit5)} (n=${v.n})`);
  }
  if (r.routing) {
    const gate = r.routing.accuracy >= r.bars.routing && r.routing.falseRouteRate <= r.bars.falseRoute ? "PASS" : "FAIL";
    lines.push(`B. routing (n=${r.routing.n}): accuracy ${pct(r.routing.accuracy)} · false-route ${pct(r.routing.falseRouteRate)} · abstain ${pct(r.routing.abstainRate)} [bars ${pct(r.bars.routing)}/${pct(r.bars.falseRoute)} → ${gate}]`);
    for (const [expected, got] of Object.entries(r.routing.confusion)) {
      lines.push(`     ${expected} → ${Object.entries(got).map(([k, v]) => `${k}×${v}`).join(", ")}`);
    }
  }
  if (r.langdetect) lines.push(`D. language detection: ${pct(r.langdetect.accuracy)} (n=${r.langdetect.n})`);
  if (r.misses.length > 0) {
    lines.push(`misses (${r.misses.length}):`);
    for (const m of r.misses.slice(0, 10)) lines.push(`   [${m.kind}] "${m.query}" expected ${m.expected}, got ${m.got}`);
  }
  return lines.join("\n");
}
