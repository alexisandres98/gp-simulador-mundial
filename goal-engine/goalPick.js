// goal-engine/goalPick.js — Goles G5. Capa EDITORIAL de Picks de goles. PURO (sin DB, sin red).
// Value ≠ Pick (§6): puede haber decenas de Value detectados; un Pick GP debe superar un gate mucho más estricto.
// qualifyPick() decide si un Value (de goal_value_shadow, G3) en una familia APROBADA (G4) se promueve a Pick, y
// construye el REGISTRO completo (§6: línea, cuota publicada/mínima, prob GP, prob sin margen, edge, EV, casas,
// confianza, razón, riesgo, invalidación, settlement, CLV...). Settlement por marcador reglamentario via settlement.js.
// NO publica nada por sí mismo: el server decide persistir/exponer detrás de flags. Codes neutrales (i18n en cliente).
'use strict';
const settlement = require('./settlement');
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const round = (x, d = 4) => (x == null || !Number.isFinite(Number(x))) ? null : Number(Number(x).toFixed(d));

// Thresholds del gate editorial (más estrictos que el Value shadow). Configurables por env.
function pickThresholds() {
  return {
    minEdgePp: num(process.env.GOAL_PICK_MIN_EDGE_PP, 0.04),     // edge ajustado mínimo (4pp)
    minEv: num(process.env.GOAL_PICK_MIN_EV, 0.03),             // EV ajustado mínimo (3%)
    minBooks: num(process.env.GOAL_PICK_MIN_BOOKS, 3),          // casas con la línea
    minCompleteness: num(process.env.GOAL_PICK_MIN_COMPLETENESS, 0.5), // calidad de datos del snapshot
    minOddsBuffer: num(process.env.GOAL_PICK_MIN_ODDS_BUFFER, 0.07),   // colchón sobre la cuota justa → cuota mínima
    requireApprovedFamily: !/^(0|false|no|off)$/i.test(String(process.env.GOAL_PICK_REQUIRE_APPROVED_FAMILY || 'true')),
  };
}

// Confianza editorial a partir del edge, la calibración de la familia y la completitud de datos.
function confidenceCode(edgePp, familyBrier, completeness) {
  const wellCalibrated = familyBrier == null || familyBrier <= 0.22;
  if (edgePp >= 0.06 && wellCalibrated && completeness >= 0.7) return 'HIGH';
  if (edgePp >= 0.04 && completeness >= 0.5) return 'MEDIUM';
  return 'LOW';
}

// Etiqueta de selección NEUTRAL (code + params); el cliente la localiza. Cubre las familias de la 1ª capa + margen + combo.
function selectionCode(marketId) {
  const meta = settlement.marketMeta(marketId);
  if (!meta) return { selection_code: 'UNKNOWN', params: {} };
  if (meta.scope === 'match_total') return { selection_code: meta.side === 'over' ? 'TOTAL_OVER' : 'TOTAL_UNDER', params: { line: meta.line } };
  if (meta.scope === 'btts') return { selection_code: meta.side === 'yes' ? 'BTTS_YES' : 'BTTS_NO', params: {} };
  if (meta.scope === 'team_total') return { selection_code: (meta.team === 'home' ? 'HOME' : 'AWAY') + '_TOTAL_' + (meta.side === 'over' ? 'OVER' : 'UNDER'), params: { line: meta.line } };
  if (meta.scope === 'winning_margin') return { selection_code: marketId, params: {} };
  if (meta.scope === 'combo') return { selection_code: marketId, params: {} };
  return { selection_code: marketId, params: {} };
}

