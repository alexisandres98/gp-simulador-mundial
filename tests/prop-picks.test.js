// tests/prop-picks.test.js — gates de las familias PROPS (córners/tarjetas/jugador) en pick-engine/curate.
'use strict';
const { propPicks, playerPicks, curate } = require('../pick-engine/curate');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const base = { eventId: 'e1', home: 'A', away: 'B', kickoff: '2026-07-09T20:00:00Z' };
console.log('== propPicks (córners/tarjetas) ==');
const P = propPicks([
  { ...base, family: 'corners_total', marketId: 'CORNERS_OVER_8_5', side: 'over', line: 8.5, modelProb: 0.58, marketProb: 0.50, edgePp: 0.08, bestOdds: 2.0, books: 5, familyApproved: true },
  { ...base, family: 'cards_total', marketId: 'CARDS_OVER_3_5', side: 'over', line: 3.5, modelProb: 0.45, marketProb: 0.43, edgePp: 0.02, bestOdds: 2.3, books: 5, familyApproved: true },
  { ...base, family: 'corners_total', marketId: 'CORNERS_UNDER_9_5', side: 'under', line: 9.5, modelProb: 0.62, marketProb: 0.55, edgePp: 0.07, bestOdds: 1.8, books: 2, familyApproved: true },
  { ...base, family: 'cards_total', marketId: 'CARDS_OVER_4_5', side: 'over', line: 4.5, modelProb: 0.30, marketProb: 0.22, edgePp: 0.08, bestOdds: 5.2, books: 5, familyApproved: true },
], require('../pick-engine/curate').CONFIG);
t('edge 8pp + 5 casas → elegible (familia CORNERS)', P[0].eligible && P[0].family === 'CORNERS');
t('edge 2pp < 4pp → LOW_EDGE', !P[1].eligible && P[1].blockers.includes('LOW_EDGE'));
t('2 casas → FEW_BOOKS', !P[2].eligible && P[2].blockers.includes('FEW_BOOKS'));
t('cuota 5.2 fuera de rango → ODDS_OUT_OF_RANGE', !P[3].eligible && P[3].blockers.includes('ODDS_OUT_OF_RANGE'));

console.log('== playerPicks (jugador) ==');
const J = playerPicks([
  { ...base, family: 'player_goal', marketId: 'PLAYER_GOAL_pl_1', player: 'Mbappé', pid: 'pl_1', modelProb: 0.59, impliedMedian: 0.52, bestOdds: 1.91, books: 5, availabilityRisk: null },
  { ...base, family: 'player_goal', marketId: 'PLAYER_GOAL_pl_2', player: 'X', pid: 'pl_2', modelProb: 0.30, impliedMedian: 0.30, bestOdds: 3.2, books: 5, availabilityRisk: null },
  { ...base, family: 'player_shots', marketId: 'PLAYER_SHOTS_pl_3_2_5', player: 'Y', pid: 'pl_3', line: 2.5, modelProb: 0.55, impliedMedian: 0.4, bestOdds: 2.4, books: 4, availabilityRisk: 'OUT' },
], require('../pick-engine/curate').CONFIG);
t('Mbappé 59% vs BE 52.4% (edge 6.7pp) → elegible', J[0].eligible && J[0].family === 'PLAYER');
t('modelo 30% vs BE 31% → LOW_EDGE', !J[1].eligible && J[1].blockers.includes('LOW_EDGE'));
t('observer OUT → AVAILABILITY (capa de observación bloquea)', !J[2].eligible && J[2].blockers.includes('AVAILABILITY'));

console.log('== curate integra las familias nuevas ==');
const R = curate({ events: [], goalMarkets: [], propMarkets: [{ ...base, family: 'corners_total', marketId: 'CORNERS_OVER_8_5', side: 'over', line: 8.5, modelProb: 0.58, marketProb: 0.50, edgePp: 0.08, bestOdds: 2.0, books: 5, familyApproved: true }], playerMarkets: [] });
t('counts.props presente', R.counts.props === 1 && R.counts.player === 0);

console.log(`\n[prop-picks] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
