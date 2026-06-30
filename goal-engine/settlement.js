// goal-engine/settlement.js — Anexo M-G (G.4 + capa 2). Semántica + settlement de TODOS los mercados de goles.
// PURO. Todos se liquidan por el marcador de TIEMPO REGLAMENTARIO (90'+añadido), SIN prórroga (period FULL_TIME_90).
// Define metadata canónica (scope/period/line/side/push) y la función de liquidación. Resultados posibles:
//   'won' | 'lost' | 'push' | 'half_won' | 'half_lost' | 'void' | 'unknown'.
//   - Líneas .5 → binarias (sin push). Líneas enteras (.0) → push si el total/margen iguala la línea.
//   - Líneas de cuarto (.25/.75) → half-stake en dos sub-líneas → 'half_won'/'half_lost' cuando una sub-línea empuja.
'use strict';

const GRID_MAX = 5; // debe coincidir con markets.js (EXACT_SCORE_ANY_OTHER = score fuera de la grilla 0..GRID_MAX)

// metadata de cada market_id. Devuelve null si no se reconoce.
function marketMeta(marketId) {
  const id = String(marketId || '');
  let m = id.match(/^TOTAL_GOALS_(OVER|UNDER)_(\d+)_(\d+)$/);
  if (m) { const line = Number(`${m[2]}.${m[3]}`); return { market_id: id, scope: 'match_total', side: m[1].toLowerCase(), line, period: 'REGULATION', kind: lineKind(line), push: Number.isInteger(line) }; }
  if (id === 'BTTS_YES' || id === 'BTTS_NO') return { market_id: id, scope: 'btts', side: id === 'BTTS_YES' ? 'yes' : 'no', period: 'REGULATION', push: false };
  m = id.match(/^(HOME|AWAY)_TEAM_TOTAL_(OVER|UNDER)_(\d+)_(\d+)$/);
  if (m) { const line = Number(`${m[3]}.${m[4]}`); return { market_id: id, scope: 'team_total', team: m[1].toLowerCase(), side: m[2].toLowerCase(), line, period: 'REGULATION', kind: lineKind(line), push: Number.isInteger(line) }; }
  if (/^WINNING_MARGIN_/.test(id)) return { market_id: id, scope: 'winning_margin', period: 'REGULATION', push: false };
  m = id.match(/^EXACT_SCORE_(\d+)_(\d+)$/);
  if (m) return { market_id: id, scope: 'exact_score', h: Number(m[1]), a: Number(m[2]), period: 'REGULATION', push: false };
  if (id === 'EXACT_SCORE_ANY_OTHER') return { market_id: id, scope: 'exact_score_other', period: 'REGULATION', push: false };
  if (isComboId(id)) return { market_id: id, scope: 'combo', period: 'REGULATION', push: false };
  return null;
}

function lineKind(l) {
  if (Math.abs(l * 2 - Math.round(l * 2)) > 1e-9) return 'quarter';
  if (Number.isInteger(l)) return 'whole';
  return 'half';
}

// Resultado de UNA sub-línea (.5 o .0) de un total/equipo. value: total o goles del equipo.
function legOutcome(value, subLine, side /* 'over'|'under' */) {
  if (Number.isInteger(subLine) && value === subLine) return 'push';
  const over = value > subLine;
  const sideWins = side === 'over' ? over : !over;
  return sideWins ? 'won' : 'lost';
}

// Combina dos sub-resultados de medio-stake en el resultado asiático. (Para líneas de cuarto.)
function combineLegs(r1, r2) {
  if (r1 === 'won' && r2 === 'won') return 'won';
  if (r1 === 'lost' && r2 === 'lost') return 'lost';
  if ((r1 === 'won' && r2 === 'push') || (r1 === 'push' && r2 === 'won')) return 'half_won';
  if ((r1 === 'lost' && r2 === 'push') || (r1 === 'push' && r2 === 'lost')) return 'half_lost';
  // sub-líneas adyacentes nunca dan won+lost; fallback defensivo.
  return r1 === 'push' ? r2 : r1;
}

// Liquida una línea de total/equipo (half/whole/quarter) por el valor observado.
function settleLine(value, line, side) {
  const k = lineKind(line);
  if (k === 'quarter') {
    const lo = Math.floor(line * 2) / 2, hi = lo + 0.5;
    return combineLegs(legOutcome(value, lo, side), legOutcome(value, hi, side));
  }
  return legOutcome(value, line, side); // half/whole
}

