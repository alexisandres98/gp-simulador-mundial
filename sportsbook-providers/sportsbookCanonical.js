// sportsbook-providers/sportsbookCanonical.js — Post-shadow Bloque G. Conecta sportsbook_quote_current al
// Canonical Event Graph. Durante esta fase CANONICAL_AUTO_MATCH_ENABLED=false: genera candidates + llena la
// review queue (needs_review) PERO no aprueba automáticamente. Valida competición/kickoff/home/away/1X2/
// regulation/no-iniciado/sin "to qualify"/sin prórroga. Una quote sin evento canonical matched no llega a Value.
'use strict';
const db = require('../database/client');
const aliases = require('../canonical-graph/participantAliases');
const graphRepo = require('../canonical-graph/repositories/graphRepository');

// siembra participantes/alias del grafo (R10: nunca se había invocado → matching 0). Idempotente.
async function seedParticipants() { return graphRepo.seedParticipants(); }

// get/create del provider_id de sportsbooks (providers.code), necesario para provider_event_mappings.
async function providerId(c, code = 'the_odds_api') {
  const r = await c.query(
    `INSERT INTO providers (code, name, provider_type) VALUES ($1,$2,'sportsbook')
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [code, code]);
  return r.rows[0].id;
}

// agrupa current state por evento real (una fila por external_event_id, con sus casas).
async function buildSportsbookEvents(provider = 'the_odds_api') {
  if (!db.isConfigured()) return [];
  const r = await db.query(
    `SELECT external_event_id,
       max(metadata->>'home_team')   AS home_team,
       max(metadata->>'away_team')   AS away_team,
       max(metadata->>'competition') AS competition,
       max(metadata->>'commence_time') AS commence_time,
       count(DISTINCT sportsbook_code)::int AS book_count,
       array_agg(DISTINCT sportsbook_code) AS books,
       bool_or(is_live) AS any_live,
       max(market_family) AS market_family, max(period) AS period,
       bool_or(canonical_event_id IS NOT NULL) AS already_linked
     FROM sportsbook_quote_current
     WHERE data_provider=$1
     GROUP BY external_event_id`, [provider]);
  return r.rows;
}

// valida un evento sportsbook para candidatura canónica (§G). Devuelve { valid, reasons:[], home, away }.
function validateEvent(ev, { now = null } = {}) {
  const reasons = [];
  const nowMs = now != null ? +new Date(now) : Date.now();
  if (ev.market_family !== '1x2') reasons.push('not_1x2');
  if (ev.period !== 'regulation') reasons.push('not_regulation');
  if (ev.any_live === true) reasons.push('live');
  if (!ev.competition) reasons.push('competition_unknown');
  const commenceMs = ev.commence_time ? +new Date(ev.commence_time) : NaN;
  if (!Number.isFinite(commenceMs)) reasons.push('kickoff_unknown');
  else if (commenceMs <= nowMs) reasons.push('event_started');
  const home = ev.home_team ? aliases.resolve(ev.home_team) : null;
  const away = ev.away_team ? aliases.resolve(ev.away_team) : null;
  if (!home) reasons.push('home_unresolved');
  if (!away) reasons.push('away_unresolved');
  if (home && away && home.code === away.code) reasons.push('participants_identical');
  // hard validations (rechazo) vs blandas (a review). El normalizer ya excluye prórroga/"to qualify"/2-way.
  const hardReject = reasons.some(r => ['not_1x2', 'not_regulation', 'live', 'event_started', 'participants_identical'].includes(r));
  return { valid: reasons.length === 0, hardReject, reasons, home, away };
}

// generateCandidates(provider, opts) — produce candidates + review queue. NO aprueba (auto-match OFF).
// opts.autoMatch debe ser false en esta fase; si true se rechaza (defensa).
async function generateCandidates(provider = 'the_odds_api', { now = null, autoMatch = false } = {}) {
  if (autoMatch) { const e = new Error('auto_match_forbidden_in_this_phase'); e.code = 'auto_match_forbidden'; throw e; }
  const events = await buildSportsbookEvents(provider);
  const out = { events: events.length, candidates: 0, needs_review: 0, rejected: 0, linked_skipped: 0, by_reason: {} };
  for (const ev of events) {
    if (ev.already_linked) { out.linked_skipped++; continue; }
    const v = validateEvent(ev, { now });
    const bump = (k) => { out.by_reason[k] = (out.by_reason[k] || 0) + 1; };

    // entity_type del grafo está acotado a (event|market|outcome); marcamos el origen sportsbook por
    // provider_a y por metadata, no por un entity_type nuevo.
    if (v.hardReject) {
      out.rejected++; v.reasons.forEach(bump);
      await graphRepo.recordDecision({
        mappingEntityType: 'event', newStatus: 'rejected', decisionSource: 'auto',
        algorithmVersion: 'sportsbook-canonical-1', reason: v.reasons.join(','),
        evidence: { source: 'sportsbook', external_event_id: ev.external_event_id, books: ev.book_count },
      }).catch(() => {});
      continue;
    }

    // candidato válido o pendiente por participantes no resueltos → review queue (needs_review)
    out.candidates++;
    out.needs_review++;
    if (!v.valid) v.reasons.forEach(bump);
    await graphRepo.upsertReviewItem({
      entityType: 'event', providerA: provider, externalIdA: ev.external_event_id,
      providerB: 'canonical', externalIdB: ev.external_event_id,
      candidatePayload: {
        source: 'sportsbook', home_team_raw: ev.home_team, away_team_raw: ev.away_team,
        home_canonical: v.home && v.home.canonicalName, away_canonical: v.away && v.away.canonicalName,
        competition: ev.competition, commence_time: ev.commence_time, market_family: '1x2', period: 'regulation',
        book_count: ev.book_count, books: ev.books, resolution: v.valid ? 'resolved' : 'needs_review',
      },
      score: v.valid ? 1 : 0.6, conflicts: v.reasons, evidence: { source: 'sportsbook', reasons: v.reasons },
      priority: v.valid ? 10 : 0,
    }).catch(() => {});
    await graphRepo.recordDecision({
      mappingEntityType: 'event', newStatus: 'needs_review', decisionSource: 'auto',
      algorithmVersion: 'sportsbook-canonical-1', reason: v.valid ? 'candidate_ready' : v.reasons.join(','),
      evidence: { source: 'sportsbook', external_event_id: ev.external_event_id },
    }).catch(() => {});
  }
  return out;
}

// approveEvent — APROBACIÓN MANUAL de un candidato (Fase B activación interna). En UNA transacción crea la
// cadena canónica completa (canonical_event + canonical_market 1x2 + outcomes home/draw/away), enlaza las
// quotes (event+market+outcome), registra provider_event_mapping(matched), admin_audit_event, y decide el
// review item → approved. IDEMPOTENTE (si ya está matched, no duplica). Guard: rechaza evento ya iniciado.
async function approveEvent(externalEventId, { provider = 'the_odds_api', reviewedBy = 'admin', now = null, reason = 'manual approval (fase B activación interna)' } = {}) {
  return db.withTransaction(async (c) => {
    const pid = await providerId(c, provider);
    // idempotencia: si ya hay mapping matched, devolver el canonical existente (no duplicar)
    const existing = (await c.query(
      `SELECT canonical_event_id FROM provider_event_mappings WHERE provider_id=$1 AND external_event_id=$2 AND mapping_status='matched'`,
      [pid, externalEventId])).rows[0];
    if (existing) return { canonical_event_id: existing.canonical_event_id, already: true };

    const evs = (await c.query(
      `SELECT max(metadata->>'home_team') home_team, max(metadata->>'away_team') away_team,
              max(metadata->>'competition') competition, max(metadata->>'commence_time') commence_time
       FROM sportsbook_quote_current WHERE data_provider=$1 AND external_event_id=$2`, [provider, externalEventId])).rows[0];
    if (!evs || !evs.home_team) { const e = new Error('event_not_found'); e.code = 'event_not_found'; throw e; }
    const home = aliases.resolve(evs.home_team), away = aliases.resolve(evs.away_team);
    if (!home || !away) { const e = new Error('participants_unresolved'); e.code = 'participants_unresolved'; throw e; }
    // guard: NO aprobar eventos ya iniciados
    const nowMs = now != null ? +new Date(now) : Date.now();
    if (evs.commence_time && +new Date(evs.commence_time) <= nowMs) { const e = new Error('event_started'); e.code = 'event_started'; throw e; }

    const ce = (await c.query(
      `INSERT INTO canonical_events (event_type, sport, competition, home_participant, away_participant, scheduled_start, status, metadata)
       VALUES ('match','football',$1,$2,$3,$4,'scheduled',$5) RETURNING id`,
      [evs.competition, home.canonicalName, away.canonicalName, evs.commence_time, JSON.stringify({ source: 'sportsbook_approved', external_event_id: externalEventId })])).rows[0];
    // canonical_market 1x2 regulation
    const cm = (await c.query(
      `INSERT INTO canonical_markets (canonical_event_id, market_type, period, outcome_type, draw_possible, includes_extra_time, includes_penalties, qualification_market, status, metadata)
       VALUES ($1,'1x2','regulation_90m','categorical',true,false,false,false,'open',$2) RETURNING id`,
      [ce.id, JSON.stringify({ source: 'sportsbook' })])).rows[0];
    // canonical_outcomes home/draw/away
    const oc = {};
    for (const [code, part, ord] of [['home', home.canonicalName, 0], ['draw', null, 1], ['away', away.canonicalName, 2]]) {
      const r = await c.query(
        `INSERT INTO canonical_outcomes (canonical_market_id, outcome_code, outcome_name, outcome_type, participant_reference, display_order, status)
         VALUES ($1,$2,$3,'categorical',$4,$5,'active') RETURNING id`, [cm.id, code, code, part, ord]);
      oc[code] = r.rows[0].id;
    }
    // enlaza quotes current: event+market a TODAS las filas del evento, luego outcome por slot
    await c.query(`UPDATE sportsbook_quote_current SET canonical_event_id=$1, canonical_market_id=$2 WHERE data_provider=$3 AND external_event_id=$4`, [ce.id, cm.id, provider, externalEventId]);
    for (const slot of ['home', 'draw', 'away']) {
      await c.query(
        `UPDATE sportsbook_quote_current SET canonical_outcome_id=$1
         WHERE data_provider=$2 AND external_event_id=$3 AND (metadata->>'outcome_slot')=$4`,
        [oc[slot], provider, externalEventId, slot]);
    }
    await c.query(`UPDATE sportsbook_quote_history SET canonical_event_id=$1 WHERE data_provider=$2 AND external_event_id=$3`, [ce.id, provider, externalEventId]);
    // provider_event_mapping (matched, auditado)
    await c.query(
      `INSERT INTO provider_event_mappings (provider_id, external_event_id, canonical_event_id, mapping_status, mapping_method, equivalence_score, reviewed_by, reviewed_at, metadata)
       VALUES ($1,$2,$3,'matched','manual',1,$4,now(),$5)
       ON CONFLICT (provider_id, external_event_id, mapping_version) DO UPDATE SET
         canonical_event_id=EXCLUDED.canonical_event_id, mapping_status='matched', reviewed_by=EXCLUDED.reviewed_by, reviewed_at=now()`,
      [pid, externalEventId, ce.id, reviewedBy, JSON.stringify({ reviewedBy })]);
    // admin audit event
    await c.query(
      `INSERT INTO admin_audit_events (admin_user_id, action, entity_type, entity_id, after_safe, reason)
       VALUES ($1,'approve_sportsbook_mapping','canonical_event',$2,$3,$4)`,
      [reviewedBy, ce.id, JSON.stringify({ external_event_id: externalEventId, home: home.canonicalName, away: away.canonicalName, market: '1x2', period: 'regulation_90m' }), reason]);
    // decide review item → approved
    await c.query(
      `UPDATE mapping_review_queue SET status='approved', decision='approve', reviewed_by=$3, reviewed_at=now()
       WHERE provider_a=$1 AND external_id_a=$2 AND status='pending'`, [provider, externalEventId, reviewedBy]);
    return { canonical_event_id: ce.id, canonical_market_id: cm.id, home: home.canonicalName, away: away.canonicalName };
  });
}

// autoApprovePerfectCandidates — AUTOMATIZACIÓN (7-jul, pedido de Alexis): aprueba SOLO los candidatos
// PERFECTOS de la review queue (resolution='resolved': 1X2 regulation, no iniciado, ambos participantes
// resueltos por alias). Todo lo dudoso queda en la cola para revisión manual, como siempre. approveEvent
// re-valida participantes y kickoff dentro de su transacción → doble guard. reviewedBy='auto' → auditable
// en admin_audit_events y distinguible de las aprobaciones humanas.
async function autoApprovePerfectCandidates({ provider = 'the_odds_api', now = null } = {}) {
  if (!db.isConfigured()) return { skipped: 'no_db' };
  const pending = (await db.query(
    `SELECT external_id_a, candidate_payload FROM mapping_review_queue
     WHERE provider_a=$1 AND entity_type='event' AND status='pending'`, [provider])).rows;
  const out = { pending: pending.length, approved: 0, left_for_review: 0, errors: 0, events: [] };
  for (const item of pending) {
    const payload = typeof item.candidate_payload === 'string' ? JSON.parse(item.candidate_payload) : (item.candidate_payload || {});
    if (payload.source !== 'sportsbook' || payload.resolution !== 'resolved') { out.left_for_review++; continue; }
    try {
      const r = await approveEvent(item.external_id_a, { provider, reviewedBy: 'auto', now, reason: 'auto approval: candidato perfecto (validaciones completas)' });
      if (!r.already) { out.approved++; out.events.push(r.home + ' vs ' + r.away); }
    } catch (e) { out.errors++; }   // guard interno falló (ej. arrancó el partido) → queda pendiente
  }
  return out;
}

module.exports = { seedParticipants, buildSportsbookEvents, validateEvent, generateCandidates, approveEvent, autoApprovePerfectCandidates };
