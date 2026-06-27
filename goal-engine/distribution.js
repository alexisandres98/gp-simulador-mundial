// goal-engine/distribution.js — Anexo M-G (G.1/G.2). Goal Distribution Engine.
// PURO (sin DB, sin red). A partir de las tasas de gol (lambdas) produce la DISTRIBUCIÓN COMPLETA de marcadores
// y deriva todos los mercados de goles de primera capa: totals (O/U 0.5–4.5), BTTS, team totals, scoreline matrix,
// 1X2 derivado, goles esperados e indicadores de incertidumbre. NO reinventa el modelo: replica EXACTAMENTE la
// matemática Poisson + Dixon-Coles del engine oficial (mismas constantes); un test prueba la equivalencia con
// engine.probsFromLambdas. NO se cablea a ningún pipeline (shadow). Marcadores ≠ objetivo: son consecuencia de la
// distribución; las métricas que importan son calibración/log-loss/RPS, no el hit-rate del marcador exacto.
'use strict';

// Constantes ESPEJO de engine.js (NO se tocan las fórmulas oficiales; se replican para mantener consistencia).
const DC_RHO = -0.13;        // Dixon-Coles: correlación de marcadores bajos (infla 0-0,1-1)
const CALIB_LAMBDA = 0.15;   // atenuación del 1X2 hacia uniforme (SOLO para el 1X2 mostrado, no para la distribución)

function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
function dcTau(h, a, lh, la) {
  if (h === 0 && a === 0) return 1 - lh * la * DC_RHO;
  if (h === 0 && a === 1) return 1 + lh * DC_RHO;
  if (h === 1 && a === 0) return 1 + la * DC_RHO;
  if (h === 1 && a === 1) return 1 - DC_RHO;
  return 1;
}
function calib(pH, pD, pA) {
  const L = CALIB_LAMBDA;
  return { home: (1 - L) * pH + L / 3, draw: (1 - L) * pD + L / 3, away: (1 - L) * pA + L / 3 };
}

// Matriz de marcadores P(home=i, away=j) normalizada, con corrección Dixon-Coles. Truncamiento dinámico: amplía
// el rango hasta preservar >= targetMass (default 0.9999) de la masa probabilística. Devuelve { matrix, n, mass }.
function buildMatrix(lh, la, { maxGoals = 15, targetMass = 0.9999 } = {}) {
  // n suficiente para cubrir las colas (selecciones pueden golear); empieza en 10 y crece si falta masa.
  let n = 10;
  let ph, pa, raw, total;
  const compute = (N) => {
    const PH = [], PA = [];
    for (let k = 0; k <= N; k++) { PH.push(poissonPmf(lh, k)); PA.push(poissonPmf(la, k)); }
    const M = []; let T = 0;
    for (let h = 0; h <= N; h++) { M[h] = []; for (let a = 0; a <= N; a++) { const p = PH[h] * PA[a] * dcTau(h, a, lh, la); M[h][a] = p; T += p; } }
    return { M, T };
  };
  while (true) {
    const r = compute(n); ph = r; total = r.T;
    if (total >= targetMass || n >= maxGoals) break;
    n += 2;
  }
  raw = ph.M;
  // normalizar a suma 1
  const matrix = raw.map(row => row.map(p => p / total));
  return { matrix, n, mass: total };
}

// 1X2 derivado de la matriz. raw = sin calibración (distribución pura); calibrated = con la atenuación oficial.
function oneX2FromMatrix(matrix) {
  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    const p = matrix[h][a];
    if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
  }
  const c = calib(pH, pD, pA);
  return { raw: { home: pH, draw: pD, away: pA }, calibrated: { home: c.home, draw: c.draw, away: c.away } };
}

function totalGoalsDist(matrix) {
  const dist = {};
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    const t = h + a; dist[t] = (dist[t] || 0) + matrix[h][a];
  }
  return dist;
}

// P(total > line) y P(total < line). Para líneas .5 no hay push.
function overUnder(matrix, line) {
  const dist = totalGoalsDist(matrix);
  let over = 0, under = 0;
  for (const [t, p] of Object.entries(dist)) { if (Number(t) > line) over += p; else under += p; }
  return { line, over: +over.toFixed(6), under: +under.toFixed(6) };
}

function btts(matrix) {
  let yes = 0;
  for (let h = 1; h < matrix.length; h++) for (let a = 1; a < matrix[h].length; a++) yes += matrix[h][a];
  return { yes: +yes.toFixed(6), no: +(1 - yes).toFixed(6) };
}

