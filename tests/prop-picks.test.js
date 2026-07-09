// tests/prop-picks.test.js — gates de las familias PROPS (córners/tarjetas/jugador) en pick-engine/curate.
'use strict';
const { propPicks, playerPicks, curate } = require('../pick-engine/curate');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const base = { eventId: 'e1', home: 'A', away: 'B', kickoff: '2026-07-09T20:00:00Z' };
console.log('== propPicks (córners/tarjetas) ==');
const P = propPicks([
  { ...base, family: 'corners_total', marketId: 'CORNERS_OVER_8_5', side: 'over', line: 8.5, modelProb: 0.62, marketProb: 0.52, edgePp: 0.10, bestOdds: 2.0, books: 5, familyApproved: true },
  { ...base, family: 'cards_total', marketId: 'CARDS_OVER_3_5', side: 'over', line: 3.5, modelProb: 0.45, marketProb: 0.43, edgePp: 0.02, bestOdds: 2.3, books: 5, familyApproved: true },
  { ...base, family: 'corners_total', marketId: 'CORNERS_UNDER_9_5', side: 'under', line: 9.5, modelProb: 0.62, marketProb: 0.55, edgePp: 0.07, bestOdds: 1.8, books: 2, familyApproved: true },
  { ...base, family: 'cards_total', marketId: 'CARDS_OVER_4_5', side: 'over', line: 4.5, modelProb: 0.30, marketProb: 0.22, edgePp: 0.08, bestOdds: 5.2, books: 5, familyApproved: true },
], require('../pick-engine/curate').CONFIG);
t('edge 8pp + 5 casas → elegible (familia CORNERS)', P[0].eligible && P[0].family === 'CORNERS');
t('edge 2pp < 4pp → LOW_EDGE', !P[1].eligible && P[1].blockers.includes('LOW_EDGE'));
t('2 casas → FEW_BOOKS', !P[2].eligible && P[2].blockers.includes('FEW_BOOKS'));
t('cuota 5.2 fuera de rango → ODDS_OUT_OF_RANGE', !P[3].eligible && P[3].blockers.includes('ODDS_OUT_OF_RANGE'));

// REC 2: gate precio-vs-consenso (caso real FRA-MAR córners under 11.5 @1.30 vs consenso 73.3% → justo 1.36)
const P2 = propPicks([
  // por debajo de la justa (1/0.733=1.364): 1.30 < 1.364 → bloqueada aunque el modelo vea edge
  { ...base, family: 'corners_total', marketId: 'CORNERS_UNDER_11_5', side: 'under', line: 11.5, modelProb: 0.786, marketProb: 0.733, edgePp: 0.053, bestOdds: 1.30, books: 5, familyApproved: true },
  // fair o mejor (1/0.65=1.538): 1.64 >= 1.538 → pasa el gate
  { ...base, family: 'corners_total', marketId: 'CORNERS_UNDER_10_5', side: 'under', line: 10.5, modelProb: 0.72, marketProb: 0.65, edgePp: 0.07, bestOdds: 1.64, books: 5, familyApproved: true },
], require('../pick-engine/curate').CONFIG);
t('cuota por debajo de la justa del consenso → BELOW_CONSENSUS_PRICE', !P2[0].eligible && P2[0].blockers.includes('BELOW_CONSENSUS_PRICE'));
t('cuota justa-o-mejor → elegible (gate no bloquea)', P2[1].eligible && !P2[1].blockers.includes('BELOW_CONSENSUS_PRICE'));

// SIN PISO DE PROBABILIDAD: una pick de bajo acierto pero bien pagada (+EV) SÍ se publica (negocio = volumen
// de picks; una under 2.5 @2.52 a ~50% acierto es +EV y es producto válido).
const P3 = propPicks([
  { ...base, family: 'cards_total', marketId: 'CARDS_UNDER_2_5', side: 'under', line: 2.5, modelProb: 0.51, marketProb: 0.41, edgePp: 0.10, bestOdds: 2.52, books: 5, familyApproved: true },
], require('../pick-engine/curate').CONFIG);
t('pick +EV de bajo acierto pero bien pagada → ELEGIBLE (sin piso)', P3[0].eligible && !P3[0].blockers.length);

