// goal-engine/markets.js — Anexo M-G (capa 2 de mercados). TODOS los mercados de goles que NO eran de primera
// capa, derivados de la MISMA matriz de marcadores que produce distribution.js. PURO (sin DB, sin red). Cubre:
//   • Totales ASIÁTICOS (líneas .0/.25/.75 con push y cuartos: el engine entiende half/whole/quarter, no las trata
//     como binarias) — over_fair = probabilidad justa que descuenta el push para comparar contra el mercado.
//   • MARGEN DE VICTORIA (WINNING_MARGIN): cualquiera por 2+/3+, local/visitante por 2+/3+, margen exacto 1/2/3+,
//     empate. "Cualquiera gana por 2+" = Σ marcadores con |h−a|≥2 (no toma partido por un equipo; §7 del anexo).
//   • MARCADOR EXACTO (EXACT_SCORE) sobre una grilla 0..GRID_MAX + ANY_OTHER (informativo).
//   • COMBINACIONES coherentes: Over2.5&BTTS, Under3.5&gana-alguien, gana-a-cero, BTTS&gana-alguien, empate-con-goles,
//     clean sheet local/visitante, y VICTORIA & Over 1.5/2.5 por equipo (el "Paraguay gana +2.5" sale de aquí).
// Todo se deriva de UNA distribución → coherencia total (no un modelo por mercado). Settlement vive en settlement.js.
'use strict';
const dist = require('./distribution');

// market_id de línea: SIEMPRE con parte decimal (2 → '2_0', 2.25 → '2_25', 2.5 → '2_5'). El settlement parsea
// `${int}.${frac}` → 2.0 / 2.25 / 2.5. Mantiene compatibilidad con los ids existentes (TOTAL_GOALS_OVER_2_5).
function lineId(l) {
  const s = (Math.round(l * 100) / 100).toString();
  const [intp, frac = ''] = s.split('.');
  return intp + '_' + (frac === '' ? '0' : frac);
}

// clasificación de una línea de total: 'half' (.5), 'whole' (.0), 'quarter' (.25/.75).
function lineKind(l) {
  if (Math.abs(l * 2 - Math.round(l * 2)) > 1e-9) return 'quarter';   // .25/.75 → mitad no entera
  if (Number.isInteger(l)) return 'whole';
  return 'half';
}

// Helpers de probabilidad sobre la distribución de totales.
function totalsHelpers(matrix) {
  const d = dist.totalGoalsDist(matrix); // { total: p }
  const gt = (L) => { let s = 0; for (const [t, p] of Object.entries(d)) if (Number(t) > L) s += p; return s; };
  const lt = (L) => { let s = 0; for (const [t, p] of Object.entries(d)) if (Number(t) < L) s += p; return s; };
  const eq = (n) => d[n] || 0;
  return { d, gt, lt, eq };
}

// Probabilidad JUSTA de Over en una línea entera (descuenta el push: money-back sobre el empate de la línea).
function wholeFairOver(H, N) { const push = H.eq(N); const denom = 1 - push; return denom > 0 ? H.gt(N) / denom : H.gt(N); }

// ---------- TOTALES ASIÁTICOS ----------
// Líneas del anexo §2 (incluye las asiáticas). Para cada una devuelve over/under "de display", push, over_fair
// (la que se compara contra el mercado), kind y, para cuartos, las dos sub-líneas que la componen.
const ASIAN_LINES = [0.5, 1.5, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 4.5];

