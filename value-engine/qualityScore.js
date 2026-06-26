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

  const raw = +f.reduce((a, x) => a + x.score_contribution, 0).toFixed(2);
  const max = f.reduce((a, x) => a + x.max, 0);
  const quality_score = Math.min(100, Math.round(raw));  // legacy: SIN CAMBIOS (cap 100)
  // raw/max/normalized son metadata informativa aditiva — NO cambian quality_score legacy ni los gates.
  return { quality_score, factors: f, version: cfg.VERSIONS.quality, raw_points: raw, max_points: max, normalized_percent: +(100 * raw / max).toFixed(2) };
}

// computeDiagnosticV2(ctx) — Checkpoint 2.2 §7. DIAGNÓSTICO (no operativo, sin efecto en gates/clasificación).
// Corrige: (a) prediction_market_liquidity NO da puntos si PM unavailable; (b) method_agreement solo puntúa
// si se MIDIÓ; (c) usa verified_independence_group_count; (d) normaliza sin cap; (e) 100 solo con datos
// completos y medidos. NO altera quality_score legacy.
function computeDiagnosticV2(ctx = {}) {
  const t = cfg.params.thresholds;
  const f = [];
  const add = (factor, pts, max, evidence) => f.push({ factor, score_contribution: +pts.toFixed(2), max, evidence });
  const verifiedGroups = ctx.verifiedIndependenceGroups != null ? ctx.verifiedIndependenceGroups : ctx.independenceCount;
  const pmAvailable = ctx.predictionMarketAvailable === true;
  const methodMeasured = ctx.methodDisagreement != null;

  add('consensus_source_count', cap(ratio(ctx.usableSourceCount != null ? ctx.usableSourceCount : ctx.sourceCount, t.minSportsbookSources) * 18, 18), 18, `${ctx.usableSourceCount ?? ctx.sourceCount} usables`);
  add('verified_source_independence', cap(ratio(verifiedGroups, t.minIndependenceGroups) * 18, 18), 18, `${verifiedGroups} grupos verificados`);
  add('freshness', ctx.freshnessOk === false ? 0 : 10, 10, ctx.freshnessOk === false ? 'stale' : 'fresh');
  add('market_completeness', ctx.marketComplete ? 10 : 0, 10, ctx.marketComplete ? '1X2 completo' : 'incompleto');
  add('model_calibration', { calibrated: 8, identity: 5, insufficient_data: 2 }[ctx.calibrationStatus] ?? 4, 8, `calibración ${ctx.calibrationStatus || 'n/a'}`);
  add('model_sample', { established: 8, developing: 6, early: 3, insufficient: 1 }[ctx.sampleStatus] ?? 3, 8, `muestra ${ctx.sampleStatus || 'n/a'}`);
  add('prediction_market_liquidity', !pmAvailable ? 0 : (ctx.lowLiquidity ? 2 : 8), 8, !pmAvailable ? 'PM unavailable' : (ctx.lowLiquidity ? 'baja' : 'ok'));
  add('rules_quality', ctx.rulesOk ? 6 : 0, 6, ctx.rulesOk ? 'reglas ok' : 'reglas dudosas');
  add('mapping_confidence', ctx.mappingMatched ? 6 : 0, 6, ctx.mappingMatched ? 'matched' : 'no matched');
  add('context_completeness', ctx.lineupMissing ? 2 : 6, 6, ctx.lineupMissing ? 'sin alineación' : 'contexto ok');
  add('price_stability', ctx.priceStable === false ? 0 : 6, 6, ctx.priceStable === false ? 'inestable' : 'estable');
  add('method_agreement', !methodMeasured ? 0 : (ctx.methodDisagreement > 0.02 ? 0 : 6), 6, !methodMeasured ? 'no medido' : `Δ ${ctx.methodDisagreement.toFixed(3)}`);

  const raw = +f.reduce((a, x) => a + x.score_contribution, 0).toFixed(2);
  const max = f.reduce((a, x) => a + x.max, 0);
  return { quality_diagnostic_v2_score: +(100 * raw / max).toFixed(2), quality_diagnostic_v2_raw: raw, quality_diagnostic_v2_max: max, quality_diagnostic_v2_components: f, quality_diagnostic_v2_policy_version: 'quality-diagnostic-v2' };
}

function ratio(v, base) { return base > 0 ? Math.min(1, (v || 0) / base) : 0; }
function cap(v, max) { return Math.min(max, Math.max(0, v)); }

module.exports = { compute, computeDiagnosticV2 };
