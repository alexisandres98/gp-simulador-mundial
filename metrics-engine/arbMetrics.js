// metrics-engine/arbMetrics.js — Sprint 6 §19. Métricas OPERATIVAS de arbitraje. Solo observado, nunca ROI realizado.
'use strict';

const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
function quantiles(arr, qs) {
  const xs = arr.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return qs.map(() => null);
  return qs.map(q => { const i = Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1)))); return xs[i]; });
}
function median(arr) { return quantiles(arr, [0.5])[0]; }

// compute(data) → bloque de métricas de arbitraje. data:
//   { evaluationsScanned, opportunities:[{classification, net_roi, max_executable_size, lifetime_seconds,
//     expired_before_click, price_changed_before_calc, deep_link_verified}], publishedCount,
//     quotedCount, executableCount, structuralSettledCount }
function compute(data = {}) {
  const opps = data.opportunities || [];
  const lifetimes = opps.map(o => num(o.lifetime_seconds)).filter(v => v !== null);
  const [p25, p50, p75] = quantiles(lifetimes, [0.25, 0.5, 0.75]);
  const pure = opps.filter(o => o.classification === 'pure_arb').length;
  const execSens = opps.filter(o => o.classification === 'execution_sensitive').length;

  return {
    // PERMITIDO (observado)
    evaluations_scanned: data.evaluationsScanned || 0,
    opportunities_detected: opps.length,
    opportunities_published: data.publishedCount || 0,
    pure_arb_count: pure,
    execution_sensitive_count: execSens,
    median_published_net_roi_estimate: median(opps.map(o => num(o.net_roi))),
    median_max_executable_capital_estimate: median(opps.map(o => num(o.max_executable_size))),
    lifetime_seconds: { p25, p50, p75, n: lifetimes.length },
    expired_before_click: opps.filter(o => o.expired_before_click).length,
    price_changed_before_calculation: opps.filter(o => o.price_changed_before_calc).length,
    // quoted→executable: con spread matemático vs que superaron fees+profundidad+reglas
    quoted_to_executable_conversion: (data.quotedCount > 0) ? +((data.executableCount || 0) / data.quotedCount).toFixed(4) : null,
    deep_link_validation_rate: opps.length ? +(opps.filter(o => o.deep_link_verified).length / opps.length).toFixed(4) : null,
    structural_settlement_success: data.structuralSettledCount || 0,
    // PROHIBIDO explícitamente (siempre null): no hay ejecución
    realized_roi: null, realized_profit: null, executed_capital: null,
    note: 'Las métricas reflejan oportunidades observadas, no ejecuciones realizadas por GP.',
  };
}

module.exports = { compute, quantiles, median };