// input: {
//   valueRow: fila goal_value_shadow (gp_probability, market_consensus_probability, best_decimal_odds,
//            adjusted_edge_pp, adjusted_ev, conservative_probability, classification, market_id, market_family),
//   gate: { status: 'approved'|'shadow'|'informational', brier },   // del gate de la familia (G4)
//   snapshot: { data_completeness },                                // del goal_model_snapshot
//   event: { canonical_event_id, home_team_id, away_team_id, kickoff_at },
//   market: { books_available, best_sportsbook, lineup_status, sources },
//   th?
// }
function qualifyPick(input = {}, th = pickThresholds()) {
  const v = input.valueRow || {}, gate = input.gate || {}, snap = input.snapshot || {}, ev = input.event || {}, m = input.market || {};
  const blockers = [];
  const edge = num(v.adjusted_edge_pp, null), evv = num(v.adjusted_ev, null);
  const gp = num(v.gp_probability, null), cons = num(v.conservative_probability, gp);
  const books = num(m.books_available, 0), compl = num(snap.data_completeness, 0);
  const odds = num(v.best_decimal_odds, null);

  if (th.requireApprovedFamily && gate.status !== 'approved') blockers.push('family_not_approved');
  if (!(v.classification === 'strong' || v.classification === 'lean')) blockers.push('weak_classification');
  if (edge == null || edge < th.minEdgePp) blockers.push('edge_below_min');
  if (evv == null || evv < th.minEv) blockers.push('ev_below_min');
  if (books < th.minBooks) blockers.push('insufficient_books');
  if (compl < th.minCompleteness) blockers.push('data_incomplete');
  if (!(odds > 1)) blockers.push('no_price');

  if (blockers.length) return { qualifies: false, blockers, pick: null };

  const fairOdds = gp > 0 ? 1 / gp : null;                         // cuota justa GP
  const minimumOdds = fairOdds != null ? round(fairOdds * (1 + th.minOddsBuffer), 3) : null; // cuota mínima aceptable
  const sel = selectionCode(v.market_id);
  const conf = confidenceCode(edge, gate.brier, compl);
  return {
    qualifies: true, blockers: [],
    pick: {
      pick_kind: 'GOAL',
      event: { canonical_event_id: ev.canonical_event_id || null, home_team_id: ev.home_team_id || null, away_team_id: ev.away_team_id || null, kickoff_at: ev.kickoff_at || null },
      market_family: v.market_family || null, market_id: v.market_id, period_code: 'REGULATION',
      selection_code: sel.selection_code, selection_params: sel.params,
      line: settlement.marketMeta(v.market_id) ? (settlement.marketMeta(v.market_id).line ?? null) : null,
      published_odds: round(odds, 3), minimum_odds: minimumOdds, fair_odds: round(fairOdds, 3),
      gp_probability: round(gp, 4), conservative_probability: round(cons, 4),
      market_novig_probability: round(num(v.market_consensus_probability, null), 4),
      edge_pp: round(edge, 4), ev: round(evv, 4),
      books_available: books, best_sportsbook: m.best_sportsbook || null,
      lineup_status: m.lineup_status || 'UNKNOWN', sources: m.sources || [],
      confidence_code: conf,
      reason_code: 'MODEL_EDGE_VS_NOVIG', risk_code: 'GOAL_VARIANCE', invalidation_code: 'PRICE_BELOW_MINIMUM',
      gate_status: gate.status, gate_brier: gate.brier != null ? round(gate.brier, 4) : null,
      result_code: 'PENDING', closing_odds: null, clv: null, settlement_code: null, lifecycle_code: 'PUBLISHED',
    },
  };
}

// Liquidación del Pick por el marcador reglamentario (won/lost/push/half_*). Calcula CLV si hay cuota de cierre.
function settlePick(pick, score = {}, { closingOdds = null } = {}) {
  const res = settlement.settle(pick.market_id, score);
  const map = { won: 'WIN', lost: 'LOSS', push: 'PUSH', half_won: 'HALF_WIN', half_lost: 'HALF_LOSS', void: 'VOID', unknown: 'UNKNOWN' };
  let clv = null;
  if (closingOdds != null && pick.published_odds != null && closingOdds > 1 && pick.published_odds > 1) {
    // CLV en cuota: (cuota tomada − cuota de cierre) / cuota de cierre. Positivo = le ganamos al cierre.
    clv = round((pick.published_odds - closingOdds) / closingOdds, 4);
  }
  return { ...pick, result_code: map[res] || 'UNKNOWN', settlement_code: String(res || 'unknown').toUpperCase(), closing_odds: closingOdds != null ? round(closingOdds, 3) : null, clv, lifecycle_code: 'SETTLED' };
}

module.exports = { pickThresholds, confidenceCode, selectionCode, qualifyPick, settlePick };
