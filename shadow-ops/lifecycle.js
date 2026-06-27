// shadow-ops/lifecycle.js — Fase N.1 (N.9/N.10/N.11). Closing + settlement + metrics SHADOW.
// PURO de lógica (la persistencia va por repository). Usa el resultado factual SOLO para puntuar (no como feature).
// NO escribe en tablas oficiales. Idempotente por input_hash. Brier/log loss V1 vs V2 vs mercado.
'use strict';
const crypto = require('crypto');
const hash = o => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const O = ['home', 'draw', 'away'];
const brierMulti = (p, out) => O.reduce((s, o) => s + Math.pow((p[o] || 0) - (o === out ? 1 : 0), 2), 0);
const logLoss = (p, out) => -Math.log(Math.max(1e-12, p[out] || 0));
const brierBin = (p, y) => Math.pow(p - y, 2);
const logLossBin = (p, y) => -(y * Math.log(Math.max(1e-12, p)) + (1 - y) * Math.log(Math.max(1e-12, 1 - p)));

// outcome 1X2 reglamentario desde el marcador
function regOutcome(hg, ag) { return hg > ag ? 'home' : hg === ag ? 'draw' : 'away'; }

// settlement de un mercado de goles (reusa la semántica del goal-engine/settlement)
const goalSettle = require('../goal-engine/settlement').settle;

// Construye los facts de settlement + métricas para un evento finalizado, a partir de los snapshots shadow.
// snaps: { v2:{base_probability_vector,final_probability_vector}, goalValue:[{market_id,...}], closing:{...} }
// result: { homeGoals, awayGoals, observedAt }
function settleEvent({ canonicalEventId, v2Snapshot, goalValueRows = [], result, v1Vector }) {
  const out = regOutcome(result.homeGoals, result.awayGoals);
  const facts = [], settlements = [];
  // 1X2: V1, V2 y (si hay closing) MARKET
  if (v1Vector) {
    facts.push({ canonical_event_id: canonicalEventId, model_label: 'V1', subject_type: '1x2', published_probability: v1Vector, result_outcome: out, brier_score: +brierMulti(v1Vector, out).toFixed(6), log_loss: +logLoss(v1Vector, out).toFixed(6), input_hash: hash({ ev: canonicalEventId, m: 'V1', o: out, v: v1Vector }) });
  }
  if (v2Snapshot && v2Snapshot.final_probability_vector) {
    const v2 = v2Snapshot.final_probability_vector;
    facts.push({ canonical_event_id: canonicalEventId, model_label: 'V2', subject_type: '1x2', published_probability: v2, result_outcome: out, brier_score: +brierMulti(v2, out).toFixed(6), log_loss: +logLoss(v2, out).toFixed(6), input_hash: hash({ ev: canonicalEventId, m: 'V2', o: out, v: v2 }) });
  }
  settlements.push({ canonical_event_id: canonicalEventId, subject_type: 'v2_1x2', outcome: out, settlement_status: 'final', result_outcome: out, regulation_home_goals: result.homeGoals, regulation_away_goals: result.awayGoals, result_observed_at: result.observedAt, input_hash: hash({ ev: canonicalEventId, s: 'v2_1x2', o: out, hg: result.homeGoals, ag: result.awayGoals }) });
  // mercados de goles: settle + Brier/logloss del lado GP
  for (const gvr of goalValueRows) {
    const res = goalSettle(gvr.market_id, { homeGoals: result.homeGoals, awayGoals: result.awayGoals });
    if (res === 'unknown' || res === 'void') continue;
    const won = res === 'won' ? 1 : 0;
    const p = Number(gvr.gp_probability);
    facts.push({ canonical_event_id: canonicalEventId, model_label: 'GOAL', subject_type: gvr.market_family, market_id: gvr.market_id, published_probability: { p }, result_outcome: res, brier_score: +brierBin(p, won).toFixed(6), log_loss: +logLossBin(p, won).toFixed(6), input_hash: hash({ ev: canonicalEventId, m: 'GOAL', mk: gvr.market_id, p }) });
    settlements.push({ canonical_event_id: canonicalEventId, subject_type: 'goal_total', market_id: gvr.market_id, outcome: gvr.market_id.includes('OVER') ? 'over' : 'under', settlement_status: 'final', result_outcome: res, regulation_home_goals: result.homeGoals, regulation_away_goals: result.awayGoals, result_observed_at: result.observedAt, input_hash: hash({ ev: canonicalEventId, s: 'goal', mk: gvr.market_id, hg: result.homeGoals, ag: result.awayGoals }) });
  }
  return { outcome: out, facts, settlements };
}

// agregado de métricas shadow por modelo (sobre los facts persistidos)
function aggregate(facts) {
  const by = {};
  for (const f of facts) {
    const k = f.model_label + ':' + f.subject_type;
    by[k] = by[k] || { n: 0, brier: 0, log_loss: 0 };
    by[k].n++; by[k].brier += Number(f.brier_score) || 0; by[k].log_loss += Number(f.log_loss) || 0;
  }
  const out = {};
  for (const [k, v] of Object.entries(by)) out[k] = { sample: v.n, brier: +(v.brier / v.n).toFixed(4), log_loss: +(v.log_loss / v.n).toFixed(4) };
  return out;
}

module.exports = { regOutcome, settleEvent, aggregate, hash };
