// value-engine/picks.js — Sprint 7 §30-37. Lifecycle de Picks GP. STRONG → candidate → review → publish.
// INVARIANTES: nunca auto-publica; nunca crea pick desde PASS/WATCH/LEAN; "no registry signal → no Pick GP".
'use strict';
const crypto = require('crypto');
const db = require('../database/client');
const cfg = require('./config');
const repo = require('./repositories');
const classification = require('./classification');

function err(code) { const e = new Error(code); e.code = code; return e; }
function newPublicId() { return 'pk_' + crypto.randomBytes(8).toString('hex'); }

// createCandidate(evaluationRow, ctx) → candidata SOLO si la evaluación es STRONG y sin blockers. PASS/WATCH/LEAN → null.
async function createCandidate(ev, ctx = {}) {
  if (ev.classification !== 'strong') return { created: false, reason: 'not_strong' };
  const blockers = Array.isArray(ev.strong_blockers) ? ev.strong_blockers : JSON.parse(ev.strong_blockers || '[]');
  if (blockers.length) return { created: false, reason: 'strong_blockers', blockers };
  const cand = await repo.candidates.create({
    value_evaluation_id: ev.id, value_opportunity_id: ctx.opportunityId || null,
    canonical_event_id: ev.canonical_event_id, canonical_market_id: ev.canonical_market_id, canonical_outcome_id: ev.canonical_outcome_id,
    candidate_status: 'pending_review', selection: ev.selection, market_label: ctx.marketLabel || 'Ganador del partido (1X2)',
    observed_odds: ev.best_decimal_odds, minimum_acceptable_odds: ev.minimum_acceptable_odds,
    observed_price: ev.best_prediction_market_price, maximum_acceptable_price: ev.maximum_acceptable_price,
    sportsbook_code: ctx.sportsbookCode || null, deep_link: ctx.deepLink || null,
    signal_quality: ev.quality_score, uncertainty_score: ev.uncertainty_score, context_status: ctx.contextStatus || 'unknown',
    candidate_reason: ['strong_value'], blocking_reasons: [],
  });
  return { created: true, candidate: cand };
}

async function approve(id, { actorId } = {}) {
  if (!cfg.flags.picksManualPublication) throw err('picks_manual_publication_disabled');
  const c = await repo.candidates.byId(id); if (!c) throw err('candidate_not_found');
  await repo.candidates.setStatus(id, 'approved'); return { ok: true };
}
async function reject(id) { const c = await repo.candidates.byId(id); if (!c) throw err('candidate_not_found'); await repo.candidates.setStatus(id, 'rejected'); return { ok: true }; }

// publish(candidateId, opts) → pick_publication. Revalida STRONG + precio ≥ mínimo, crea SEÑAL inmutable + pick atómicos.
async function publish(id, { actorId, currentEvaluation, eventLabel, marketLabel, period, rationale } = {}) {
  if (!cfg.flags.picksManualPublication) throw err('picks_manual_publication_disabled');
  if (cfg.flags.picksAutoPublicationBlocked !== true) throw err('auto_publication_invariant_violated'); // nunca debe pasar
  const cand = await repo.candidates.byId(id); if (!cand) throw err('candidate_not_found');
  const ev = currentEvaluation || await repo.evaluations.byId(cand.value_evaluation_id);
  if (!ev) throw err('evaluation_missing');

  // revalidación: debe seguir STRONG, precio ≥ mínimo, evento no iniciado
  const blockers = Array.isArray(ev.strong_blockers) ? ev.strong_blockers : JSON.parse(ev.strong_blockers || '[]');
  if (ev.classification !== 'strong' || blockers.length) throw err('revalidation_failed_not_strong');
  const priceOk = ev.best_decimal_odds != null
    ? Number(ev.best_decimal_odds) >= Number(ev.minimum_acceptable_odds)
    : (ev.best_prediction_market_price != null && Number(ev.best_prediction_market_price) <= Number(ev.maximum_acceptable_price));
  if (!priceOk) throw err('price_below_minimum');

  const registry = require('../signal-registry');
  if (!registry.cfg.flags.enabled) throw err('registry_disabled_no_pick'); // no registry signal → no Pick GP

  const publicId = newPublicId();
  const nowIso = new Date().toISOString();
  const payload = buildPayload(cand, ev, { eventLabel, marketLabel, period, rationale, publicId });

  return db.withTransaction(async (client) => {
    // 1) señal inmutable en el registro (primero; si falla → rollback → no pick)
    const sig = await registry.publisher.register({
      signal_type: 'pick_gp_strong_value', visibility: 'public',
      canonical_event_id: ev.canonical_event_id, canonical_market_id: ev.canonical_market_id, canonical_outcome_id: String(ev.canonical_outcome_id || ev.selection),
      event_start_at: ev.event_start_at || null, model_version: ev.model_version, methodology_version: ev.model_version,
      mapping_version: ev.mapping_version, rules_version: ev.rules_version,
      public_payload: payload,
      signal_payload: {
        pick_publication_id: null, value_evaluation_id: ev.id, selection: ev.selection,
        observed_price: ev.best_decimal_odds != null ? Number(ev.best_decimal_odds) : Number(ev.best_prediction_market_price),
        price_limit: ev.minimum_acceptable_odds != null ? Number(ev.minimum_acceptable_odds) : Number(ev.maximum_acceptable_price),
        probabilities: { gp: numN(ev.gp_probability), sportsbook_consensus: numN(ev.sportsbook_consensus_probability), prediction_market: numN(ev.prediction_market_probability), ensemble: numN(ev.ensemble_probability), conservative: numN(ev.conservative_probability) },
        edge: numN(ev.adjusted_edge_pp), ev: numN(ev.adjusted_ev), quality: ev.quality_score, uncertainty: ev.uncertainty_score,
        source_count: ev.source_count, independence_groups: ev.independence_group_count,
        versions: { model: ev.model_version, ensemble: ev.ensemble_version, no_vig: ev.no_vig_version, classification: ev.classification_version, mapping: ev.mapping_version, rules: ev.rules_version },
        tracking_stake_units: 1, tracking_policy: cfg.params.trackingPolicy, executed_by_gp: false,
        realized_roi: null,
      },
    }, { sourceRefs: [{ source_type: 'model_output', source_id: 'value_evaluation:' + ev.id, source_version: ev.ensemble_version }, { source_type: 'normalized_snapshot', source_id: 've:' + ev.id }], actorId, client });
    if (!sig || !sig.signal) throw err('signal_registration_failed');

    // 2) pick_publication referenciando la señal inmutable
    const pub = await repo.publications.create({
      pick_candidate_id: cand.id, value_evaluation_id: ev.id, public_id: publicId, publication_status: 'published',
      selection: ev.selection, event_label: eventLabel || null, market_label: marketLabel || cand.market_label, period: period || 'regulation_90m',
      observed_odds: ev.best_decimal_odds, minimum_acceptable_odds: ev.minimum_acceptable_odds, current_odds: ev.best_decimal_odds,
      observed_price: ev.best_prediction_market_price, maximum_acceptable_price: ev.maximum_acceptable_price,
      sportsbook_code: cand.sportsbook_code, deep_link: cand.deep_link, signal_id: sig.signal.id, public_payload: payload, rationale, reviewed_by: actorId, published_at: nowIso,
    }, client);
    await repo.history.insert({ publication_id: pub.id, previous_status: 'candidate', new_status: 'published', action: 'publish', actor_id: actorId, reason: 'manual_publish' }, client);
    await repo.candidates.setStatus(cand.id, 'approved', client);
    return pub;
  });
}

