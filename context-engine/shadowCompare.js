// context-engine/shadowCompare.js — Fase M.7. Comparación SHADOW V1 vs V2 (sin promover nada).
// PURO. Clasifica cada outcome bajo V1 y bajo V2 con la misma lógica de edge (conservadora − break-even) y
// los thresholds versionados del Value Engine (env), y resume qué STRONG aparecerían/desaparecerían con V2.
// NOTA: la conservadora aquí es una APROXIMACIÓN para la comparación shadow (buffer fijo); el Value Engine
// oficial usa ensemble+uncertainty. Sirve para el diff direccional V1 vs V2, no para crear Candidates.
'use strict';
const num = (v, d) => (v == null || isNaN(Number(v))) ? d : Number(v);

function thresholds() {
  return {
    strongEdge: num(process.env.VALUE_STRONG_MIN_ADJUSTED_EDGE_PP, 0.035),
    leanEdge: num(process.env.VALUE_LEAN_MIN_ADJUSTED_EDGE_PP, 0.02),
    watchEdge: num(process.env.VALUE_WATCH_MIN_ADJUSTED_EDGE_PP, 0.01),
    conservativeBuffer: num(process.env.SHADOW_CONSERVATIVE_BUFFER_PP, 0.02),
    minSources: num(process.env.VALUE_MIN_SPORTSBOOK_SOURCES, 3),
  };
}

function classifyOutcome({ prob, odds, sourceCount = 3 }, th = thresholds()) {
  const breakEven = 1 / num(odds, Infinity);
  const conservative = Math.max(0, num(prob, 0) - th.conservativeBuffer);
  const edge = conservative - breakEven;
  const ev = conservative * num(odds, 0) - 1;
  let cls = 'pass';
  if (edge >= th.strongEdge && sourceCount >= th.minSources) cls = 'strong';
  else if (edge >= th.leanEdge && sourceCount >= 2) cls = 'lean';
  else if (edge >= th.watchEdge) cls = 'watch';
  return { classification: cls, adjusted_edge: +edge.toFixed(4), adjusted_ev: +ev.toFixed(4), break_even: +breakEven.toFixed(4), conservative: +conservative.toFixed(4) };
}

// rows: [{ label, outcome, v1Prob, v2Prob, odds, consensus, sourceCount }]
function compareV1vsV2(rows, th = thresholds()) {
  const items = rows.map(r => {
    const v1 = classifyOutcome({ prob: r.v1Prob, odds: r.odds, sourceCount: r.sourceCount }, th);
    const v2 = classifyOutcome({ prob: r.v2Prob, odds: r.odds, sourceCount: r.sourceCount }, th);
    return { label: r.label, outcome: r.outcome, odds: r.odds, consensus: r.consensus, v1Prob: r.v1Prob, v2Prob: r.v2Prob, v1, v2, shift_pp: +(((r.v2Prob - r.v1Prob)) * 100).toFixed(2) };
  });
  const strongV1 = items.filter(i => i.v1.classification === 'strong');
  const strongV2 = items.filter(i => i.v2.classification === 'strong');
  const key = i => `${i.label}|${i.outcome}`;
  const setV2 = new Set(strongV2.map(key));
  const setV1 = new Set(strongV1.map(key));
  return {
    items,
    summary: {
      strong_v1: strongV1.length, strong_v2: strongV2.length,
      created_by_v2: strongV2.filter(i => !setV1.has(key(i))).map(i => i.label + ' ' + i.outcome),
      removed_by_v2: strongV1.filter(i => !setV2.has(key(i))).map(i => i.label + ' ' + i.outcome),
    },
  };
}

module.exports = { thresholds, classifyOutcome, compareV1vsV2 };
