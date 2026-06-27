// value-engine/pickConversion.js — Fase K.1. Conversión MANUAL, AUDITADA y ATÓMICA de un Candidate READY a
// Pick GP interna + Signal oficial inmutable en el Registry. Solo superadmin (gating en el endpoint). Revalida
// readiness en el instante de aprobación; congela el snapshot; crea Signal y Pick en UNA transacción con lock;
// rollback total ante cualquier fallo; idempotente. NO publica, NO alerta, NO ejecuta apuestas. NO auto-convierte.
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const candidateFactory = require('./candidateFactory');
const publisher = require('../signal-registry/publisher');
const i18n = require('../i18n/dictionary');

function err(code, details) { const e = new Error(code); e.code = code; if (details) e.details = details; return e; }

// §2 label localizado vía i18n (default ES correcto: "Croacia gana", no "Gana Croatia"). EN: "Croatia to win".
function displayLabel(outcome, homeName, awayName, locale = i18n.DEFAULT_LOCALE) {
  const homeId = i18n.resolveTeamId(homeName), awayId = i18n.resolveTeamId(awayName);
  const model = i18n.selectionDisplayModel(String(outcome || '').toUpperCase(), homeId, awayId);
  return i18n.renderSelection(model, locale, outcome === 'away' ? awayName : homeName);
}

// vector GP oficial {home,draw,away} reconstruido desde las evaluaciones internal_operational más recientes por
// selección (no se recalcula el modelo; se toma la probabilidad CONGELADA en las evaluaciones).
async function gpVector(canonicalEventId, client) {
  const rows = (await client.query(
    `SELECT DISTINCT ON (selection) selection, gp_probability FROM value_evaluations
       WHERE canonical_event_id=$1 AND evaluation_mode='internal_operational' AND selection IN ('home','draw','away')
       ORDER BY selection, created_at DESC`, [canonicalEventId])).rows;
  const v = {}; for (const r of rows) v[r.selection] = Number(r.gp_probability);
  return (['home', 'draw', 'away'].every(o => Number.isFinite(v[o]))) ? v : null;
}

// revalidación en el instante de aprobación (§3). Devuelve { ok, blockers }.
async function revalidate(cand, client, now) {
  const blockers = [];
  if (cand.candidate_lifecycle !== 'READY_FOR_REVIEW') blockers.push('NOT_READY:' + cand.candidate_lifecycle);
  if (cand.classification !== 'strong') blockers.push('NOT_STRONG');
  if (cand.evaluation_mode !== 'internal_operational') blockers.push('NOT_OPERATIONAL');
  // V1 oficial / V2 peso 0
  if ((cand.model_version || 'V1').toString().startsWith('V2')) blockers.push('NOT_V1');
  // STRONG vigente para esta selección (no sustituir por una más favorable; se exige que SIGA STRONG elegible)
  const ev = (await client.query(
    `SELECT classification, pick_candidate_eligible FROM value_evaluations
       WHERE canonical_event_id=$1 AND selection=$2 AND evaluation_mode='internal_operational'
       ORDER BY created_at DESC LIMIT 1`, [cand.canonical_event_id, cand.outcome])).rows[0];
  if (!ev || ev.classification !== 'strong' || ev.pick_candidate_eligible !== true) blockers.push('EVAL_NO_LONGER_STRONG_ELIGIBLE');
  // readiness gate completo (precio fresh/≥min, evento no iniciado, ESPN mapping, Registry/Metrics health, deep link)
  const rd = await candidateFactory.readiness(cand, { now });
  if (!rd.ready) blockers.push(...rd.blockers);
  if (['BLOCKED', 'REJECTED', 'EXPIRED', 'CONVERTED_TO_PICK', 'PRICE_BELOW_MINIMUM', 'STALE', 'SUSPENDED'].includes(cand.candidate_lifecycle)) blockers.push('CANDIDATE_STATE:' + cand.candidate_lifecycle);
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)] };
}

