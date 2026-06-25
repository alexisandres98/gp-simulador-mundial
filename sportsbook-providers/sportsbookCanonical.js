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

// createCanonicalEventFromSportsbook(ev, {by}) — usado al APROBAR manualmente un candidato (auditoría §18).
// Crea el canonical_event y enlaza las quotes del evento. NO se llama automáticamente.
async function approveEvent(externalEventId, { provider = 'the_odds_api', reviewedBy = 'admin', now = null } = {}) {
  return db.withTransaction(async (c) => {
    const evs = (await c.query(
      `SELECT max(metadata->>'home_team') home_team, max(metadata->>'away_team') away_team,
              max(metadata->>'competition') competition, max(metadata->>'commence_time') commence_time
       FROM sportsbook_quote_current WHERE data_provider=$1 AND external_event_id=$2`, [provider, externalEventId])).rows[0];
    if (!evs) { const e = new Error('event_not_found'); e.code = 'event_not_found'; throw e; }
    const home = aliases.resolve(evs.home_team), away = aliases.resolve(evs.away_team);
    if (!home || !away) { const e = new Error('participants_unresolved'); e.code = 'participants_unresolved'; throw e; }
    const ce = (await c.query(
      `INSERT INTO canonical_events (event_type, sport, competition, home_participant, away_participant, scheduled_start, status, metadata)
       VALUES ('match','football',$1,$2,$3,$4,'scheduled',$5) RETURNING id`,
      [evs.competition, home.canonicalName, away.canonicalName, evs.commence_time, JSON.stringify({ source: 'sportsbook_approved', external_event_id: externalEventId })])).rows[0];
    // enlaza quotes (current + history) a este canonical_event
    await c.query(`UPDATE sportsbook_quote_current SET canonical_event_id=$1 WHERE data_provider=$2 AND external_event_id=$3`, [ce.id, provider, externalEventId]);
    await c.query(`UPDATE sportsbook_quote_history SET canonical_event_id=$1 WHERE data_provider=$2 AND external_event_id=$3`, [ce.id, provider, externalEventId]);
    // registra el mapping de evento (auditado) con el provider_id de sportsbooks
    const pid = await providerId(c, provider);
    await c.query(
      `INSERT INTO provider_event_mappings (provider_id, external_event_id, canonical_event_id, mapping_status, mapping_method, equivalence_score, reviewed_by, metadata)
       VALUES ($1,$2,$3,'matched','manual',1,$4,$5)
       ON CONFLICT (provider_id, external_event_id, mapping_version) DO UPDATE SET
         canonical_event_id=EXCLUDED.canonical_event_id, mapping_status='matched', reviewed_by=EXCLUDED.reviewed_by`,
      [pid, externalEventId, ce.id, reviewedBy, JSON.stringify({ reviewedBy })]);
    return { canonical_event_id: ce.id, home: home.canonicalName, away: away.canonicalName };
  });
}

module.exports = { seedParticipants, buildSportsbookEvents, validateEvent, generateCandidates, approveEvent };
