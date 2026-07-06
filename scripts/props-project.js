// scripts/props-project.js — Proyecciones de PROPS (córners/tarjetas) para partidos próximos, con el engine
// calibrado sobre data/props-history.json. Las λ y probs 1X2 vienen del modelo GP (state/knockout).
// Uso: node scripts/props-project.js '[{"home":"FRA","away":"MAR","lambdas":{"home":2.05,"away":0.65},"closeness1x2":{"home":0.636,"away":0.131},"referee":null},...]'
// Sin args: usa los QF de ejemplo definidos al momento de escribirlo.
'use strict';
const { fit, project } = require('../prop-engine/model');
const { build } = require('../prop-engine/markets');
const hist = require('../data/props-history.json');

const DEFAULT_MATCHES = [
  { home: 'FRA', away: 'MAR', lambdas: { home: 2.05, away: 0.65 }, closeness1x2: { home: 0.636, away: 0.131 } },
  { home: 'NOR', away: 'ENG', lambdas: { home: 1.02, away: 1.71 }, closeness1x2: { home: 0.228, away: 0.493 } },
];
const matches = process.argv[2] ? JSON.parse(process.argv[2]) : DEFAULT_MATCHES;

const F = fit(hist.matches);
const pct = x => (100 * x).toFixed(1) + '%';
console.log(`liga (${F.league.matches} partidos FT): córners ${F.league.totalCornersMean.toFixed(2)} · tarjetas ${F.league.totalCardsMean.toFixed(2)}\n`);
for (const m of matches) {
  const p = project(F, m);
  const mk = build(p);
  const g = id => { const x = mk.find(y => y.market_id === id); return x ? pct(x.fair_prob) : '—'; };
  console.log(`── ${m.home} vs ${m.away}${m.referee ? ' · árbitro ' + m.referee : ''} ──`);
  console.log(`  córners: ${p.corners.home.toFixed(2)} + ${p.corners.away.toFixed(2)} → total μ ${p.corners.total.toFixed(2)}`);
  console.log(`    O8.5 ${g('CORNERS_OVER_8_5')} · O9.5 ${g('CORNERS_OVER_9_5')} · U9.5 ${g('CORNERS_UNDER_9_5')} · ${m.home} O4.5 ${g('CORNERS_HOME_OVER_4_5')} · ${m.away} O4.5 ${g('CORNERS_AWAY_OVER_4_5')}`);
  console.log(`  tarjetas: ${p.cards.home.toFixed(2)} + ${p.cards.away.toFixed(2)} → total μ ${p.cards.total.toFixed(2)} (ref ×${p.cards.ref_mult.toFixed(2)} · paridad ×${p.cards.close_mult.toFixed(2)})`);
  console.log(`    O2.5 ${g('CARDS_OVER_2_5')} · O3.5 ${g('CARDS_OVER_3_5')} · U3.5 ${g('CARDS_UNDER_3_5')} · ${m.home} O1.5 ${g('CARDS_HOME_OVER_1_5')} · ${m.away} O1.5 ${g('CARDS_AWAY_OVER_1_5')}`);
  console.log(`  muestra: ${m.home} n=${p.sample.home_n} · ${m.away} n=${p.sample.away_n}\n`);
}