// settle(marketId, { homeGoals, awayGoals }) → resultado. Solo marcador reglamentario.
function settle(marketId, score = {}) {
  const meta = marketMeta(marketId);
  if (!meta) return 'unknown';
  const h = score.homeGoals, a = score.awayGoals;
  if (typeof h !== 'number' || typeof a !== 'number') return 'void';
  const total = h + a, d = h - a, ad = Math.abs(d);

  switch (meta.scope) {
    case 'match_total': return settleLine(total, meta.line, meta.side);
    case 'team_total': return settleLine(meta.team === 'home' ? h : a, meta.line, meta.side);
    case 'btts': { const yes = h >= 1 && a >= 1; return (meta.side === 'yes') === yes ? 'won' : 'lost'; }
    case 'exact_score': return (h === meta.h && a === meta.a) ? 'won' : 'lost';
    case 'exact_score_other': return (h > GRID_MAX || a > GRID_MAX) ? 'won' : 'lost';
    case 'winning_margin': return settleWinningMargin(marketId, d, ad) ? 'won' : 'lost';
    case 'combo': return settleCombo(marketId, h, a) ? 'won' : 'lost';
    default: return 'unknown';
  }
}

function settleWinningMargin(id, d, ad) {
  switch (id) {
    case 'WINNING_MARGIN_EITHER_BY_2_PLUS': return ad >= 2;
    case 'WINNING_MARGIN_EITHER_BY_3_PLUS': return ad >= 3;
    case 'WINNING_MARGIN_HOME_BY_2_PLUS': return d >= 2;
    case 'WINNING_MARGIN_AWAY_BY_2_PLUS': return d <= -2;
    case 'WINNING_MARGIN_HOME_BY_3_PLUS': return d >= 3;
    case 'WINNING_MARGIN_AWAY_BY_3_PLUS': return d <= -3;
    case 'WINNING_MARGIN_DRAW': return ad === 0;
    case 'WINNING_MARGIN_ABS_1': return ad === 1;
    case 'WINNING_MARGIN_ABS_2': return ad === 2;
    case 'WINNING_MARGIN_ABS_3_PLUS': return ad >= 3;
    default: return false;
  }
}

const COMBO_IDS = new Set([
  'OVER_2_5_AND_BTTS_YES', 'UNDER_3_5_AND_A_TEAM_WINS', 'WIN_TO_NIL_EITHER', 'HOME_WIN_TO_NIL', 'AWAY_WIN_TO_NIL',
  'BTTS_AND_A_TEAM_WINS', 'DRAW_WITH_GOALS', 'HOME_CLEAN_SHEET', 'AWAY_CLEAN_SHEET',
  'HOME_WIN_AND_OVER_1_5', 'AWAY_WIN_AND_OVER_1_5', 'HOME_WIN_AND_OVER_2_5', 'AWAY_WIN_AND_OVER_2_5',
]);
function isComboId(id) { return COMBO_IDS.has(id); }

function settleCombo(id, h, a) {
  const tot = h + a, win = h !== a;
  switch (id) {
    case 'OVER_2_5_AND_BTTS_YES': return tot >= 3 && h >= 1 && a >= 1;
    case 'UNDER_3_5_AND_A_TEAM_WINS': return tot <= 3 && win;
    case 'WIN_TO_NIL_EITHER': return (h > a && a === 0) || (a > h && h === 0);
    case 'HOME_WIN_TO_NIL': return h > a && a === 0;
    case 'AWAY_WIN_TO_NIL': return a > h && h === 0;
    case 'BTTS_AND_A_TEAM_WINS': return h >= 1 && a >= 1 && win;
    case 'DRAW_WITH_GOALS': return h === a && h >= 1;
    case 'HOME_CLEAN_SHEET': return a === 0;
    case 'AWAY_CLEAN_SHEET': return h === 0;
    case 'HOME_WIN_AND_OVER_1_5': return h > a && tot >= 2;
    case 'AWAY_WIN_AND_OVER_1_5': return a > h && tot >= 2;
    case 'HOME_WIN_AND_OVER_2_5': return h > a && tot >= 3;
    case 'AWAY_WIN_AND_OVER_2_5': return a > h && tot >= 3;
    default: return false;
  }
}

module.exports = { GRID_MAX, marketMeta, settle, lineKind, legOutcome, combineLegs, settleLine };
