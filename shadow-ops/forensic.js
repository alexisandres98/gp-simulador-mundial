// shadow-ops/forensic.js — Fase N.1 (N.6). Auditoría forense de un STRONG de goles (p.ej. Croacia/Argelia O2.5).
// READ-ONLY. Reúne identidad de mercado, books+no-vig, modelo (lambdas/sensibilidad), y CONSISTENCIA (1X2 derivado
// del Goal Engine vs V2 1X2 shadow vs mercado). Si hay incoherencia material, recomienda degradar el STRONG shadow.
'use strict';
const db = require('../database/client');
const goalEngine = require('../goal-engine/distribution');
const nb = require('../goal-engine/negativeBinomial');

async function auditOver25(canonicalEventId) {
  const ev = (await db.query(`SELECT id, home_participant h, away_participant a, scheduled_start k FROM canonical_events WHERE id=$1`, [canonicalEventId])).rows[0];
  if (!ev) return { error: 'event_not_found' };
  const gs = (await db.query(`SELECT * FROM goal_model_snapshots WHERE canonical_event_id=$1 ORDER BY created_at DESC LIMIT 1`, [canonicalEventId])).rows[0];
  const v2 = (await db.query(`SELECT base_probability_vector, final_probability_vector FROM v2_probability_snapshots WHERE canonical_event_id=$1 ORDER BY created_at DESC LIMIT 1`, [canonicalEventId])).rows[0];
  const gvr = (await db.query(`SELECT * FROM goal_value_shadow WHERE canonical_event_id=$1 AND market_id='TOTAL_GOALS_OVER_2_5' ORDER BY created_at DESC LIMIT 1`, [canonicalEventId])).rows[0];
  const quotes = (await db.query(`SELECT sportsbook_code, side, odds_decimal, quote_status, provider_update FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family='match_total' AND line=2.5`, [canonicalEventId])).rows;
  // no-vig por book
  const byBook = {}; for (const q of quotes) { byBook[q.sportsbook_code] = byBook[q.sportsbook_code] || {}; byBook[q.sportsbook_code][q.side] = Number(q.odds_decimal); }
  const perBook = Object.entries(byBook).filter(([, s]) => s.over && s.under).map(([b, s]) => { const ia = 1 / s.over, ib = 1 / s.under, t = ia + ib; return { book: b, over: s.over, under: s.under, novig_over: +(ia / t).toFixed(4), overround: +(t - 1).toFixed(4) }; });
  // modelo
  const lh = gs ? Number(gs.final_lambda_home) : null, la = gs ? Number(gs.final_lambda_away) : null;
  const poisson = lh != null ? goalEngine.goalModelOutput(lh, la) : null;
  const nbMatrix = lh != null ? nb.buildMatrixNB(lh, la, { r: 8 }) : null;
  const nbOver = nbMatrix ? +nb.overProb(nbMatrix.matrix, 2.5).toFixed(4) : null;
  const poiOver = poisson ? poisson.over_under.find(x => x.line === 2.5).over : null;
  const disagreement = (poisson && nbMatrix) ? nb.familyDisagreement(poisson._matrix, nbMatrix.matrix) : null;
  // consistencia: 1X2 derivado del goal engine (calibrado) vs V2 1X2 shadow
  const goalDerived1x2 = poisson ? poisson.one_x2_calibrated : null;
  const v2vec = v2 ? v2.final_probability_vector : null;
  let consistency = 'n/a';
  if (goalDerived1x2 && v2vec) {
    const d = (Math.abs(goalDerived1x2.home - v2vec.home) + Math.abs(goalDerived1x2.draw - v2vec.draw) + Math.abs(goalDerived1x2.away - v2vec.away)) / 3;
    consistency = d < 0.03 ? 'coherente' : (d < 0.06 ? 'leve_divergencia' : 'INCOHERENTE');
  }
  const recommend = (gvr && gvr.classification === 'strong' && (consistency === 'INCOHERENTE' || (disagreement != null && disagreement > 0.05)))
    ? 'DEGRADAR_A_LEAN (incoherencia/desacuerdo de familias eleva uncertainty)' : 'mantener clasificación shadow';
  return {
    market_identity: { canonical_event_id: ev.id, fixture: `${ev.h} vs ${ev.a}`, kickoff: ev.k, market_family: 'match_total', line: 2.5, side: 'OVER', period: 'REGULATION', extra_time: false, asian: false },
    market: { books: perBook, book_count: perBook.length, consensus_no_vig_over: gvr ? Number(gvr.market_consensus_probability) : null, best_over_odds: gvr ? Number(gvr.best_decimal_odds) : null, break_even: gvr ? Number(gvr.break_even_probability) : null },
    model: { base_lambda_home: gs ? Number(gs.base_lambda_home) : null, base_lambda_away: gs ? Number(gs.base_lambda_away) : null, final_lambda_home: lh, final_lambda_away: la, final_lambda_total: lh != null ? +(lh + la).toFixed(3) : null,
      poisson_dc_over25: poiOver, nb_over25: nbOver, model_family_disagreement: disagreement,
      prob_over25: gvr ? Number(gvr.gp_probability) : poiOver, sensitivity: gvr ? gvr.line_probability_sensitivity : null, uncertainty: gvr ? Number(gvr.uncertainty) : null },
    consistency: { goal_derived_1x2: goalDerived1x2, v2_shadow_1x2: v2vec, verdict: consistency },
    classification_shadow: gvr ? gvr.classification : null, edge_pp: gvr ? Number(gvr.adjusted_edge_pp) : null,
    recommendation: recommend,
  };
}
module.exports = { auditOver25 };