// convertToPick(candidateId, opts) — atómico. opts: { adminId, reason, reviewNote, idempotencyKey, now, risks, superadmin }
async function convertToPick(candidateId, opts = {}) {
  if (!opts.superadmin) throw err('superadmin_required');
  if (!opts.reason || String(opts.reason).trim().length < 4) throw err('reason_required');
  const idem = opts.idempotencyKey || ('convert:' + candidateId);
  const now = opts.now || Date.now();

  // PRE-VALIDACIÓN fuera de la transacción → el error con blockers llega intacto (withTransaction descarta .details).
  const candPre = (await db.query(`SELECT * FROM candidate_factory WHERE candidate_id=$1`, [candidateId])).rows[0];
  if (!candPre) throw err('candidate_not_found');
  const dupPre = (await db.query(`SELECT pick_id, signal_id FROM internal_picks WHERE idempotency_key=$1 OR candidate_id=$2`, [idem, candidateId])).rows[0];
  if (dupPre) return { idempotent: true, pick: dupPre, signal_id: dupPre.signal_id };
  const rvPre = await revalidate(candPre, db, now);
  if (!rvPre.ok) throw err('revalidation_failed', rvPre.blockers);

  return db.withTransaction(async (c) => {
    // idempotencia (doble clic/concurrencia → una sola Pick): por idempotency_key o por candidate_id.
    const dup = (await c.query(`SELECT * FROM internal_picks WHERE idempotency_key=$1 OR candidate_id=$2`, [idem, candidateId])).rows[0];
    if (dup) return { idempotent: true, pick: dup, signal_id: dup.signal_id };

    // lock del Candidate (row-level)
    const cand = (await c.query(`SELECT * FROM candidate_factory WHERE candidate_id=$1 FOR UPDATE`, [candidateId])).rows[0];
    if (!cand) throw err('candidate_not_found');

    // revalidación en el instante (§3). Si falla cualquier gate → NO convertir, blocker explícito.
    const rv = await revalidate(cand, c, now);
    if (!rv.ok) throw err('revalidation_failed', rv.blockers);

    // vector GP congelado
    const probs = await gpVector(cand.canonical_event_id, c);
    if (!probs) throw err('gp_vector_incomplete');

    // nombres del proveedor + team IDs estables + modelo de display NEUTRAL (§2-4). El idioma NO se congela.
    const ce = (await c.query(`SELECT home_participant, away_participant FROM canonical_events WHERE id=$1`, [cand.canonical_event_id])).rows[0] || {};
    const homeName = ce.home_participant || 'Home', awayName = ce.away_participant || 'Away';
    const homeId = i18n.resolveTeamId(homeName), awayId = i18n.resolveTeamId(awayName);
    const outcomeCode = String(cand.outcome || 'home').toUpperCase();           // HOME|DRAW|AWAY (canónico)
    const model = i18n.selectionDisplayModel(outcomeCode, homeId, awayId);       // {display_key, display_args, outcome_code}
    const approvalLocale = i18n.LOCALES.includes(opts.locale) ? opts.locale : i18n.DEFAULT_LOCALE;
    const fallbackTeam = outcomeCode === 'AWAY' ? awayName : homeName;
    const displayAtApproval = i18n.renderSelection(model, approvalLocale, fallbackTeam); // lo que vio el admin (auditoría)
    const eventDisplay = `${homeName} vs ${awayName}`;
    const espn = (await c.query(`SELECT fixture_id, espn_id FROM signal_event_fixture_mappings WHERE canonical_event_id=$1 AND review_status='approved'`, [cand.canonical_event_id])).rows[0];

    // crear la Signal oficial post-epoch en el MISMO cliente/transacción (atómico). PAYLOAD NEUTRAL: codes +
    // team IDs + display_key (NO frase ES/EN, NO locale) → el content_hash es independiente del idioma.
    const reg = await publisher.register({
      signal_type: 'model_prediction_v1', canonical_event_id: cand.canonical_event_id, canonical_market_id: cand.canonical_market_id,
      canonical_outcome_id: null, direction: cand.outcome, event_start_at: cand.kickoff_at, model_version: cand.model_version || 'gp-core-1.4.0',
      input_cutoff_at: new Date(now).toISOString(),
      signal_payload: {
        market_type: '1x2', period: 'regulation_90m', predicted_outcome: cand.outcome, probabilities: probs,
        published_odds: String(cand.current_best_odds), published_sportsbook: cand.best_sportsbook,
        outcome_code: outcomeCode, market_code: '1X2', period_code: 'REGULATION',
        home_team_id: homeId, away_team_id: awayId,
        selection_display_key: model.display_key, selection_display_args: model.display_args, i18n_version: i18n.I18N_VERSION,
      },
      public_payload: {
        home_team_id: homeId, away_team_id: awayId, outcome_code: outcomeCode, market_code: '1X2', period_code: 'REGULATION',
        selection_display_key: model.display_key, selection_display_args: model.display_args, i18n_version: i18n.I18N_VERSION,
      },
    }, { client: c, actorId: opts.adminId, sourceRefs: [{ source_type: 'model_output', source_id: cand.value_evaluation_id || null, source_version: cand.model_version || 'gp-core-1.4.0' }], now });
    if (!reg.signal) throw err('signal_creation_failed');
    const signal = reg.signal;

    // crear la Pick interna con el snapshot CONGELADO (§5)
    const pick = (await c.query(
      `INSERT INTO internal_picks (candidate_id, signal_id, value_evaluation_id, canonical_event_id, selection_outcome, selection_display, event_display,
         kickoff_at, gp_probability, gp_probability_vector, consensus_probability, ensemble_probability, conservative_probability, published_odds,
         published_break_even_probability, minimum_odds, sportsbook, deep_link, adjusted_edge_pp, adjusted_ev, uncertainty_score, quality_score,
         verified_independence_group_count, edge_source_code, model_version, espn_fixture_id, approving_admin, human_review_reason, risks_displayed, idempotency_key,
         selection_display_key, selection_display_args, selection_i18n_version, approval_locale, selection_display_at_approval,
         canonical_home_team_id, canonical_away_team_id, outcome_code, market_code, period_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
         $31,$32,$33,$34,$35,$36,$37,$38,'1X2','REGULATION') RETURNING *`,
      [candidateId, signal.id, cand.value_evaluation_id, cand.canonical_event_id, cand.outcome, displayAtApproval, eventDisplay,
       cand.kickoff_at, cand.gp_probability, JSON.stringify(probs), cand.consensus_probability, cand.consensus_probability, cand.conservative_probability, cand.current_best_odds,
       cand.current_best_odds ? +(1 / Number(cand.current_best_odds)).toFixed(8) : null, cand.minimum_odds, cand.best_sportsbook, cand.deep_link, cand.adjusted_edge_pp, cand.adjusted_ev, cand.uncertainty_score, cand.quality_score,
       cand.verified_independence_group_count, cand.edge_source_code, cand.model_version, espn ? (espn.espn_id || espn.fixture_id) : null, opts.adminId, String(opts.reason).slice(0, 1000), JSON.stringify(opts.risks || []), idem,
       model.display_key, JSON.stringify(model.display_args), i18n.I18N_VERSION, approvalLocale, displayAtApproval, homeId, awayId, outcomeCode])).rows[0];

    // Candidate → CONVERTED_TO_PICK (preserva lineage; impide nueva conversión)
    await c.query(
      `UPDATE candidate_factory SET candidate_lifecycle='CONVERTED_TO_PICK',
         transition_history = transition_history || $2::jsonb WHERE candidate_id=$1`,
      [candidateId, JSON.stringify([{ to: 'CONVERTED_TO_PICK', by: opts.adminId, pick_id: pick.pick_id, signal_id: signal.id, at: new Date(now).toISOString() }])]);

    return { pick, signal, candidate_id: candidateId };
  });
}

