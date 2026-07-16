// Semantic router (docs/06 §5, D7): vector-first with confidence threshold + margin;
// abstain-and-clarify when weak or ambiguous — never guess. The LLM tie-breaker for
// ambiguous cases is Phase 1+; Phase 0 returns "clarify" so the caller asks.
// Scores are dense cosine (mode:'dense') so τ thresholds are calibratable (eval:sweep).

import { CONFIG } from '../lib/config.js';
import { retrieve } from './retrieve.js';

const CANDIDATES = 8;

/**
 * @returns {Promise<{flow:string|null, confidence:number|null, alternatives:{flow:string,score:number}[],
 *   action:'route'|'clarify'|'fallback', reason:string, matches:object[]}>}
 */
export async function routeMessage(text, { thresholds = CONFIG.route } = {}) {
  const matches = await retrieve(text, { types: ['intent'], topK: CANDIDATES, mode: 'dense' });
  return decide(matches, thresholds);
}

// Pure decision function — the eval harness reuses it to sweep thresholds without re-querying.
export function decide(matches, { tauHigh, tauLow, margin }) {
  if (!matches.length) {
    return { flow: null, confidence: null, alternatives: [], action: 'fallback', reason: 'no intent matches', matches };
  }

  const top = matches[0];
  const topFlow = top.payload.target_flow;

  // Best-scoring match per DIFFERENT flow (several examples of the same intent are agreement, not ambiguity)
  const alternatives = [];
  for (const m of matches.slice(1)) {
    const flow = m.payload.target_flow;
    if (flow !== topFlow && !alternatives.some((a) => a.flow === flow)) {
      alternatives.push({ flow, score: round(m.score) });
    }
  }
  const rival = alternatives[0];
  const gap = top.score - (rival?.score ?? 0);

  let action;
  let reason;
  if (top.score < tauLow) {
    action = 'fallback';
    reason = `top ${top.chunk_id} (${round(top.score)}) below τ_low ${tauLow} — no good match`;
  } else if (top.score >= tauHigh && gap >= margin) {
    action = 'route';
    reason = `matched ${top.chunk_id} (${round(top.score)}), margin ${round(gap)}${rival ? ` vs ${rival.flow}` : ''}`;
  } else {
    action = 'clarify';
    reason = top.score < tauHigh
      ? `top ${top.chunk_id} (${round(top.score)}) below τ_high ${tauHigh} — ask to confirm`
      : `ambiguous: ${topFlow} (${round(top.score)}) vs ${rival.flow} (${rival.score}) within margin ${margin}`;
  }

  return {
    flow: action === 'route' ? topFlow : null,
    confidence: round(top.score),
    suggested_flow: topFlow, // what we'd pick if forced — useful for shadow-mode diffing (docs/08 §6)
    alternatives: alternatives.slice(0, 3),
    action,
    reason,
    matches,
  };
}

const round = (x) => Math.round(x * 1000) / 1000;
