// metrics-engine/facts.js — Sprint 6 §8. Construye el "metric fact" por señal (derivado, reconstruible).
// NO sustituye al registro inmutable: es una proyección. La señal original permanece intacta.
'use strict';
const crypto = require('crypto');
const brier = require('./brier');
const logLoss = require('./logLoss');
const clv = require('./clv');
const eligibility = require('./eligibility');
const cohorting = require('./cohorting');
const returns = require('./returns');

const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
function argmax(probs) { let best = null, bv = -Infinity; for (const k of Object.keys(probs || {})) { const p = num(probs[k]); if (p !== null && p > bv) { bv = p; best = k; } } return best; }

// buildFact(signal, settlement, closing, ctx) → fact (con metrics, calibration_points, eligibility, cohort).
function buildFact(signal, settlement = null, closing = null, ctx = {}) {
  const pl = signal.signal_payload || {};
  const elig = eligibility.metricEligibility(signal, settlement, closing, { verifiedEpoch: ctx.verifiedEpoch });
  const winner = settlement && settlement.winning_outcome_id != null ? String(settlement.winning_outcome_id) : null;

  const metrics = {};
  let calibrationPoints = [];
  let topProb = null;

  if (signal.signal_type === 'model_prediction_v1' && pl.probabilities) {
    const probs = pl.probabilities;
    const is1x2 = ('home' in probs && 'draw' in probs && 'away' in probs);
    const validSum = brier.validProbs(probs);
    metrics.probs_valid = validSum;
    const pred = argmax(probs);
    topProb = pred != null ? num(probs[pred]) : null;

    if (winner != null && validSum) {
      metrics.brier = is1x2 ? brier.brierMulticlass(probs, winner) : brier.brierBinary(num(probs[Object.keys(probs)[0]]), Object.keys(probs)[0] === winner ? 1 : 0);
      metrics.log_loss = is1x2 ? logLoss.logLossMulticlass(probs, winner) : logLoss.logLossBinary(num(probs[Object.keys(probs)[0]]), Object.keys(probs)[0] === winner ? 1 : 0);
      metrics.accuracy_correct = pred === winner ? 1 : 0;
      // puntos de calibración one-vs-all (cada clase aporta un punto)
      calibrationPoints = Object.keys(probs).map(k => ({ p: num(probs[k]), y: k === winner ? 1 : 0 })).filter(x => x.p !== null);
    }
  }

  // CLV (señales con precio / o forecast-vs-close si hay closing y prob del modelo)
  let entryImplied = pl.entry_implied_probability != null ? num(pl.entry_implied_probability) : (pl.entry_price != null ? num(pl.entry_price) : null);
  let modelProb = topProb;
  if (closing) {
    metrics.clv = clv.compute({ entryImpliedProb: entryImplied, modelProb, closing });
  }

  metrics.returns = returns.forSignal(signal, settlement);

  const dims = cohorting.dimensions(signal, { topProb });
  const fact = {
    signal_id: signal.id,
    signal_public_id: signal.public_id,
    metric_version: 'metrics-1',
    signal_type: signal.signal_type,
    model_version: signal.model_version || null,
    methodology_version: signal.methodology_version || null,
    sport: dims.sport, competition: dims.competition, market_family: dims.market_family,
    prediction_horizon: dims.prediction_horizon, probability_bucket: dims.probability_bucket, data_quality: dims.data_quality,
    published_at: signal.published_at, event_start_at: signal.event_start_at,
    settled_at: settlement ? settlement.settled_at : null,
    settlement_outcome: winner,
    benchmark_status: closing ? (closing.capture_status || 'unknown') : 'unavailable',
    metrics,
    calibration_points: calibrationPoints,
    eligibility_status: elig.official ? 'eligible' : 'excluded',
    clv_eligibility_status: elig.clv.eligible ? 'eligible' : 'excluded',
    experimental: elig.experimental,
    exclusion_reasons: elig.exclusion_reasons,
    clv_exclusion_reasons: elig.clv.reasons,
    cohort_dimensions: dims,
  };
  fact.input_hash = inputHash(signal, settlement, closing);
  return fact;
}

function inputHash(signal, settlement, closing) {
  const material = {
    s: { id: signal.id, payload: signal.signal_payload, published_at: signal.published_at, verification_status: signal.verification_status, score_eligible: signal.score_eligible },
    st: settlement ? { v: settlement.settlement_version, status: settlement.settlement_status, w: settlement.winning_outcome_id } : null,
    c: closing ? { type: closing.benchmark_type, exec: closing.executable_price, mid: closing.midpoint, status: closing.capture_status } : null,
  };
  return 'mf:' + crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 32);
}

module.exports = { buildFact, inputHash, argmax };
