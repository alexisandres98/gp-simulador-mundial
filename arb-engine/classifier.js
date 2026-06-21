// arb-engine/classifier.js — clasificación conservadora (Sprint 3). PRIORIDAD: rechazar lo que solo
// parece arbitraje. pure_arb / execution_sensitive / conditional / price_discrepancy / rejected.

'use strict';
const D = require('./decimal');

// motivos de rechazo "duro" (no es el mismo mercado / no ejecutable de forma segura)
const REJECTING = new Set(['mapping_not_matched', 'outcome_not_matched', 'hard_conflicts', 'fee_unknown',
  'currency_incompatible', 'market_not_open', 'payout_unknown', 'invalid_book', 'snapshot_stale',
  'snapshot_unknown', 'equivalence_below_threshold', 'rules_fingerprint_missing', 'no_executable_price']);

function isRejecting(reason) { return [...REJECTING].some(r => reason.startsWith(r)); }

// classify(ctx) → { classification, reasons[], warnings[] }
// ctx: { evaluation, legEligibility:[{reasons}], timeSkew:{ok,skewMs}, snapshotAge:[{ok,reason}],
//        mappingStatus, hasDerivedAsk, volatility:{label}, minNetRoi }
function classify(ctx) {
  const reasons = [], warnings = [];
  const ev = ctx.evaluation;

  // 1) conditional del Canonical Graph → nunca Pure Arb
  if (ctx.mappingStatus === 'conditional') return { classification: 'conditional', reasons: ['mapping_conditional'], warnings };

  // 2) motivos de rechazo de cualquier pata o de sincronización
  const allReasons = [].concat(...(ctx.legEligibility || []).map(e => e.reasons || []));
  if (ctx.timeSkew && !ctx.timeSkew.ok) allReasons.push('leg_time_skew');
  (ctx.snapshotAge || []).forEach(a => { if (!a.ok) allReasons.push(a.reason || 'snapshot_age'); });
  const rejecting = allReasons.filter(isRejecting);
  const skewReject = allReasons.includes('leg_time_skew') || allReasons.includes('snapshot_too_old') || allReasons.includes('future_snapshot');

  const grossPos = ev && D.cmp(D.fromStr(ev.grossProfit), D.ZERO) > 0;
  const netPos = ev && D.cmp(D.fromStr(ev.netProfit), D.ZERO) > 0;
  const roiOk = ev && D.cmp(D.fromStr(ev.netRoi), D.fromStr(String(ctx.minNetRoi || '0'))) >= 0;
  const fullyFillable = ev && ev.fullyFillable;
  const feesKnown = ev && ev.feeStatus === 'known';

  // 2) cualquier motivo de elegibilidad/sincronización → RECHAZADO (no se degrada a discrepancy).
  //    price_discrepancy se reserva para oportunidades ELEGIBLES cuyo neto no cierra (fees/profundidad).
  if (rejecting.length || skewReject) {
    reasons.push(...new Set(rejecting.length ? rejecting : ['leg_time_skew']));
    return { classification: 'rejected', reasons, warnings };
  }

  // 3) elegible: ¿hay gap y arbitraje neto ejecutable?
  if (!grossPos) return { classification: 'rejected', reasons: ['no_price_gap'], warnings };
  if (!feesKnown) return { classification: 'rejected', reasons: ['fee_unknown'], warnings };
  if (!fullyFillable || !netPos || !roiOk) {
    // hay gap bruto pero fees/profundidad/buffer lo eliminan → price_discrepancy (elegible, no ejecutable)
    if (!fullyFillable) reasons.push('insufficient_depth');
    if (!netPos) reasons.push('fees_or_buffer_eliminate_arb');
    if (!roiOk) reasons.push('net_roi_below_threshold');
    return { classification: 'price_discrepancy', reasons, warnings };
  }

  // 4) Pure Arb candidato — degradar a execution_sensitive si hay riesgo de ejecución
  if (ctx.hasDerivedAsk) warnings.push('derived_ask');
  // capital ejecutable muy pequeño (oportunidad fina/frágil) → execution_sensitive
  if (ctx.minExecutableCapital != null && D.cmp(D.fromStr(ev.capitalRequired), D.fromStr(String(ctx.minExecutableCapital))) < 0) warnings.push('thin_executable_size');
  if (ctx.volatility && ctx.volatility.label === 'high') warnings.push('high_volatility');
  if (ctx.timeSkew && ctx.timeSkew.skewMs != null && ctx.timeSkew.skewMs > (ctx.maxSkewMs || 3000) * 0.7) warnings.push('near_time_skew_limit');
  // margen muy pequeño (< 1.5× del mínimo)
  if (D.cmp(D.fromStr(ev.netRoi), D.mul(D.fromStr(String(ctx.minNetRoi || '0')), D.fromStr('1.5'))) < 0) warnings.push('thin_margin');

  if (warnings.length) return { classification: 'execution_sensitive', reasons: ['valid_but_execution_risk'], warnings };
  return { classification: 'pure_arb', reasons: ['eligible_full_fill_net_positive'], warnings };
}

module.exports = { classify, REJECTING };
