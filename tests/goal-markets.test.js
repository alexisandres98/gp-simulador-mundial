// tests/goal-markets.test.js — Anexo M-G capa 2. Mercados derivados (asiáticos, margen de victoria, marcador
// exacto, combinaciones) + su settlement. PURO. Verifica IDENTIDADES de la distribución (todo coherente con UNA
// matriz) y la semántica de liquidación (push/half en asiáticas, |h−a| en margen, combinaciones). No toca pipeline.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const dist = require(R + '/goal-engine/distribution');
const mk = require(R + '/goal-engine/markets');
const st = require(R + '/goal-engine/settlement');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const CASES = [[1.82, 1.13], [1.30, 1.30], [2.60, 1.90], [0.60, 0.55]];

(async () => {
  console.log('\n§G2 TOTALES ASIÁTICOS (push / cuartos / over_fair)');
  for (const [lh, la] of CASES) {
    const { matrix } = dist.buildMatrix(lh, la);
    const H = mk.totalsHelpers(matrix);
    const w2 = mk.asianTotal(matrix, 2.0, H);
    ok(`línea 2.0: over+under+push == 1 (λ ${lh}/${la})`, close(w2.over + w2.under + w2.push, 1, 1e-5));
    ok(`línea 2.0: kind=whole y push==P(total=2) (λ ${lh}/${la})`, w2.kind === 'whole' && close(w2.push, H.eq(2)));
    ok(`línea 2.0: over_fair descuenta el push (λ ${lh}/${la})`, close(w2.over_fair, H.gt(2) / (1 - H.eq(2))));
    const q = mk.asianTotal(matrix, 2.25, H);
    const o20 = mk.asianTotal(matrix, 2.0, H).over_fair, o25 = mk.asianTotal(matrix, 2.5, H).over_fair;
    ok(`línea 2.25: over_fair = promedio de 2.0 y 2.5 (λ ${lh}/${la})`, close(q.over_fair, (o20 + o25) / 2) && q.kind === 'quarter');
    // monotonicidad: over_fair decrece al subir la línea
    const lines = mk.asianTotals(matrix).map(a => a.over_fair);
    let mono = true; for (let i = 1; i < lines.length; i++) if (lines[i] > lines[i - 1] + 1e-9) mono = false;
    ok(`over_fair monótona decreciente en la línea (λ ${lh}/${la})`, mono);
  }

  console.log('\n§G2 MARGEN DE VICTORIA (identidades)');
  for (const [lh, la] of CASES) {
    const { matrix } = dist.buildMatrix(lh, la);
    const wm = mk.winningMargin(matrix);
    const get = id => wm.find(x => x.market_id === id).probability;
    const draw = get('WINNING_MARGIN_DRAW'), a1 = get('WINNING_MARGIN_ABS_1'), a2 = get('WINNING_MARGIN_ABS_2'), a3 = get('WINNING_MARGIN_ABS_3_PLUS');
    ok(`partición |h−a|: draw+1+2+3+ == 1 (λ ${lh}/${la})`, close(draw + a1 + a2 + a3, 1, 1e-5));
    ok(`either_by_2+ == abs2 + abs3+ (λ ${lh}/${la})`, close(get('WINNING_MARGIN_EITHER_BY_2_PLUS'), a2 + a3, 1e-5));
    ok(`either_by_2+ == home_by_2+ + away_by_2+ (λ ${lh}/${la})`, close(get('WINNING_MARGIN_EITHER_BY_2_PLUS'), get('WINNING_MARGIN_HOME_BY_2_PLUS') + get('WINNING_MARGIN_AWAY_BY_2_PLUS'), 1e-5));
    ok(`either_by_3+ == home_by_3+ + away_by_3+ (λ ${lh}/${la})`, close(get('WINNING_MARGIN_EITHER_BY_3_PLUS'), get('WINNING_MARGIN_HOME_BY_3_PLUS') + get('WINNING_MARGIN_AWAY_BY_3_PLUS'), 1e-5));
  }

  console.log('\n§G2 MARCADOR EXACTO (suma ≈ 1 con ANY_OTHER)');
  {
    const { matrix } = dist.buildMatrix(1.82, 1.13);
    const ex = mk.exactScores(matrix);
    const sum = ex.reduce((s, x) => s + x.probability, 0);
    ok('Σ marcadores exactos + ANY_OTHER ≈ 1', close(sum, 1, 1e-5));
    ok('marcador modal coincide con top_scorelines del engine', ex[0].score === dist.topScorelines(matrix, 1)[0].score);
  }

  console.log('\n§G2 COMBINACIONES (coherencia con la matriz)');
  for (const [lh, la] of CASES) {
    const { matrix } = dist.buildMatrix(lh, la);
    const cm = mk.comboMarkets(matrix); const get = id => cm.find(x => x.market_id === id).probability;
    const ou = dist.overUnder(matrix, 2.5), bt = dist.btts(matrix);
    ok(`O2.5&BTTS ≤ min(O2.5, BTTS) (λ ${lh}/${la})`, get('OVER_2_5_AND_BTTS_YES') <= Math.min(ou.over, bt.yes) + 1e-9);
    ok(`gana-a-cero = local + visitante (λ ${lh}/${la})`, close(get('WIN_TO_NIL_EITHER'), get('HOME_WIN_TO_NIL') + get('AWAY_WIN_TO_NIL'), 1e-5));
    ok(`HOME_CLEAN_SHEET == P(away=0) (λ ${lh}/${la})`, close(get('HOME_CLEAN_SHEET'), mk.totalsHelpers(matrix) && (() => { let s = 0; for (let h = 0; h < matrix.length; h++) s += matrix[h][0]; return s; })(), 1e-6));
    ok(`home gana y O2.5 ≤ home gana y O1.5 (λ ${lh}/${la})`, get('HOME_WIN_AND_OVER_2_5') <= get('HOME_WIN_AND_OVER_1_5') + 1e-9);
  }

  console.log('\n§G2 SETTLEMENT ASIÁTICO (push / half)');
  ok('OVER_2_0 con 1-1 (total 2) → push', st.settle('TOTAL_GOALS_OVER_2_0', { homeGoals: 1, awayGoals: 1 }) === 'push');
  ok('OVER_2_0 con 2-1 (total 3) → won', st.settle('TOTAL_GOALS_OVER_2_0', { homeGoals: 2, awayGoals: 1 }) === 'won');
  ok('OVER_2_0 con 1-0 (total 1) → lost', st.settle('TOTAL_GOALS_OVER_2_0', { homeGoals: 1, awayGoals: 0 }) === 'lost');
  ok('OVER_2_25 con total 2 → half_lost', st.settle('TOTAL_GOALS_OVER_2_25', { homeGoals: 2, awayGoals: 0 }) === 'half_lost');
  ok('OVER_2_25 con total 3 → won', st.settle('TOTAL_GOALS_OVER_2_25', { homeGoals: 2, awayGoals: 1 }) === 'won');
  ok('OVER_2_25 con total 1 → lost', st.settle('TOTAL_GOALS_OVER_2_25', { homeGoals: 1, awayGoals: 0 }) === 'lost');
  ok('OVER_2_75 con total 3 → half_won', st.settle('TOTAL_GOALS_OVER_2_75', { homeGoals: 2, awayGoals: 1 }) === 'half_won');
  ok('OVER_2_75 con total 4 → won', st.settle('TOTAL_GOALS_OVER_2_75', { homeGoals: 2, awayGoals: 2 }) === 'won');
  ok('UNDER_2_25 con total 2 → half_won', st.settle('TOTAL_GOALS_UNDER_2_25', { homeGoals: 1, awayGoals: 1 }) === 'half_won');
  ok('UNDER_2_25 con total 3 → lost', st.settle('TOTAL_GOALS_UNDER_2_25', { homeGoals: 2, awayGoals: 1 }) === 'lost');

  console.log('\n§G2 SETTLEMENT MARGEN / EXACTO / COMBINACIÓN');
  ok('EITHER_BY_2_PLUS con 3-1 → won', st.settle('WINNING_MARGIN_EITHER_BY_2_PLUS', { homeGoals: 3, awayGoals: 1 }) === 'won');
  ok('EITHER_BY_2_PLUS con 0-2 → won (cualquiera)', st.settle('WINNING_MARGIN_EITHER_BY_2_PLUS', { homeGoals: 0, awayGoals: 2 }) === 'won');
  ok('EITHER_BY_2_PLUS con 2-1 → lost', st.settle('WINNING_MARGIN_EITHER_BY_2_PLUS', { homeGoals: 2, awayGoals: 1 }) === 'lost');
  ok('HOME_BY_2_PLUS con 1-3 → lost', st.settle('WINNING_MARGIN_HOME_BY_2_PLUS', { homeGoals: 1, awayGoals: 3 }) === 'lost');
  ok('MARGIN_DRAW con 1-1 → won', st.settle('WINNING_MARGIN_DRAW', { homeGoals: 1, awayGoals: 1 }) === 'won');
  ok('ABS_1 con 2-1 → won', st.settle('WINNING_MARGIN_ABS_1', { homeGoals: 2, awayGoals: 1 }) === 'won');
  ok('EXACT_SCORE_2_1 con 2-1 → won', st.settle('EXACT_SCORE_2_1', { homeGoals: 2, awayGoals: 1 }) === 'won');
  ok('EXACT_SCORE_2_1 con 1-1 → lost', st.settle('EXACT_SCORE_2_1', { homeGoals: 1, awayGoals: 1 }) === 'lost');
  ok('EXACT_SCORE_ANY_OTHER con 6-1 → won (fuera de grilla)', st.settle('EXACT_SCORE_ANY_OTHER', { homeGoals: 6, awayGoals: 1 }) === 'won');
  ok('HOME_WIN_AND_OVER_2_5 con 3-1 → won', st.settle('HOME_WIN_AND_OVER_2_5', { homeGoals: 3, awayGoals: 1 }) === 'won');
  ok('HOME_WIN_AND_OVER_2_5 con 2-0 → lost (total<3)', st.settle('HOME_WIN_AND_OVER_2_5', { homeGoals: 2, awayGoals: 0 }) === 'lost');
  ok('HOME_WIN_TO_NIL con 2-0 → won', st.settle('HOME_WIN_TO_NIL', { homeGoals: 2, awayGoals: 0 }) === 'won');
  ok('HOME_WIN_TO_NIL con 2-1 → lost', st.settle('HOME_WIN_TO_NIL', { homeGoals: 2, awayGoals: 1 }) === 'lost');
  ok('metadata WINNING_MARGIN period REGULATION', (m => m && m.scope === 'winning_margin' && m.period === 'REGULATION')(st.marketMeta('WINNING_MARGIN_EITHER_BY_2_PLUS')));
  ok('market desconocido → unknown', st.settle('FOO_BAR', { homeGoals: 1, awayGoals: 1 }) === 'unknown');

  console.log(`\n[goal-markets] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