async function priceMoved(pubId, { currentOdds, actorId } = {}) {
  const pub = await repo.publications.byId(pubId); if (!pub) throw err('publication_not_found');
  await repo.publications.update(pubId, { status: 'price_moved', current_odds: currentOdds });
  await repo.history.insert({ publication_id: pubId, previous_status: pub.publication_status, new_status: 'price_moved', action: 'price_moved', actor_id: actorId || 'system', reason: 'current_below_minimum' });
  return { ok: true };
}
async function withdraw(pubId, { actorId, reason } = {}) {
  const pub = await repo.publications.byId(pubId); if (!pub) throw err('publication_not_found');
  await repo.publications.update(pubId, { status: 'withdrawn', withdrawn_at: new Date().toISOString(), reason });
  await repo.history.insert({ publication_id: pubId, previous_status: pub.publication_status, new_status: 'withdrawn', action: 'withdraw', actor_id: actorId, reason });
  return { ok: true };
}
async function close(pubId, { actorId } = {}) {
  const pub = await repo.publications.byId(pubId); if (!pub) throw err('publication_not_found');
  await repo.publications.update(pubId, { status: 'closed', closed_at: new Date().toISOString() });
  await repo.history.insert({ publication_id: pubId, previous_status: pub.publication_status, new_status: 'closed', action: 'close', actor_id: actorId });
  return { ok: true };
}

function buildPayload(cand, ev, ctx) {
  return {
    public_id: ctx.publicId, category: 'Pick GP — Strong Value', selection: ev.selection,
    event: ctx.eventLabel || null, market: ctx.marketLabel || cand.market_label, period: ctx.period || 'regulation_90m',
    observed_odds: numN(ev.best_decimal_odds), minimum_acceptable_odds: numN(ev.minimum_acceptable_odds),
    observed_price: numN(ev.best_prediction_market_price), maximum_acceptable_price: numN(ev.maximum_acceptable_price),
    probabilities: { gp: numN(ev.gp_probability), sportsbook_consensus: numN(ev.sportsbook_consensus_probability), prediction_market: numN(ev.prediction_market_probability), ensemble: numN(ev.ensemble_probability), conservative: numN(ev.conservative_probability) },
    fair_odds: numN(ev.fair_odds), adjusted_edge_pp: numN(ev.adjusted_edge_pp), adjusted_ev: numN(ev.adjusted_ev),
    quality_score: ev.quality_score, uncertainty_score: ev.uncertainty_score, source_count: ev.source_count, independence_groups: ev.independence_group_count,
    rationale: ctx.rationale || null,
    tracking: { stake_units: 1, policy: cfg.params.trackingPolicy, executed_by_gp: false, note: 'Retorno teórico con stake unitario. No representa operaciones realizadas.' },
    versions: { model: ev.model_version, ensemble: ev.ensemble_version, no_vig: ev.no_vig_version, classification: ev.classification_version },
    disclaimer: 'Pick GP basada en una señal Strong Value. Cuota observada al momento de publicación. Válida únicamente mientras la cuota permanezca en o por encima del mínimo indicado. Resultado teórico con stake unitario; GP no ejecutó esta operación.',
  };
}
function numN(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }

module.exports = { createCandidate, approve, reject, publish, priceMoved, withdraw, close, newPublicId };
