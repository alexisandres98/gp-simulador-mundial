// context-engine/knockout.js — Fase M.5. Semántica de FASE ELIMINATORIA + market_semantics_gate (bloqueante).
// PURO. Separa ESTRICTAMENTE dos mercados que NO deben mezclarse (§10 del spec):
//   - REGULATION 1X2: HOME/DRAW/AWAY en 90' (sin prórroga ni penales) — settlement por marcador reglamentario.
//   - QUALIFY: TEAM_A_QUALIFIES / TEAM_B_QUALIFIES — incluye prórroga y penales; suma 1 entre ambos equipos.
// Modela prórroga y penales por separado, con pesos CONSERVADORES y uncertainty alta. El Value Engine NUNCA
// debe comparar P(qualify) contra una cuota 1X2 regulation → marketSemanticsGate lo impide.
'use strict';

const num = (v, d) => (v == null || isNaN(Number(v))) ? d : Number(v);

// Probabilidad de clasificación a partir del 1X2 reglamentario.
// reg = {home,draw,away} (90'). En empate va a prórroga; si sigue empatado, a penales.
// params (conservadores por defecto): etDrawProb (prob. de que la prórroga también termine empatada),
//   penaltyHomeEdge (ventaja del local en penales sobre 0.5; default 0 = sin ventaja modelada).
function qualifyProbabilities(reg, params = {}) {
  const pH = Math.max(0, num(reg.home, 0)), pD = Math.max(0, num(reg.draw, 0)), pA = Math.max(0, num(reg.away, 0));
  const s = pH + pD + pA || 1;
  const h = pH / s, d = pD / s, a = pA / s;
  const etDraw = Math.max(0, Math.min(1, num(params.etDrawProb, 0.33)));
  const penEdge = Math.max(-0.5, Math.min(0.5, num(params.penaltyHomeEdge, 0)));
  // reparto decisivo a partir del 1X2 reglamentario (quién es más fuerte cuando hay ganador)
  const dec = h + a;
  const sHome = dec > 0 ? h / dec : 0.5, sAway = dec > 0 ? a / dec : 0.5;
  // P(home avanza | empate tras 90') = gana en prórroga + (prórroga empatada)·penales
  const homeAdv = (1 - etDraw) * sHome + etDraw * (0.5 + penEdge);
  const awayAdv = (1 - etDraw) * sAway + etDraw * (0.5 - penEdge);
  // normalizar el reparto del tramo de empate (por si penEdge desbalancea levemente)
  const advSum = homeAdv + awayAdv || 1;
  const qHome = h + d * (homeAdv / advSum);
  const qAway = a + d * (awayAdv / advSum);
  return {
    team_a_qualifies: +qHome.toFixed(6),
    team_b_qualifies: +qAway.toFixed(6),
    components: {
      reg_home_win: +h.toFixed(6), reg_draw: +d.toFixed(6), reg_away_win: +a.toFixed(6),
      et_draw_prob: etDraw, penalty_home_edge: penEdge,
      home_advance_if_tied: +(homeAdv / advSum).toFixed(6), away_advance_if_tied: +(awayAdv / advSum).toFixed(6),
    },
  };
}

// Catálogo mínimo de semántica de mercado. period: REGULATION (90'+añadido) | FULL_MATCH (incl. prórroga/penales).
const MARKETS = {
  '1X2': { period: 'REGULATION', outcomes: ['HOME', 'DRAW', 'AWAY'], includes_extra_time: false },
  QUALIFY: { period: 'FULL_MATCH', outcomes: ['TEAM_A_QUALIFIES', 'TEAM_B_QUALIFIES'], includes_extra_time: true },
};

// GATE BLOQUEANTE: ¿es válido comparar la probabilidad del modelo (modelMarket) contra una cuota (quoteMarket)?
// Bloquea si difieren market_code, period_code o la inclusión de prórroga. Devuelve { ok, reason }.
function marketSemanticsGate(modelMarket, quoteMarket) {
  const m = MARKETS[modelMarket && modelMarket.market_code], q = MARKETS[quoteMarket && quoteMarket.market_code];
  if (!m) return { ok: false, reason: 'UNKNOWN_MODEL_MARKET' };
  if (!q) return { ok: false, reason: 'UNKNOWN_QUOTE_MARKET' };
  if (modelMarket.market_code !== quoteMarket.market_code) return { ok: false, reason: 'MARKET_MISMATCH' };
  const mp = modelMarket.period_code || m.period, qp = quoteMarket.period_code || q.period;
  if (mp !== qp) return { ok: false, reason: 'PERIOD_MISMATCH' };
  if (m.includes_extra_time !== q.includes_extra_time) return { ok: false, reason: 'EXTRA_TIME_MISMATCH' };
  return { ok: true, reason: 'ok' };
}

module.exports = { MARKETS, qualifyProbabilities, marketSemanticsGate };
