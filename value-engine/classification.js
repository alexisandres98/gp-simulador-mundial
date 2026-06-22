// value-engine/classification.js — Sprint 7 §28, §30. PASS / WATCH / LEAN / STRONG + elegibilidad STRONG.
// Un hard conflict NUNCA puede ser superado por un edge alto. Quality alta + edge cero sigue PASS.
'use strict';
const cfg = require('./config');

// classify(ctx) → { classification, reasons[], blockers[] }
//   ctx: { adjustedEdgePp, adjustedEv, sourceCount, independenceGroups, qualityScore, uncertaintyScore,
//          mappingMatched, outcomeMatched, hardConflicts, freshnessOk, priceMeetsMinimum, dataQuality,
//          consensusComplete, modelVersioned, eventStarted, deepLinkVerified, criticalContradiction }
function classify(ctx = {}) {
  const t = cfg.params.thresholds;
  const blockers = [];
  // bloqueos duros: nunca STRONG, y normalmente PASS.
  if ((ctx.hardConflicts || 0) > 0) blockers.push('hard_conflict');
  if (ctx.mappingMatched === false) blockers.push('mapping_not_matched');
  if (ctx.outcomeMatched === false) blockers.push('outcome_not_matched');
  if (ctx.freshnessOk === false) blockers.push('stale');
  if (ctx.eventStarted === true) blockers.push('event_started');
  if (ctx.consensusComplete === false) blockers.push('consensus_unavailable');

  const edge = num(ctx.adjustedEdgePp), ev = num(ctx.adjustedEv);

  // PASS: sin value accionable o datos insuficientes.
  if (blockers.length || edge == null || ev == null || edge <= 0) {
    return { classification: 'pass', reasons: edge != null && edge <= 0 ? ['no_positive_edge'] : ['insufficient_or_blocked'], blockers, version: cfg.VERSIONS.classification };
  }

  // STRONG: cumple TODOS los estándares.
  const strong = strongEligible(ctx);
  if (strong.eligible) return { classification: 'strong', reasons: strong.reasons, blockers: [], strong_reason_codes: strong.reasons, version: cfg.VERSIONS.classification };

  // LEAN: edge positivo + fuentes/calidad suficientes, pero no STRONG.
  if (edge >= t.leanEdge && ev >= t.leanEv && (ctx.sourceCount || 0) >= 2) {
    return { classification: 'lean', reasons: ['positive_edge_below_strong'], blockers: strong.blockers, version: cfg.VERSIONS.classification };
  }
  // WATCH: diferencia interesante que no supera umbral.
  if (edge >= t.watchEdge || ev >= t.watchEv) {
    return { classification: 'watch', reasons: ['interesting_below_threshold'], blockers: strong.blockers, version: cfg.VERSIONS.classification };
  }
  return { classification: 'pass', reasons: ['edge_below_watch'], blockers, version: cfg.VERSIONS.classification };
}

// strongEligible(ctx) → { eligible, reasons[], blockers[] }  (conclusión analítica; aún NO es pick)
function strongEligible(ctx = {}) {
  const t = cfg.params.thresholds;
  const blockers = [];
  const need = [
    [num(ctx.adjustedEdgePp) >= t.strongEdge, 'edge_below_strong'],
    [num(ctx.adjustedEv) >= t.strongEv, 'ev_below_strong'],
    [(ctx.sourceCount || 0) >= t.minSportsbookSources, 'insufficient_sources'],
    [(ctx.independenceGroups || 0) >= t.minIndependenceGroups, 'insufficient_independence'],
    [ctx.consensusComplete !== false, 'consensus_incomplete'],
    [ctx.mappingMatched !== false && ctx.outcomeMatched !== false, 'mapping_not_matched'],
    [(ctx.hardConflicts || 0) === 0, 'hard_conflict'],
    [ctx.freshnessOk !== false, 'stale'],
    [ctx.modelVersioned !== false, 'model_unversioned'],
    [num(ctx.uncertaintyScore) <= t.strongMaxUncertainty, 'uncertainty_too_high'],
    [num(ctx.qualityScore) >= t.strongMinQuality, 'quality_too_low'],
    [num(ctx.dataQuality, 1) >= t.minDataQuality, 'data_quality_too_low'],
    [ctx.priceMeetsMinimum === true, 'price_below_minimum'],
    [ctx.eventStarted !== true, 'event_started'],
    [ctx.criticalContradiction !== true, 'critical_contradiction'],
  ];
  for (const [okc, code] of need) if (!okc) blockers.push(code);
  return { eligible: blockers.length === 0, reasons: blockers.length ? [] : ['all_strong_criteria_met'], blockers };
}

function num(v, d = null) { const x = parseFloat(v); return Number.isFinite(x) ? x : d; }

module.exports = { classify, strongEligible };