// Distribución de goles por equipo (marginal) + O/U por equipo.
function teamGoalsDist(matrix, side /* 'home'|'away' */) {
  const dist = {};
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    const g = side === 'home' ? h : a; dist[g] = (dist[g] || 0) + matrix[h][a];
  }
  return dist;
}
function teamOverUnder(matrix, side, line) {
  const dist = teamGoalsDist(matrix, side);
  let over = 0, under = 0;
  for (const [g, p] of Object.entries(dist)) { if (Number(g) > line) over += p; else under += p; }
  return { side, line, over: +over.toFixed(6), under: +under.toFixed(6) };
}

function topScorelines(matrix, k = 5) {
  const arr = [];
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) arr.push({ score: `${h}-${a}`, h, a, p: matrix[h][a] });
  arr.sort((x, y) => y.p - x.p);
  return arr.slice(0, k).map(s => ({ score: s.score, probability: +s.p.toFixed(6) }));
}

// Indicadores de incertidumbre de la distribución (no del 1X2): entropía normalizada + concentración top-1/top-3.
function dispersion(matrix) {
  const flat = [];
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) flat.push(matrix[h][a]);
  flat.sort((x, y) => y - x);
  const top1 = flat[0] || 0, top3 = (flat[0] || 0) + (flat[1] || 0) + (flat[2] || 0);
  let H = 0; for (const p of flat) if (p > 0) H -= p * Math.log(p);
  const Hmax = Math.log(flat.length || 1);
  return { entropy: +H.toFixed(4), entropy_normalized: Hmax ? +(H / Hmax).toFixed(4) : 0, top1_concentration: +top1.toFixed(4), top3_concentration: +top3.toFixed(4) };
}

// IDs canónicos de mercado (§10 del anexo) — sin strings ambiguos.
const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const TEAM_LINES = [0.5, 1.5, 2.5];
const lineTag = l => String(l).replace('.', '_');

function marketProbabilities(matrix) {
  const out = [];
  for (const l of GOAL_LINES) { const ou = overUnder(matrix, l); out.push({ market_id: `TOTAL_GOALS_OVER_${lineTag(l)}`, probability: ou.over }); out.push({ market_id: `TOTAL_GOALS_UNDER_${lineTag(l)}`, probability: ou.under }); }
  const bt = btts(matrix); out.push({ market_id: 'BTTS_YES', probability: bt.yes }); out.push({ market_id: 'BTTS_NO', probability: bt.no });
  for (const l of TEAM_LINES) { const h = teamOverUnder(matrix, 'home', l), a = teamOverUnder(matrix, 'away', l); out.push({ market_id: `HOME_TEAM_TOTAL_OVER_${lineTag(l)}`, probability: h.over }); out.push({ market_id: `HOME_TEAM_TOTAL_UNDER_${lineTag(l)}`, probability: h.under }); out.push({ market_id: `AWAY_TEAM_TOTAL_OVER_${lineTag(l)}`, probability: a.over }); out.push({ market_id: `AWAY_TEAM_TOTAL_UNDER_${lineTag(l)}`, probability: a.under }); }
  return out;
}

// Salida completa del Goal Engine para un par de lambdas (§18: estructura persistible). period = REGULATION (90').
function goalModelOutput(lh, la, { modelVersion = 'goal-engine-1.0.0', period = 'REGULATION' } = {}) {
  const { matrix, n, mass } = buildMatrix(lh, la);
  const x = oneX2FromMatrix(matrix);
  return {
    model_version: modelVersion, period,
    expected_home_goals: +lh.toFixed(4), expected_away_goals: +la.toFixed(4), expected_total_goals: +(lh + la).toFixed(4),
    matrix_size: n + 1, matrix_mass: +mass.toFixed(6),
    one_x2_raw: x.raw, one_x2_calibrated: x.calibrated,
    total_goals_distribution: totalGoalsDist(matrix),
    over_under: GOAL_LINES.map(l => overUnder(matrix, l)),
    btts: btts(matrix),
    team_totals: { home: TEAM_LINES.map(l => teamOverUnder(matrix, 'home', l)), away: TEAM_LINES.map(l => teamOverUnder(matrix, 'away', l)) },
    top_scorelines: topScorelines(matrix, 5),
    uncertainty: dispersion(matrix),
    markets: marketProbabilities(matrix),
    _matrix: matrix,
  };
}

module.exports = {
  DC_RHO, CALIB_LAMBDA, GOAL_LINES, TEAM_LINES,
  poissonPmf, dcTau, buildMatrix, oneX2FromMatrix, totalGoalsDist, overUnder, btts,
  teamGoalsDist, teamOverUnder, topScorelines, dispersion, marketProbabilities, goalModelOutput,
};
