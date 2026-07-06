// tests/prop-engine.test.js — motor de props (córners/tarjetas): fit, shrinkage, árbitro, NB, mercados, settle.
'use strict';
const { fit, project, overProbNB, fitDispersion, DEFAULTS } = require('../prop-engine/model');
const { build, settle } = require('../prop-engine/markets');
const { backtest } = require('../prop-engine/calibrate');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// dataset sintético: liga de 3 equipos, AAA cornerea mucho, CCC comete muchas faltas/tarjetas.
const mk = (h, a, hc, ac, hy, ay, ref) => ({
  et: false, referee: ref || 'R1',
  home: { code: h, corners: hc, yellows: hy, reds: 0, fouls: 10 },
  away: { code: a, corners: ac, yellows: ay, reds: 0, fouls: 10 },
});
const DATA = [
  mk('AAA', 'BBB', 8, 3, 1, 2), mk('BBB', 'AAA', 2, 9, 2, 1), mk('AAA', 'CCC', 7, 4, 1, 4),
  mk('CCC', 'AAA', 3, 8, 5, 1), mk('BBB', 'CCC', 4, 4, 2, 4, 'R2'), mk('CCC', 'BBB', 5, 5, 4, 2, 'R2'),
];

console.log('== fit ==');
const F = fit(DATA);
t('media de liga por equipo > 0', F.league.teamCornersMean > 0 && F.league.teamCardsMean > 0);
t('AAA cornersForRatio > 1 (cornerea más que la liga)', F.teams.AAA.cornersForRatio > 1);
t('BBB cornersForRatio < 1', F.teams.BBB.cornersForRatio < 1);
t('CCC cardsForRatio > 1 (más tarjetas que la liga)', F.teams.CCC.cardsForRatio > 1);
t('shrinkage: con 4 partidos el ratio no es extremo (<1.6)', F.teams.AAA.cornersForRatio < 1.6);
t('árbitro con clamp ±20%', Object.values(F.refs).every(r => r.mult >= 0.8 && r.mult <= 1.2));

console.log('== project ==');
const P = project(F, { home: 'AAA', away: 'CCC' });
t('proyección córners home (AAA) > liga', P.corners.home > F.league.teamCornersMean);
t('total anclado a media de liga con DAMP=0 (correlación negativa home/away)', Math.abs(P.corners.total - F.league.totalCornersMean) < 1e-9);
t('total con señal si TOTALS_DAMP>0', (() => { const F2 = fit(DATA, { TOTALS_DAMP: 0.5 }); const P2 = project(F2, { home: 'AAA', away: 'CCC' }); return P2.corners.total > F2.league.totalCornersMean; })());
const Pref = project(F, { home: 'AAA', away: 'CCC', referee: 'R2' });
t('árbitro estricto sube tarjetas', Pref.cards.total >= P.cards.total);
const Pgs = project(F, { home: 'AAA', away: 'CCC', lambdas: { home: 2.4, away: 0.7 } });
t('game state: λ alta sube córners del que ataca', Pgs.corners.home > P.corners.home);
t('game state clamp ±25%', Pgs.corners.home / P.corners.home <= 1.25 + 1e-9);
const Pclose = project(F, { home: 'AAA', away: 'CCC', closeness1x2: { home: 0.34, draw: 0.32, away: 0.34 } });
const Pblow = project(F, { home: 'AAA', away: 'CCC', closeness1x2: { home: 0.75, draw: 0.15, away: 0.10 } });
t('partido parejo → más tarjetas que paliza', Pclose.cards.total > Pblow.cards.total);
t('equipo desconocido cae al prior de liga', project(F, { home: 'ZZZ', away: 'AAA' }).corners.home > 0);

console.log('== NB / mercados ==');
t('overProbNB monotónica en la línea', overProbNB(9, 20, 8.5) > overProbNB(9, 20, 10.5));
t('overProbNB(μ alta) → cerca de 1 en línea baja', overProbNB(12, 20, 3.5) > 0.98);
t('fitDispersion: var>μ → r finito', fitDispersion([5, 9, 14, 3, 11, 7]) < 400);
t('fitDispersion: var≤μ → r máximo (Poisson-ish)', fitDispersion([8, 8, 8, 8]) === 400);
const MK = build(P);
t('mercados: 4 familias presentes', ['corners_total', 'corners_team', 'cards_total', 'cards_team'].every(f => MK.some(m => m.family === f)));
t('over+under de la misma línea suman 1', (() => { const o = MK.find(m => m.market_id === 'CORNERS_OVER_9_5'), u = MK.find(m => m.market_id === 'CORNERS_UNDER_9_5'); return Math.abs(o.fair_prob + u.fair_prob - 1) < 1e-6; })());
t('probs en (0,1)', MK.every(m => m.fair_prob > 0 && m.fair_prob < 1));

console.log('== settle ==');
const act = { corners_home: 6, corners_away: 4, cards_home: 1, cards_away: 3 };
t('corners_total over 9.5 → won (10 > 9.5)', settle({ family: 'corners_total', side: 'over', line: 9.5 }, act) === 'won');
t('corners_total under 10.5 → won', settle({ family: 'corners_total', side: 'under', line: 10.5 }, act) === 'won');
t('cards_team away over 2.5 → won', settle({ family: 'cards_team', team_scope: 'away', side: 'over', line: 2.5 }, act) === 'won');
t('corners_team home under 4.5 → lost (6)', settle({ family: 'corners_team', team_scope: 'home', side: 'under', line: 4.5 }, act) === 'lost');
t('dato faltante → null', settle({ family: 'cards_total', side: 'over', line: 2.5 }, { corners_home: 1 }) === null);

console.log('== backtest (dataset real) ==');
let BT = null;
try {
  const hist = require('../data/props-history.json');
  BT = backtest(hist.matches);
  t('backtest corre sobre el dataset real', BT.matches_evaluated > 50);
  t('familias evaluadas con muestra', Object.values(BT.families).every(f => f.n >= 40));
  t('Brier del modelo ≤ 0.26 en todas las familias', Object.values(BT.families).every(f => f.brier <= 0.26));
} catch (e) { t('backtest sobre dataset real (falta data/props-history.json: ' + e.message + ')', false); }

console.log(`\n[prop-engine] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
