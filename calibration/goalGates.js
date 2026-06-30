// calibration/goalGates.js — Goles G4. Calibración POR FAMILIA de mercado + GATE de publicación.
// PURO (sin DB, sin red). Sobre el replay point-in-time (sin leakage) settlea la predicción de CADA mercado de
// cada familia contra el marcador real y acumula calibración (Brier, log-loss, error de calibración = |pred−obs|).
// Luego un GATE decide por familia: APPROVED (puede generar Picks) / SHADOW (calcula Value pero no publica) /
// INFORMATIONAL (solo se muestra). EXACT_SCORE siempre informativo (§10). Los thresholds son configurables por env.
// G5 (Picks de goles) LEE este gate: solo publica en familias APPROVED. No se calibra contra uno mismo: la prob es
// del modelo deportivo (lambdas pre-partido), el resultado solo PUNTÚA.
'use strict';
const ge = require('../goal-engine/distribution');
const mk = require('../goal-engine/markets');
const st = require('../goal-engine/settlement');

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const round = (x, d = 4) => (x == null || !Number.isFinite(x)) ? null : Number(x.toFixed(d));
const tag = (l) => String(l).replace('.', '_');

// Familias y sus mercados binarios (sin push) evaluables para calibración.
function marketsForRecord(matrix) {
  const out = [];
  for (const L of [1.5, 2.5, 3.5]) out.push(['TOTALS', `TOTAL_GOALS_OVER_${tag(L)}`, ge.overUnder(matrix, L).over]);
  out.push(['BTTS', 'BTTS_YES', ge.btts(matrix).yes]);
  for (const L of [0.5, 1.5]) {
    out.push(['TEAM_TOTALS', `HOME_TEAM_TOTAL_OVER_${tag(L)}`, ge.teamOverUnder(matrix, 'home', L).over]);
    out.push(['TEAM_TOTALS', `AWAY_TEAM_TOTAL_OVER_${tag(L)}`, ge.teamOverUnder(matrix, 'away', L).over]);
  }
  const wm = mk.winningMargin(matrix); const g = (id) => (wm.find((x) => x.market_id === id) || {}).probability;
  for (const id of ['WINNING_MARGIN_EITHER_BY_2_PLUS', 'WINNING_MARGIN_HOME_BY_2_PLUS', 'WINNING_MARGIN_AWAY_BY_2_PLUS', 'WINNING_MARGIN_DRAW']) out.push(['WINNING_MARGIN', id, g(id)]);
  return out;
}

// Acumula calibración por familia sobre los records del replay (cada uno con lambdas + marcador real hg/ag).
function familyCalibration(records) {
  const acc = {};
  for (const r of records) {
    if (!r.lambdas || typeof r.hg !== 'number' || typeof r.ag !== 'number') continue;
    const { matrix } = ge.buildMatrix(r.lambdas.home, r.lambdas.away);
    const score = { homeGoals: r.hg, awayGoals: r.ag };
    for (const [fam, mid, pred] of marketsForRecord(matrix)) {
      if (pred == null) continue;
      const res = st.settle(mid, score);
      if (res === 'push' || res === 'void' || res === 'unknown') continue; // push no puntúa
      const won = (res === 'won' || res === 'half_won') ? 1 : 0;
      const a = acc[fam] = acc[fam] || { n: 0, sqErr: 0, ll: 0, sumPred: 0, sumObs: 0 };
      a.n++; a.sqErr += Math.pow(pred - won, 2);
      a.ll += -(won * Math.log(Math.max(1e-12, pred)) + (1 - won) * Math.log(Math.max(1e-12, 1 - pred)));
      a.sumPred += pred; a.sumObs += won;
    }
  }
  const out = {};
  for (const [fam, a] of Object.entries(acc)) {
    const avgPred = a.sumPred / a.n, observed = a.sumObs / a.n;
    out[fam] = { sample: a.n, brier: round(a.sqErr / a.n), log_loss: round(a.ll / a.n), avg_pred: round(avgPred, 3), observed: round(observed, 3), calibration_error: round(Math.abs(avgPred - observed), 4) };
  }
  return out;
}

// Thresholds del gate (conservadores, configurables por env). Brier de un mercado binario bien calibrado ronda
// 0.18–0.24; pedimos muestra mínima y error de calibración bajo. minSample alto evita aprobar por azar.
function thresholds() {
  return {
    minSample: num(process.env.GOAL_GATE_MIN_SAMPLE, 40),
    maxBrier: num(process.env.GOAL_GATE_MAX_BRIER, 0.25),
    maxCalErr: num(process.env.GOAL_GATE_MAX_CAL_ERR, 0.06),
  };
}

// Aplica el gate por familia → status. EXACT_SCORE siempre informativo.
function applyGates(fam, th = thresholds()) {
  const out = {};
  for (const [f, m] of Object.entries(fam)) {
    let status = 'shadow', reasons = [];
    if (m.sample < th.minSample) reasons.push('insufficient_sample');
    if (m.brier != null && m.brier > th.maxBrier) reasons.push('brier_too_high');
    if (m.calibration_error != null && m.calibration_error > th.maxCalErr) reasons.push('miscalibrated');
    if (!reasons.length) status = 'approved';
    out[f] = { ...m, status, blockers: reasons };
  }
  out.EXACT_SCORE = { status: 'informational', sample: 0, blockers: ['informational_only'] };
  return out;
}

// Reporte completo: replay → calibración por familia → gate. results = mapa { fixtureId: {hg,ag,status} }.
function report({ results, th } = {}) {
  const { pointInTimeReplay } = require('./replay');
  const records = pointInTimeReplay({ results: results || {} });
  const fam = familyCalibration(records);
  const gates = applyGates(fam, th || thresholds());
  const approved = Object.entries(gates).filter(([, g]) => g.status === 'approved').map(([f]) => f);
  return {
    replay_sample: records.length, policy_version: 'goal-gate-1', thresholds: th || thresholds(),
    families: gates, approved_families: approved, generated_at: null,
  };
}

module.exports = { marketsForRecord, familyCalibration, thresholds, applyGates, report };
