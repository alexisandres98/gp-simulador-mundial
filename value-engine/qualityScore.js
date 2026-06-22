// value-engine/qualityScore.js — Sprint 7 §29. Score de calidad explicable 0–100. NO sustituye al edge.
'use strict';
const cfg = require('./config');

// compute(ctx) → { quality_score, factors[], version }
function compute(ctx = {}) {
  const t = cfg.params.thresholds;
  const f = [];
  const add = (factor, pts, max, evidence, warn) => f.push({ factor, score_contribution: +pts.toFixed(2), max, evidence, warning: warn || null });

  add('consensus_source_count', cap(ratio(ctx.sourceCount, t.minSportsbookSources) * 18, 18), 18, `${ctx.sourceCount} fuentes`, (ctx.sourceCount || 0) < t.minSportsbookSources ? 'few_sources' : null);
  add('source_independence', cap(ratio(ctx.independenceCount, t.minIndependenceGroups) * 18, 18), 18, `${ctx.independenceCount} grupos`, (ctx.independenceCount || 0) < t.minIndependenceGroups ? 'few_groups' : null);
  add('freshness', ctx.freshnessOk === false ? 0 : 10, 10, ctx.freshnessOk === false ? 'stale' : 'fresh', ctx.freshnessOk === false ? 'stale' : null);
  add('market_completeness', ctx.marketComplete ? 10 : 0, 10, ctx.marketComplete ? '1X2 completo' : 'incompleto', !ctx.marketComplete ? 'incomplete' : null);
  add('model_calibration', { calibrated: 8, identity: 5, insufficient_data: 2 }[ctx.calibrationStatus] ?? 4, 8, `calibración ${ctx.calibrationStatus || 'n/a'}`, ctx.calibrationStatus === 'insufficient_data' ? 'calibration_insufficient' : null);
  add('model_sample', { established: 8, developing: 6, early: 3, insufficient: 1 }[ctx.sampleStatus] ?? 3, 8, `muestra ${ctx.sampleStatus || 'n/a'}`, null);
  add('prediction_market_liquidity', ctx.lowLiquidity ? 2 : 8, 8, ctx.lowLiquidity ? 'baja' : 'ok', ctx.lowLiquidity ? 'low_liquidity' : null);
  add('rules_quality', ctx.rulesOk ? 6 : 0, 6, ctx.rulesOk ? 'reglas ok' : 'reglas dudosas', !ctx.rulesOk ? 'rules' : null);
  add('mapping_confidence', ctx.mappingMatched ? 6 : 0, 6, ctx.mappingMatched ? 'matched' : 'no matched', !ctx.mappingMatched ? 'mapping' : null);
  add('context_completeness', ctx.lineupMissing ? 2 : 6, 6, ctx.lineupMissing ? 'sin alineación' : 'contexto ok', ctx.lineupMissing ? 'lineup' : null);
  add('price_stability', ctx.priceStable === false ? 0 : 6, 6, ctx.priceStable === false ? 'inestable' : 'estable', ctx.priceStable === false ? 'price_unstable' : null);
  add('method_agreement', ctx.methodDisagreement > 0.02 ? 0 : 6, 6, `Δ ${ctx.methodDisagreement != null ? ctx.methodDisagreement.toFixed(3) : 'n/a'}`, ctx.methodDisagreement > 0.02 ? 'method_disagreement' : null);

  const quality_score = Math.min(100, Math.round(f.reduce((a, x) => a + x.score_contribution, 0)));
  return { quality_score, factors: f, version: cfg.VERSIONS.quality };
}

function ratio(v, base) { return base > 0 ? Math.min(1, (v || 0) / base) : 0; }
function cap(v, max) { return Math.min(max, Math.max(0, v)); }

module.exports = { compute };
