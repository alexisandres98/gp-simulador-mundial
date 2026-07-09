// tests/pick-metrics.test.js — Capa quant del track record (pick-engine/metrics). PURO, sin I/O.
// Verifica Brier/log loss, calibración por rangos, CLV (precio y EV al cierre), el mapeo pick→market_id
// de cierre (SOLID/GOALS/props/COMBO) y el ensamble quantMetrics con familias experimento.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const M = require(R + '/pick-engine/metrics');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('\n§ Scores de probabilidad');
{
  // Brier de un pronóstico perfecto = 0; del peor = 1; de p=0.5 = 0.25.
  ok('brier perfecto', M.brier([{ p: 1, hit: 1 }, { p: 0, hit: 0 }]) === 0);
  ok('brier p=.5', near(M.brier([{ p: 0.5, hit: 1 }, { p: 0.5, hit: 0 }]), 0.25));
  ok('brier vacío null', M.brier([]) === null);
  // Log loss de p=.5 = ln2 ≈ 0.69315; clampa p=0/1 sin Infinity.
  ok('logLoss p=.5', near(M.logLoss([{ p: 0.5, hit: 1 }]), 0.69315, 1e-4));
  ok('logLoss clamp', isFinite(M.logLoss([{ p: 1, hit: 0 }])));
}

console.log('\n§ Calibración por rangos');
{
  const list = [
    { p: 0.55, hit: 1 }, { p: 0.58, hit: 0 }, { p: 0.52, hit: 1 }, // bucket 50-60: pred ~55, obs 66.7
    { p: 0.72, hit: 1 }, { p: 0.75, hit: 1 },                       // bucket 70-80: obs 100
  ];
  const b = M.reliability(list);
  const b50 = b.find(x => x.range === '50-60'), b70 = b.find(x => x.range === '70-80');
  ok('bucket 50-60 n=3', b50 && b50.n === 3);
  ok('bucket 50-60 observed', b50 && near(b50.observed, 66.7, 0.1));
  ok('bucket 50-60 gap', b50 && near(b50.gap_pp, 66.7 - 55.0, 0.2));
  ok('bucket 70-80 observed 100', b70 && b70.observed === 100);
  ok('buckets vacíos no aparecen', !b.find(x => x.range === '0-40'));
  ok('p=1.0 entra al último bucket', M.reliability([{ p: 1, hit: 1 }]).length === 1);
}

console.log('\n§ CLV');
{
  // Tomamos 2.10, cerró 1.90 → CLV precio +10.53%; prob justa de cierre .55 → EV cierre = 2.10*.55-1 = +15.5pp
  const c = M.computeClv(2.10, { odds: 1.90, fair_prob: 0.55 });
  ok('clv_pct', near(c.clv_pct, 10.53, 0.01));
  ok('ev_close_pp', near(c.ev_close_pp, 15.5, 0.01));
  ok('sin closing → null', M.computeClv(2.1, null) === null);
  ok('solo fair_prob (sin odds de cierre)', M.computeClv(2.0, { odds: null, fair_prob: 0.5 }).ev_close_pp === 0);
  ok('closing inválido → null', M.computeClv(2.0, { odds: 0, fair_prob: 0 }) === null);
  // Guard de sanidad: cierre@4.40 con fair 72% (outlier real cazado en prod) → precio descartado, EV queda.
  const dirty = M.computeClv(1.36, { odds: 4.40, fair_prob: 0.721 });
  ok('cuota de cierre sucia descartada', dirty.clv_pct === null && near(dirty.ev_close_pp, -1.94, 0.1));
  ok('cuota de cierre sana pasa el guard', M.computeClv(2.1, { odds: 1.9, fair_prob: 0.55 }).clv_pct !== null);
}

console.log('\n§ Mapeo pick→market de cierre');
{
  const ev = { canonical_event_id: 'ev1' };
  ok('SOLID home', M.closingMarketIds({ family: 'SOLID', event: ev, selection_code: 'home' })[0].market_id === 'MATCH_WINNER_HOME');
  ok('SOLID selección inválida → null', M.closingMarketIds({ family: 'SOLID', event: ev, selection_code: 'both' }) === null);
  ok('GOALS usa market_id', M.closingMarketIds({ family: 'GOALS', event: ev, market_id: 'TOTAL_GOALS_OVER_2_5' })[0].market_id === 'TOTAL_GOALS_OVER_2_5');
  ok('PLAYER usa market_id', M.closingMarketIds({ family: 'PLAYER', event: ev, market_id: 'PLAYER_GOAL_pl_1' })[0].market_id === 'PLAYER_GOAL_pl_1');
  ok('CORNERS sin market_id → null', M.closingMarketIds({ family: 'CORNERS', event: ev }) === null);
  const combo = M.closingMarketIds({ family: 'COMBO', event: ev, legs: [{ type: '1X2', selection: 'home' }, { type: 'GOALS', side: 'over', line: 2.5 }] });
  ok('COMBO 2 patas', combo && combo.length === 2 && combo[1].market_id === 'TOTAL_GOALS_OVER_2_5');
  ok('COMBO pata desconocida → null', M.closingMarketIds({ family: 'COMBO', event: ev, legs: [{ type: 'CORNERS' }] }) === null);
  ok('sin evento → null', M.closingMarketIds({ family: 'SOLID', selection_code: 'home' }) === null);
}

console.log('\n§ clvStats y quantMetrics');
{
  const mk = (over) => ({
    status: 'SETTLED', family: 'SOLID', event: { canonical_event_id: 'e' }, ...over,
  });
  const picks = [
    mk({ result_code: 'WIN', model_prob: 0.62, market_prob: 0.58, clv: 4.0, clv_ev_pp: 6.0 }),
    mk({ result_code: 'LOSS', model_prob: 0.55, market_prob: 0.52, clv: -2.0 }),
    mk({ result_code: 'WIN', model_prob: 0.70, market_prob: 0.68, clv: 1.0 }),
    mk({ result_code: 'PUSH', model_prob: 0.60, market_prob: 0.60, clv: 9.9 }),  // PUSH: cuenta para CLV, no para Brier
    mk({ result_code: 'SUPERSEDED', model_prob: 0.9, clv: 99 }),                  // nunca cuenta
    mk({ family: 'PLAYER', result_code: 'WIN', model_prob: 0.51, market_prob: 0.5, clv: 3.0 }), // experimento
  ];
  const cs = M.clvStats(picks.filter(p => p.family === 'SOLID'));
  ok('clvStats n=4 (sin SUPERSEDED)', cs.n === 4);
  ok('clvStats positive_rate 3/4', near(cs.positive_rate, 0.75));
  ok('clvStats median', near(cs.median_pct, 2.5));
  const q = M.quantMetrics(picks, { experimentFams: ['PLAYER'] });
  ok('decididas=3 (sin PUSH/SUPERSEDED/experimento)', q.sample.decided === 3);
  ok('brier modelo calculado', q.model.brier != null && q.model.brier < 0.25);
  ok('pares modelo-vs-mercado', q.model_vs_market.n === 3);
  ok('skill definido', typeof q.model_vs_market.skill === 'number');
  ok('experimento separado', q.experiment && q.experiment.n === 1);
  ok('by_family SOLID con clv', q.by_family.SOLID && q.by_family.SOLID.clv_n === 4);
  ok('calibración presente', Array.isArray(q.calibration));
}

console.log(`\npick-metrics: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