function asianTotal(matrix, line, H = totalsHelpers(matrix)) {
  const kind = lineKind(line);
  let over, under, push = 0, overFair, components = null;
  if (kind === 'half') {
    over = H.gt(line); under = 1 - over; overFair = over;
  } else if (kind === 'whole') {
    over = H.gt(line); under = H.lt(line); push = H.eq(line); overFair = wholeFairOver(H, line);
  } else { // quarter: promedio de las dos sub-líneas adyacentes (half-stake en cada una)
    const lo = Math.floor(line * 2) / 2;   // 2.25 → 2.0 ; 2.75 → 2.5
    const hi = lo + 0.5;                    // 2.25 → 2.5 ; 2.75 → 3.0
    const fairAt = (L) => lineKind(L) === 'whole' ? wholeFairOver(H, L) : H.gt(L);
    overFair = (fairAt(lo) + fairAt(hi)) / 2;
    over = overFair; under = 1 - overFair; components = [lo, hi];
  }
  return {
    market_family: 'match_total', line, kind, push: +push.toFixed(6),
    over: +over.toFixed(6), under: +under.toFixed(6),
    over_fair: +overFair.toFixed(6), under_fair: +(1 - overFair).toFixed(6),
    components,
    market_id_over: `TOTAL_GOALS_OVER_${lineId(line)}`, market_id_under: `TOTAL_GOALS_UNDER_${lineId(line)}`,
  };
}

function asianTotals(matrix) {
  const H = totalsHelpers(matrix);
  return ASIAN_LINES.map((l) => asianTotal(matrix, l, H));
}

// ---------- MARGEN DE VICTORIA (WINNING_MARGIN) ----------
// Definiciones canónicas §7. period FULL_TIME_90 (settlement por marcador reglamentario). Todo desde |h−a| y signo.
function marginProbs(matrix) {
  let draw = 0, abs1 = 0, abs2 = 0, abs3p = 0;     // partición exhaustiva por |h−a|
  let home2p = 0, away2p = 0, home3p = 0, away3p = 0;
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    const p = matrix[h][a]; const d = h - a, ad = Math.abs(d);
    if (ad === 0) draw += p; else if (ad === 1) abs1 += p; else if (ad === 2) abs2 += p; else abs3p += p;
    if (d >= 2) home2p += p; if (d <= -2) away2p += p;
    if (d >= 3) home3p += p; if (d <= -3) away3p += p;
  }
  return { draw, abs1, abs2, abs3p, home2p, away2p, home3p, away3p };
}

function winningMargin(matrix) {
  const m = marginProbs(matrix);
  const r = (v) => +v.toFixed(6);
  const mk = (id, p) => ({ market_id: id, market_family: 'winning_margin', probability: r(p) });
  return [
    mk('WINNING_MARGIN_EITHER_BY_2_PLUS', m.abs2 + m.abs3p),   // cualquiera por 2+ (la Pick estrella del anexo)
    mk('WINNING_MARGIN_EITHER_BY_3_PLUS', m.abs3p),
    mk('WINNING_MARGIN_HOME_BY_2_PLUS', m.home2p),
    mk('WINNING_MARGIN_AWAY_BY_2_PLUS', m.away2p),
    mk('WINNING_MARGIN_HOME_BY_3_PLUS', m.home3p),
    mk('WINNING_MARGIN_AWAY_BY_3_PLUS', m.away3p),
    mk('WINNING_MARGIN_DRAW', m.draw),                          // empate (margen 0)
    mk('WINNING_MARGIN_ABS_1', m.abs1),                         // margen exacto 1
    mk('WINNING_MARGIN_ABS_2', m.abs2),                         // margen exacto 2
    mk('WINNING_MARGIN_ABS_3_PLUS', m.abs3p),                   // margen 3+
  ];
}

// ---------- MARCADOR EXACTO ----------
const GRID_MAX = 5; // 0-0 .. 5-5 enumerados; el resto cae en ANY_OTHER (informativo)
function exactScores(matrix, { gridMax = GRID_MAX } = {}) {
  const out = []; let enumerated = 0;
  for (let h = 0; h <= gridMax; h++) for (let a = 0; a <= gridMax; a++) {
    const p = (matrix[h] && matrix[h][a]) || 0; enumerated += p;
    out.push({ market_id: `EXACT_SCORE_${h}_${a}`, market_family: 'exact_score', score: `${h}-${a}`, h, a, probability: +p.toFixed(6) });
  }
  out.push({ market_id: 'EXACT_SCORE_ANY_OTHER', market_family: 'exact_score', score: 'otro', probability: +Math.max(0, 1 - enumerated).toFixed(6) });
  out.sort((x, y) => y.probability - x.probability);
  return out;
}

