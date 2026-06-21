// arb-engine/confidence.js — confianza de ejecución EXPLICABLE (Sprint 3). 0-100 + high/medium/low.
// NO modifica net_profit/net_roi (no se restan dólares por confianza). Separada del beneficio real.

'use strict';
const D = require('./decimal');

// score(ctx) → { score, label, factors:[{factor, contribution, evidence, warning}] }
function score(ctx) {
  let s = 100; const factors = [];
  const ding = (factor, amount, evidence, warning) => { s -= amount; factors.push({ factor, contribution: -amount, evidence, warning: warning || null }); };
  const keep = (factor, evidence) => factors.push({ factor, contribution: 0, evidence });

  // calidad de mapping / revisión
  if (ctx.mappingStatus === 'matched') keep('mapping_quality', 'matched'); else ding('mapping_quality', 30, ctx.mappingStatus, 'mapping_not_matched');
  if (ctx.manualReviewApproved) keep('manual_review', 'approved');
  // reglas completas
  if (ctx.rulesComplete === false) ding('rules_completeness', 15, 'incomplete', 'rules_incomplete');
  // frescura
  if (ctx.freshness === 'fresh') keep('freshness', 'fresh');
  else if (ctx.freshness === 'aging') ding('freshness', 10, 'aging', 'aging_snapshot');
  else ding('freshness', 25, ctx.freshness, 'stale_or_unknown');
  // time skew
  if (ctx.timeSkewMs != null) { const frac = ctx.timeSkewMs / (ctx.maxSkewMs || 3000); if (frac > 0.7) ding('time_skew', 12, ctx.timeSkewMs + 'ms', 'high_time_skew'); else keep('time_skew', ctx.timeSkewMs + 'ms'); }
  // directo vs derivado
  if (ctx.hasDerivedAsk) ding('price_source', 10, 'derived_from_complement_bid', 'derived_ask'); else keep('price_source', 'direct_ask');
  // profundidad / niveles consumidos
  if (ctx.minDepthConsumed != null) { if (ctx.minDepthConsumed <= 1) ding('depth', 12, '1 level', 'shallow_depth'); else keep('depth', ctx.minDepthConsumed + ' levels'); }
  // volatilidad
  if (ctx.volatility === 'high') ding('volatility', 12, 'high', 'high_volatility'); else if (ctx.volatility === 'medium') ding('volatility', 5, 'medium'); else keep('volatility', ctx.volatility || 'low');
  // error/latencia del proveedor
  if (ctx.providerErrorRate != null && ctx.providerErrorRate > 0.05) ding('provider_reliability', 8, (ctx.providerErrorRate * 100).toFixed(1) + '%', 'provider_errors');
  // certeza de fee
  if (ctx.feeStatus === 'known') keep('fee_certainty', 'known'); else ding('fee_certainty', 20, ctx.feeStatus, 'fee_uncertain');

  s = Math.max(0, Math.min(100, Math.round(s)));
  const label = s >= 80 ? 'high' : s >= 55 ? 'medium' : 'low';
  return { score: s, label, factors };
}

module.exports = { score };
