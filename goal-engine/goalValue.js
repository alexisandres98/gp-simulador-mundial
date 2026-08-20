// goal-engine/goalValue.js — Fase N.12/N.13. Goal Value SHADOW. Compara la prob GP del Goal Engine contra el
// consenso no-vig del mercado para cada mercado de goles. Política PROPIA provisional (goal-value-policy-shadow-1):
// NO reutiliza thresholds 1X2. Incluye SENSIBILIDAD de la línea (si una clasificación cambia ante un delta mínimo
// de lambda → no marcar STRONG shadow). NO produce Candidates/Picks/Signals: todo shadow_only.
'use strict';
const goalEngine = require('./distribution');
const num = (v, d) => (v == null || isNaN(Number(v))) ? d : Number(v);

const POLICY_VERSION = 'goal-value-policy-shadow-1';
// thresholds PROVISIONALES e independientes del 1X2 (goles tienen más vig/varianza → más conservador).
function thresholds() {
  return {
    strongEdge: num(process.env.GOAL_STRONG_MIN_EDGE_PP, 0.05),
    leanEdge: num(process.env.GOAL_LEAN_MIN_EDGE_PP, 0.03),
    watchEdge: num(process.env.GOAL_WATCH_MIN_EDGE_PP, 0.015),
    conservativeBuffer: num(process.env.GOAL_CONSERVATIVE_BUFFER_PP, 0.03),
    lambdaDelta: num(process.env.GOAL_SENSITIVITY_LAMBDA_DELTA, 0.15),
    minGroups: num(process.env.GOAL_MIN_GROUPS, 3),
  };
}

// Probabilidad GP de un market_id a partir de lambdas (usa el Goal Engine).
function gpProbForMarket(lh, la, marketId) {
  const out = goalEngine.goalModelOutput(lh, la);
  const m = out.markets.find(x => x.market_id === marketId);
  if (m) return m.probability;
  // FAMILIAS EXTENDIDAS (20-ago): `out.markets` solo trae totales, ambos-marcan y totales de equipo. Los
  // totales asiáticos, el margen, los combos y las tres familias nuevas —doble oportunidad, empate no
  // válido y hándicap asiático— viven en `extendedMarkets`, que se calcula sobre la MISMA matriz. Sin este
  // repliegue, cualquier cuota de esas familias entraba y salía como `unknown_market`: ingerida, jamás
  // valorada. Un mercado que se guarda pero no se valora es trabajo que no produce nada.
  try {
    const mk = require('./markets');
    const e = mk.extendedMarkets(out._matrix).find((x) => x.market_id === marketId);
    return e ? e.probability : null;
  } catch { return null; }
}

// Sensibilidad: P(market | λ_total ± delta). Reparte el delta proporcional a las lambdas.
function sensitivity(lh, la, marketId, delta) {
  const tot = lh + la || 1;
  const scaled = (k) => [lh * (1 + k * (lh / tot) / (lh / tot || 1)) , la]; // simple: escala el total
  const at = (mult) => { const f = (lh + la) === 0 ? 1 : (lh + la + mult * delta) / (lh + la); return gpProbForMarket(lh * f, la * f, marketId); };
  return { minus: at(-1), base: gpProbForMarket(lh, la, marketId), plus: at(1) };
}

// Evalúa UN market outcome en shadow. consensusProb = no-vig del mercado; bestOdds = mejor cuota; groups = grupos verificados.
function evaluate({ lambdaHome, lambdaAway, marketId, marketFamily, consensusProb, bestOdds, groups = 0 }, th = thresholds()) {
  const gp = gpProbForMarket(lambdaHome, lambdaAway, marketId);
  if (gp == null) return { ok: false, reason: 'unknown_market' };
  const breakEven = bestOdds > 1 ? 1 / bestOdds : null;
  const conservative = Math.max(0, gp - th.conservativeBuffer);
  const rawEdge = breakEven != null ? gp - breakEven : null;
  const adjEdge = breakEven != null ? conservative - breakEven : null;
  const adjEv = bestOdds > 1 ? conservative * bestOdds - 1 : null;
  // sensibilidad de la clasificación
  const sens = sensitivity(lambdaHome, lambdaAway, marketId, th.lambdaDelta);
  const edgeAt = (p) => (breakEven != null && p != null) ? Math.max(0, p - th.conservativeBuffer) - breakEven : null;
  const eMinus = edgeAt(sens.minus), ePlus = edgeAt(sens.plus);
  const unstable = (adjEdge != null) && ((adjEdge >= th.strongEdge) !== (eMinus >= th.strongEdge) || (adjEdge >= th.strongEdge) !== (ePlus >= th.strongEdge));
  let cls = 'pass';
  if (adjEdge != null && groups >= th.minGroups) {
    if (adjEdge >= th.strongEdge && !unstable) cls = 'strong';
    else if (adjEdge >= th.strongEdge && unstable) cls = 'lean'; // inestable → degradar de strong a lean
    else if (adjEdge >= th.leanEdge) cls = 'lean';
    else if (adjEdge >= th.watchEdge) cls = 'watch';
  } else if (adjEdge != null && adjEdge >= th.watchEdge) cls = 'watch';
  return {
    ok: true, market_id: marketId, market_family: marketFamily, policy_version: POLICY_VERSION,
    gp_probability: +gp.toFixed(6), market_consensus_probability: consensusProb != null ? +Number(consensusProb).toFixed(6) : null,
    best_decimal_odds: bestOdds, break_even_probability: breakEven != null ? +breakEven.toFixed(6) : null,
    raw_edge_pp: rawEdge != null ? +rawEdge.toFixed(6) : null, conservative_probability: +conservative.toFixed(6),
    adjusted_edge_pp: adjEdge != null ? +adjEdge.toFixed(6) : null, adjusted_ev: adjEv != null ? +adjEv.toFixed(6) : null,
    classification: cls, line_probability_sensitivity: { minus: sens.minus, base: sens.base, plus: sens.plus, unstable },
    registry_eligible: false, pick_candidate_eligible: false, public_eligible: false, evaluation_mode: 'shadow_goal_value',
  };
}

module.exports = { POLICY_VERSION, thresholds, gpProbForMarket, sensitivity, evaluate };