console.log('== playerPicks (jugador, anclada al mercado: probabilidad primero) ==');
const J = playerPicks([
  // La estrella titular con mercado profundo: blend .3·.59+.7·.52=.541 ≥ .5 → elegible.
  { ...base, family: 'player_goal', marketId: 'PLAYER_GOAL_pl_1', player: 'Mbappé', pid: 'pl_1', modelProb: 0.59, impliedMedian: 0.52, bestOdds: 1.91, books: 6, availabilityRisk: null, isStarter: true },
  // Caso Doué (regresión): suplente, 3 casas, modelo inflado 52% vs mercado 27% → 3 bloqueos.
  { ...base, family: 'player_sot', marketId: 'PLAYER_SOT_pl_2_1_5', player: 'Doué', pid: 'pl_2', line: 1.5, modelProb: 0.52, impliedMedian: 0.27, bestOdds: 3.8, books: 3, availabilityRisk: null, isStarter: false },
  // Observer OUT bloquea aunque todo lo demás cierre.
  { ...base, family: 'player_shots', marketId: 'PLAYER_SHOTS_pl_3_0_5', player: 'Y', pid: 'pl_3', line: 0.5, modelProb: 0.7, impliedMedian: 0.68, bestOdds: 1.5, books: 6, availabilityRisk: 'OUT', isStarter: true },
  // Coherencia: modelo 18pp DEBAJO del mercado → MODEL_FIGHTS_MARKET (no publicamos contra nuestro propio modelo).
  { ...base, family: 'player_shots', marketId: 'PLAYER_SHOTS_pl_4_1_5', player: 'Z', pid: 'pl_4', line: 1.5, modelProb: 0.42, impliedMedian: 0.60, bestOdds: 1.65, books: 6, availabilityRisk: null, isStarter: true },
  // Cuota lotería fuera de ventana (caso N. González anytime @6.5).
  { ...base, family: 'player_goal', marketId: 'PLAYER_GOAL_pl_5', player: 'W', pid: 'pl_5', modelProb: 0.25, impliedMedian: 0.16, bestOdds: 6.5, books: 6, availabilityRisk: null, isStarter: true },
], require('../pick-engine/curate').CONFIG);
t('titular + mercado profundo + prob 54% → elegible, confidence=blend', J[0].eligible && J[0].family === 'PLAYER' && Math.abs(J[0].confidence - 0.541) < 0.001);
t('caso Doué: suplente+3 casas+prob baja → NOT_PROJECTED_STARTER/FEW_BOOKS/LOW_PROBABILITY', !J[1].eligible && J[1].blockers.includes('NOT_PROJECTED_STARTER') && J[1].blockers.includes('FEW_BOOKS') && J[1].blockers.includes('LOW_PROBABILITY'));
t('observer OUT → AVAILABILITY (capa de observación bloquea)', !J[2].eligible && J[2].blockers.includes('AVAILABILITY'));
t('modelo contradice fuerte al mercado → MODEL_FIGHTS_MARKET', !J[3].eligible && J[3].blockers.includes('MODEL_FIGHTS_MARKET'));
t('cuota 6.5 fuera de ventana → ODDS_OUT_OF_RANGE', !J[4].eligible && J[4].blockers.includes('ODDS_OUT_OF_RANGE'));

console.log('== curate integra las familias nuevas ==');
const R = curate({ events: [], goalMarkets: [], propMarkets: [{ ...base, family: 'corners_total', marketId: 'CORNERS_OVER_8_5', side: 'over', line: 8.5, modelProb: 0.62, marketProb: 0.52, edgePp: 0.10, bestOdds: 2.0, books: 5, familyApproved: true }], playerMarkets: [] });
t('counts.props presente', R.counts.props === 1 && R.counts.player === 0);

console.log(`\n[prop-picks] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
