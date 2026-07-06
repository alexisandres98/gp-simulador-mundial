// tests/prop-players.test.js — props de jugador: fit por 90', shrinkage por posición, proyección y mercados.
'use strict';
const { fitPlayers, projectPlayer, projectTeam, POS_PRIOR } = require('../prop-engine/players');
const { backtestPlayers } = require('../prop-engine/calibratePlayers');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// dataset sintético: STRIKER anota mucho (xG alto), MID normal, NEWBIE con 1 cameo.
const P = (pid, name, team, pos, started, min, goals, shots, sot, xg) => ({ pid, name, team, pos, started, min, goals, shots, sot, xg, npxg: xg, xa: 0, assists: 0, fouls: 0, yc: 0, rc: 0 });
const M = (id, date, home, away, players) => ({ match_id: id, date, home, away, players });
const DATA = [];
for (let i = 0; i < 5; i++) {
  DATA.push(M('m' + i, '2026-06-1' + (i + 1), 'AAA', 'BBB', [
    P('st1', 'Striker', 'AAA', 'F', true, 90, i % 2, 4, 2, 0.8),
    P('md1', 'Mid', 'AAA', 'M', true, 90, 0, 1, 0, 0.1),
    P('df1', 'Def', 'BBB', 'D', true, 90, 0, 0, 0, 0.02),
  ].concat(i === 0 ? [P('nw1', 'Newbie', 'BBB', 'F', false, 12, 0, 0, 0, 0.05)] : [])));
}

console.log('== fitPlayers ==');
const F = fitPlayers(DATA);
t('tasa xg90 del striker > prior de delantero', F.players.st1.xg90 > POS_PRIOR.F.xg90);
t('newbie con 60 min totales cae cerca del prior F', Math.abs(F.players.nw1.xg90 - POS_PRIOR.F.xg90) < 0.2);
t('newbie marcado como no confiable', F.players.nw1.reliable === false);
t('minutos esperados de titular ~90', F.players.st1.exp_minutes_start === 90);

console.log('== projectPlayer ==');
const pr = projectPlayer(F, 'st1', {});
t('anytime_goal en (0,1)', pr.anytime_goal > 0 && pr.anytime_goal < 1);
t('striker: P(gol) razonable (>25%)', pr.anytime_goal > 0.25);
const prHi = projectPlayer(F, 'st1', { teamLambda: 2.8 });
const prLo = projectPlayer(F, 'st1', { teamLambda: 0.6 });
t('λ del equipo alta sube P(gol)', prHi.anytime_goal > pr.anytime_goal && prLo.anytime_goal < pr.anytime_goal);
t('acople clampeado ±50%', prHi.match_adj <= 1.5 && prLo.match_adj >= 0.5);
const prSub = projectPlayer(F, 'st1', { willStart: false });
t('suplente (30 min) → menos P(gol) que titular', prSub.anytime_goal < pr.anytime_goal);
t('shots O0.5 > shots O1.5 (monótono)', pr.shots_over_0_5 > pr.shots_over_1_5 && pr.shots_over_1_5 > pr.shots_over_2_5);
t('jugador inexistente → null', projectPlayer(F, 'nope', {}) === null);

console.log('== projectTeam ==');
const team = projectTeam(F, 'AAA', { teamLambda: 1.8 });
t('devuelve jugadores del equipo ordenados por P(gol)', team.length >= 2 && team[0].pid === 'st1');

console.log('== lineupAdjustment (shadow) ==');
const { lineupAdjustment, usualXi } = require('../prop-engine/lineupAdjust');
const xiA = usualXi(F, 'AAA');
t('once habitual del equipo con jugadores', xiA.length >= 2 && xiA[0].team === 'AAA');
const fullXi = lineupAdjustment(F, 'AAA', xiA.map(p => ({ pid: p.pid })));
t('once habitual completo → factor 1', Math.abs(fullXi.factor - 1) < 1e-9);
const sinStriker = lineupAdjustment(F, 'AAA', xiA.filter(p => p.pid !== 'st1').map(p => ({ pid: p.pid })).concat([{ name: 'Sub', pos: 'M' }]));
t('sin el goleador → factor < 1 y aparece en missing', sinStriker.factor < 1 && sinStriker.missing.some(m => m.pid === 'st1'));
t('clamp: factor nunca < 0.7', lineupAdjustment(F, 'AAA', [{ pos: 'G' }, { pos: 'D' }]).factor >= 0.7);
t('sin titulares → factor neutro 1', lineupAdjustment(F, 'AAA', []).factor === 1);

console.log('== backtest (dataset real) ==');
try {
  const hist = require('../data/player-props-history.json');
  const bt = backtestPlayers(hist.matches);
  t('backtest evalúa >500 jugador-partidos', bt.evaluated > 500);
  const f = bt.families;
  for (const k in f) console.log(`    ${k}: n=${f[k].n} brier=${f[k].brier} base=${f[k].brier_baseline} skill=${f[k].skill_vs_baseline} calErr=${f[k].cal_err} → ${f[k].status}`);
  t('anytime_goal con skill positivo vs prior de posición', f.anytime_goal.skill_vs_baseline > 0);
  t('todas las familias con Brier ≤ 0.26', Object.values(f).every(x => x.brier <= 0.26));
} catch (e) { t('backtest real (falta data/player-props-history.json: ' + e.message + ')', false); }

console.log(`\n[prop-players] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