// listPicks — lista las Picks internas aprobadas (append-only) para el panel admin. Devuelve el modelo i18n
// NEUTRAL (display_key+args+codes+team_ids) para que el frontend renderice ES/EN en vivo, además del texto que
// vio el admin al aprobar (auditoría). NO es público (el endpoint que la usa exige admin).
async function listPicks({ limit = 100 } = {}) {
  const rows = (await db.query(
    `SELECT pick_id, candidate_id, signal_id, canonical_event_id, selection_outcome, selection_display, event_display,
       kickoff_at, gp_probability, consensus_probability, published_odds, minimum_odds, sportsbook, deep_link,
       adjusted_edge_pp, adjusted_ev, quality_score, verified_independence_group_count, model_version, espn_fixture_id,
       approving_admin, human_review_reason, approval_timestamp, created_at,
       selection_display_key, selection_display_args, outcome_code, market_code, period_code,
       canonical_home_team_id, canonical_away_team_id, approval_locale, selection_display_at_approval
     FROM internal_picks ORDER BY created_at DESC LIMIT $1`, [limit])).rows;
  return {
    enabled: true,
    count: rows.length,
    items: rows.map(r => ({
      ...r,
      selection_display_model: { display_key: r.selection_display_key, display_args: r.selection_display_args, outcome_code: r.outcome_code },
    })),
  };
}

module.exports = { convertToPick, displayLabel, revalidate, gpVector, listPicks };
