// prop-engine/markets.js — Mercados de PROPS derivados de una proyección (prop-engine/model.project).
// PURO. Mismo patrón que goal-engine/markets.js: ids canónicos + probabilidades justas por línea.
// Solo líneas .5 (sin push) en el MVP. Familias: CORNERS_TOTAL, CORNERS_TEAM, CARDS_TOTAL, CARDS_TEAM.
'use strict';
const { overProbNB } = require('./model');

const CORNER_TOTAL_LINES = [7.5, 8.5, 9.5, 10.5, 11.5];
const CORNER_TEAM_LINES = [3.5, 4.5, 5.5];
const CARD_TOTAL_LINES = [1.5, 2.5, 3.5, 4.5];
const CARD_TEAM_LINES = [0.5, 1.5, 2.5];

const lineId = l => String(l).replace('.', '_');

function build(projection) {
  const out = [];
  const push = (family, id, side, line, prob, scope) => out.push({
    family, market_id: id, side, line, team_scope: scope || 'total', fair_prob: +prob.toFixed(6),
  });
  const p = projection;
  for (const line of CORNER_TOTAL_LINES) {
    const over = overProbNB(p.corners.total, p.corners.r_total, line);
    push('corners_total', `CORNERS_OVER_${lineId(line)}`, 'over', line, over);
    push('corners_total', `CORNERS_UNDER_${lineId(line)}`, 'under', line, 1 - over);
  }
  for (const scope of ['home', 'away']) {
    for (const line of CORNER_TEAM_LINES) {
      const over = overProbNB(p.corners[scope], p.corners.r_team, line);
      push('corners_team', `CORNERS_${scope.toUpperCase()}_OVER_${lineId(line)}`, 'over', line, over, scope);
      push('corners_team', `CORNERS_${scope.toUpperCase()}_UNDER_${lineId(line)}`, 'under', line, 1 - over, scope);
    }
  }
  for (const line of CARD_TOTAL_LINES) {
    const over = overProbNB(p.cards.total, p.cards.r_total, line);
    push('cards_total', `CARDS_OVER_${lineId(line)}`, 'over', line, over);
    push('cards_total', `CARDS_UNDER_${lineId(line)}`, 'under', line, 1 - over);
  }
  for (const scope of ['home', 'away']) {
    for (const line of CARD_TEAM_LINES) {
      const over = overProbNB(p.cards[scope], p.cards.r_team, line);
      push('cards_team', `CARDS_${scope.toUpperCase()}_OVER_${lineId(line)}`, 'over', line, over, scope);
      push('cards_team', `CARDS_${scope.toUpperCase()}_UNDER_${lineId(line)}`, 'under', line, 1 - over, scope);
    }
  }
  return out;
}

// Liquidación a 90' (conteos reglamentarios). actual = { corners_home, corners_away, cards_home, cards_away }.
// Devuelve won|lost por mercado (líneas .5 → sin push). null si falta el dato.
function settle(market, actual) {
  const val = (() => {
    if (market.family === 'corners_total') return actual.corners_home + actual.corners_away;
    if (market.family === 'cards_total') return actual.cards_home + actual.cards_away;
    if (market.family === 'corners_team') return market.team_scope === 'home' ? actual.corners_home : actual.corners_away;
    if (market.family === 'cards_team') return market.team_scope === 'home' ? actual.cards_home : actual.cards_away;
    return null;
  })();
  if (val == null || !isFinite(val)) return null;
  const over = val > market.line;
  return (market.side === 'over' ? over : !over) ? 'won' : 'lost';
}

module.exports = { build, settle, CORNER_TOTAL_LINES, CORNER_TEAM_LINES, CARD_TOTAL_LINES, CARD_TEAM_LINES };
