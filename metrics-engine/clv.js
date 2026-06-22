// metrics-engine/clv.js — Sprint 6 §15-16. CLV con definiciones SEPARADAS. Benchmark identificado, sin look-ahead.
'use strict';

const EPS = 1e-9;
function num(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }
function logit(p) { const c = Math.min(1 - EPS, Math.max(EPS, p)); return Math.log(c / (1 - c)); }

// clvProbabilityPoints(closingProb, entryImpliedProb) → closing − entry  (positivo = el cierre dio más prob al outcome)
function clvProbabilityPoints(closingProb, entryImpliedProb) {
  const c = num(closingProb), e = num(entryImpliedProb);
  return (c === null || e === null) ? null : +(c - e).toFixed(6);
}
// clvLogOdds(closingProb, entryImpliedProb) → logit(closing) − logit(entry)
function clvLogOdds(closingProb, entryImpliedProb) {
  const c = num(closingProb), e = num(entryImpliedProb);
  return (c === null || e === null) ? null : +(logit(c) - logit(e)).toFixed(6);
}
// forecastVsClose(modelProb, closingProb) → model − closing  (NO es CLV de apuesta; predicción sin recomendación de entrada)
function forecastVsClose(modelProb, closingProb) {
  const m = num(modelProb), c = num(closingProb);
  return (m === null || c === null) ? null : +(m - c).toFixed(6);
}

// selectBenchmark(closing) → { value, type, status }  prioriza executable > midpoint > provider_reported.
//   closing: { benchmark_type, executable_price, midpoint, provider_reported, capture_status, observed_at, event_start_at }
//   Sin look-ahead: observed_at debe ser ≤ event_start_at; si no, status='look_ahead_rejected'.
function selectBenchmark(closing) {
  if (!closing || closing.capture_status === 'unavailable') return { value: null, type: null, status: 'unavailable' };
  if (closing.observed_at && closing.event_start_at && new Date(closing.observed_at).getTime() > new Date(closing.event_start_at).getTime()) {
    return { value: null, type: null, status: 'look_ahead_rejected' };
  }
  if (num(closing.executable_price) !== null) return { value: num(closing.executable_price), type: 'last_valid_pre_event_executable', status: 'available' };
  if (num(closing.midpoint) !== null) return { value: num(closing.midpoint), type: 'last_valid_pre_event_midpoint', status: 'available' };
  if (num(closing.provider_reported) !== null) return { value: num(closing.provider_reported), type: 'provider_reported_close', status: 'available' };
  return { value: null, type: null, status: 'unavailable' };
}

// compute({ entryImpliedProb, modelProb, closing }) → bloque CLV completo (con availability). NO mezcla benchmarks.
function compute({ entryImpliedProb = null, modelProb = null, closing = null } = {}) {
  const b = selectBenchmark(closing);
  const out = {
    benchmark_used: b.type, benchmark_status: b.status,
    closing_probability: b.value, entry_implied_probability: num(entryImpliedProb),
    clv_probability_points: null, clv_log_odds: null, forecast_vs_close: null,
    no_vig_status: 'unavailable', // Sprint 7 construye el consenso no-vig
  };
  if (b.status !== 'available') return out;
  if (out.entry_implied_probability !== null) {
    out.clv_probability_points = clvProbabilityPoints(b.value, out.entry_implied_probability);
    out.clv_log_odds = clvLogOdds(b.value, out.entry_implied_probability);
  }
  if (modelProb !== null) out.forecast_vs_close = forecastVsClose(modelProb, b.value);
  return out;
}

module.exports = { clvProbabilityPoints, clvLogOdds, forecastVsClose, selectBenchmark, compute, logit };