// ---------- COMBINACIONES (coherentes con la matriz) ----------
function comboMarkets(matrix) {
  let o25btts = 0, u35win = 0, homeWTN = 0, awayWTN = 0, bttsWin = 0, drawGoals = 0;
  let homeCS = 0, awayCS = 0, homeWinO15 = 0, awayWinO15 = 0, homeWinO25 = 0, awayWinO25 = 0;
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    const p = matrix[h][a]; const tot = h + a, win = h !== a;
    if (tot >= 3 && h >= 1 && a >= 1) o25btts += p;                 // Over 2.5 y ambos anotan
    if (tot <= 3 && win) u35win += p;                               // Under 3.5 y gana alguien
    if (h > a && a === 0) homeWTN += p;                             // local gana a cero
    if (a > h && h === 0) awayWTN += p;                             // visitante gana a cero
    if (h >= 1 && a >= 1 && win) bttsWin += p;                      // ambos anotan y gana alguien
    if (h === a && h >= 1) drawGoals += p;                          // empate con goles
    if (a === 0) homeCS += p;                                       // portería a cero local
    if (h === 0) awayCS += p;                                       // portería a cero visitante
    if (h > a && tot >= 2) homeWinO15 += p;                         // local gana y Over 1.5
    if (a > h && tot >= 2) awayWinO15 += p;
    if (h > a && tot >= 3) homeWinO25 += p;                         // local gana y Over 2.5  ("Paraguay gana +2.5")
    if (a > h && tot >= 3) awayWinO25 += p;
  }
  const r = (v) => +v.toFixed(6);
  const mk = (id, p) => ({ market_id: id, market_family: 'combo', probability: r(p) });
  return [
    mk('OVER_2_5_AND_BTTS_YES', o25btts),
    mk('UNDER_3_5_AND_A_TEAM_WINS', u35win),
    mk('WIN_TO_NIL_EITHER', homeWTN + awayWTN),
    mk('HOME_WIN_TO_NIL', homeWTN),
    mk('AWAY_WIN_TO_NIL', awayWTN),
    mk('BTTS_AND_A_TEAM_WINS', bttsWin),
    mk('DRAW_WITH_GOALS', drawGoals),
    mk('HOME_CLEAN_SHEET', homeCS),
    mk('AWAY_CLEAN_SHEET', awayCS),
    mk('HOME_WIN_AND_OVER_1_5', homeWinO15),
    mk('AWAY_WIN_AND_OVER_1_5', awayWinO15),
    mk('HOME_WIN_AND_OVER_2_5', homeWinO25),
    mk('AWAY_WIN_AND_OVER_2_5', awayWinO25),
  ];
}

// ---------- ENSAMBLE: lista plana de mercados (para Value) + estructura por familia (para UI/persistencia) ----------
// markets[] usa over_fair en los totales asiáticos (la prob justa que se compara contra el consenso no-vig).
function extendedMarkets(matrix) {
  const out = [];
  for (const a of asianTotals(matrix)) {
    out.push({ market_id: a.market_id_over, market_family: 'match_total', probability: a.over_fair, line: a.line, side: 'over' });
    out.push({ market_id: a.market_id_under, market_family: 'match_total', probability: a.under_fair, line: a.line, side: 'under' });
  }
  for (const w of winningMargin(matrix)) out.push({ market_id: w.market_id, market_family: 'winning_margin', probability: w.probability });
  for (const c of comboMarkets(matrix)) out.push({ market_id: c.market_id, market_family: 'combo', probability: c.probability });
  return out;
}

function fullGoalMarkets(matrix) {
  return {
    asian_totals: asianTotals(matrix),
    winning_margin: winningMargin(matrix),
    combos: comboMarkets(matrix),
    exact_scores: exactScores(matrix),
    markets_extended: extendedMarkets(matrix),
  };
}

module.exports = {
  ASIAN_LINES, GRID_MAX, lineId, lineKind,
  totalsHelpers, asianTotal, asianTotals, wholeFairOver,
  marginProbs, winningMargin, exactScores, comboMarkets,
  extendedMarkets, fullGoalMarkets,
};
