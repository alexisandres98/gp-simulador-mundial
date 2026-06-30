// tests/goal-pick.test.js — Goles G5. Capa editorial de Picks. PURO. Verifica el GATE (Value→Pick solo si familia
// aprobada + edge/EV/casas/datos), la construcción del registro (§6: cuota mínima, prob justa, confianza, codes) y
// el settlement + CLV. No toca pipeline.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const gp = require(R + '/goal-engine/goalPick');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const baseInput = () => ({
  valueRow: { market_id: 'WINNING_MARGIN_EITHER_BY_2_PLUS', market_family: 'winning_margin', gp_probability: 0.486, conservative_probability: 0.456, market_consensus_probability: 0.43, best_decimal_odds: 2.35, adjusted_edge_pp: 0.061, adjusted_ev: 0.07, classification: 'strong' },
  gate: { status: 'approved', brier: 0.17 },
  snapshot: { data_completeness: 0.8 },
  event: { canonical_event_id: 'ev1', home_team_id: 'ARG', away_team_id: 'DEU', kickoff_at: '2026-07-10T18:00:00Z' },
  market: { books_available: 6, best_sportsbook: 'pinnacle', lineup_status: 'PROBABLE', sources: ['a', 'b'] },
});

(async () => {
  console.log('\n§G5 GATE EDITORIAL (Value → Pick)');
  const good = gp.qualifyPick(baseInput());
  ok('Value fuerte en familia aprobada → Pick', good.qualifies && good.pick);
  ok('Pick registra todos los campos §6', good.pick && ['market_id', 'line', 'published_odds', 'minimum_odds', 'fair_odds', 'gp_probability', 'market_novig_probability', 'edge_pp', 'ev', 'books_available', 'confidence_code', 'reason_code', 'risk_code', 'invalidation_code', 'result_code', 'clv', 'settlement_code', 'lifecycle_code'].every(k => k in good.pick));
  ok('cuota mínima > cuota justa (colchón)', good.pick.minimum_odds > good.pick.fair_odds);
  ok('cuota mínima < mejor cuota (hay margen para tomarla)', good.pick.minimum_odds < good.pick.published_odds);
  ok('confianza HIGH (edge 6.1pp + bien calibrada + datos altos)', good.pick.confidence_code === 'HIGH');
  ok('result PENDING / lifecycle PUBLISHED al crear', good.pick.result_code === 'PENDING' && good.pick.lifecycle_code === 'PUBLISHED');
  ok('selección neutral (code), no texto localizado', good.pick.selection_code === 'WINNING_MARGIN_EITHER_BY_2_PLUS');

  console.log('\n§G5 RECHAZOS DEL GATE');
  const shadowFam = gp.qualifyPick({ ...baseInput(), gate: { status: 'shadow', brier: 0.26 } });
  ok('familia NO aprobada (BTTS shadow) → rechazado', !shadowFam.qualifies && shadowFam.blockers.includes('family_not_approved'));
  const weak = gp.qualifyPick({ ...baseInput(), valueRow: { ...baseInput().valueRow, classification: 'watch' } });
  ok('clasificación débil (watch) → rechazado', !weak.qualifies && weak.blockers.includes('weak_classification'));
  const lowEdge = gp.qualifyPick({ ...baseInput(), valueRow: { ...baseInput().valueRow, adjusted_edge_pp: 0.01 } });
  ok('edge bajo → rechazado', !lowEdge.qualifies && lowEdge.blockers.includes('edge_below_min'));
  const fewBooks = gp.qualifyPick({ ...baseInput(), market: { ...baseInput().market, books_available: 1 } });
  ok('pocas casas → rechazado', !fewBooks.qualifies && fewBooks.blockers.includes('insufficient_books'));
  const lowData = gp.qualifyPick({ ...baseInput(), snapshot: { data_completeness: 0.2 } });
  ok('datos incompletos → rechazado', !lowData.qualifies && lowData.blockers.includes('data_incomplete'));

  console.log('\n§G5 SELECTION CODES por familia');
  ok('total over → TOTAL_OVER', gp.selectionCode('TOTAL_GOALS_OVER_2_5').selection_code === 'TOTAL_OVER');
  ok('team total → HOME_TOTAL_OVER', gp.selectionCode('HOME_TEAM_TOTAL_OVER_1_5').selection_code === 'HOME_TOTAL_OVER');
  ok('BTTS → BTTS_YES', gp.selectionCode('BTTS_YES').selection_code === 'BTTS_YES');

  console.log('\n§G5 SETTLEMENT + CLV');
  const pick = good.pick;
  // EITHER_BY_2_PLUS con 3-1 (margen 2) → WIN
  const won = gp.settlePick(pick, { homeGoals: 3, awayGoals: 1 }, { closingOdds: 2.10 });
  ok('settle 3-1 (margen 2) → WIN', won.result_code === 'WIN' && won.settlement_code === 'WON');
  ok('lifecycle SETTLED tras liquidar', won.lifecycle_code === 'SETTLED');
  ok('CLV positivo (tomamos 2.35 vs cierre 2.10)', won.clv > 0);
  const lost = gp.settlePick(pick, { homeGoals: 1, awayGoals: 1 });
  ok('settle 1-1 (empate) → LOSS', lost.result_code === 'LOSS');

  console.log(`\n[goal-pick] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
