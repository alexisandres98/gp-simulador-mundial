// signal-registry/resultResolver.js — Fase H.1 §5-6. Cableado AUTOMÁTICO de settlement: resuelve el fixture ESPN
// de un canonical event vía un mapping PERSISTENTE (signal_event_fixture_mappings) — sin fuzzy auto-match en el
// momento de liquidar — lee el resultado reglamentario por un result provider inyectable y persiste el settlement
// versionado. Si falta mapping → UNRESOLVED/MISSING_PROVIDER_MAPPING. Excluye prórroga/penales (el provider debe
// entregar el marcador reglamentario; si no lo tiene → regulation nulls → UNRESOLVED, sin inferir).
'use strict';
const db = require('../database/client');
const settlement = require('./settlement');

// resolveFixture(canonicalEventId) → { fixture_id, espn_id, is_knockout } | null (mapping persistente).
async function resolveFixture(canonicalEventId, client = db) {
  const r = await client.query(
    `SELECT fixture_id, espn_id, is_knockout FROM signal_event_fixture_mappings WHERE canonical_event_id=$1`, [canonicalEventId]);
  return r.rows[0] || null;
}

// resolveCanonicalByFixture(fixtureId) → canonical_event_id | null. Dirección INVERSA (Fase Q.1.1 §2) para las
// superficies de consumo (Partidos): dado el id del fixture (ESPN id), devuelve el canonical event V2 mapeado y
// APROBADO. Solo lee el puente persistente (nunca infiere). Sin mapping aprobado → null → "V2 no disponible".
async function resolveCanonicalByFixture(fixtureId, client = db) {
  if (fixtureId == null) return null;
  const r = await client.query(
    `SELECT canonical_event_id FROM signal_event_fixture_mappings
       WHERE (fixture_id = $1 OR espn_id = $1) AND review_status = 'approved' LIMIT 1`, [String(fixtureId)]);
  return r.rows[0] ? r.rows[0].canonical_event_id : null;
}

// resolveCanonicalByTeams — resolución de DISPLAY (Fase Q.1.1 §2) para Partidos cuando el puente por fixture_id
// no aplica (p.ej. knockouts, cuyo meta no lleva ESPN id). Matchea un canonical_event CON eval V2 por
// (home,away) resueltos a códigos de equipo + ventana de fecha (±2 días). Es solo para PRESENTACIÓN (nunca
// settlement): cada cruce del Mundial es único, así que el match por equipos+fecha es inequívoco. Sin match → null.
async function resolveCanonicalByTeams(homeCode, awayCode, isoDate, resolveTeamId, client = db) {
  if (!homeCode || !awayCode || typeof resolveTeamId !== 'function') return null;
  const day = isoDate ? new Date(isoDate) : null;
  const params = []; let where = '';
  if (day && !isNaN(day)) { params.push(new Date(day.getTime() - 2 * 864e5), new Date(day.getTime() + 2 * 864e5)); where = 'AND ce.scheduled_start BETWEEN $1 AND $2'; }
  const r = await client.query(
    `SELECT ce.id, ce.home_participant, ce.away_participant FROM canonical_events ce
       WHERE ce.id IN (SELECT DISTINCT canonical_event_id FROM value_evaluations WHERE official_gp_model='V2') ${where}`, params);
  for (const row of r.rows) {
    const hc = resolveTeamId(row.home_participant), ac = resolveTeamId(row.away_participant);
    if (!hc || !ac) continue;
    if ((hc === homeCode && ac === awayCode) || (hc === awayCode && ac === homeCode)) return row.id;
  }
  return null;
}

// upsertFixtureMapping(...) — registro/actualización del puente (admin/catálogo/tests). NO se usa en el sweep
// automático de liquidación (ese solo LEE el mapping; nunca crea uno por inferencia).
async function upsertFixtureMapping({ canonicalEventId, fixtureId, espnId = null, isKnockout = false, homeAlias = null, awayAlias = null, mappingSource = 'manual', resolvedBy = null }, client = db) {
  const r = await client.query(
    `INSERT INTO signal_event_fixture_mappings (canonical_event_id, fixture_id, espn_id, is_knockout, home_alias, away_alias, mapping_source, resolved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (canonical_event_id) DO UPDATE SET fixture_id=EXCLUDED.fixture_id, espn_id=EXCLUDED.espn_id, is_knockout=EXCLUDED.is_knockout,
       home_alias=EXCLUDED.home_alias, away_alias=EXCLUDED.away_alias, mapping_source=EXCLUDED.mapping_source, resolved_by=EXCLUDED.resolved_by
     RETURNING *`,
    [canonicalEventId, fixtureId, espnId, isKnockout, homeAlias, awayAlias, mappingSource, resolvedBy]);
  return r.rows[0];
}

// resolveAndSettle(signal, opts) → estado. opts: { resultProvider, now, captureSource, actorId, adminStatus }
//   signal: { id, canonical_event_id, event_start_at }
//   resultProvider(fixture, {isKnockout}) → { providerStatus, regulationHomeGoals, regulationAwayGoals,
//      postponed, cancelled, abandoned, observedAt, finalizedAt } | null  (null = aún sin resultado).
async function resolveAndSettle(signal, opts = {}) {
  const captureSource = opts.captureSource || 'automatic';
  if (opts.adminStatus === 'DATA_ERROR') return { state: 'BLOCKED', reason: 'admin_data_error' };

  const fixture = await resolveFixture(signal.canonical_event_id);
  if (!fixture) {
    // §5: sin mapping persistente → UNRESOLVED/MISSING_PROVIDER_MAPPING (idempotente, no fuzzy match).
    const r = await settlement.settleFromProvider(signal.id, {
      providerStatus: 'unknown', source: 'espn_scoreboard', sourceReference: 'missing_mapping',
      captureSource, providerFixtureId: null,
    }, { actorId: opts.actorId });
    return { state: 'MISSING_MAPPING', settlement: r.settlement || null, skipped: !!r.skipped };
  }

  const provider = opts.resultProvider;
  const res = provider ? await provider(fixture, { isKnockout: fixture.is_knockout }) : null;
  if (!res) return { state: 'PENDING', reason: 'no_result_yet', fixture_id: fixture.fixture_id };

  const r = await settlement.settleFromProvider(signal.id, {
    providerStatus: res.providerStatus, regulationHomeGoals: res.regulationHomeGoals, regulationAwayGoals: res.regulationAwayGoals,
    postponed: res.postponed, cancelled: res.cancelled, abandoned: res.abandoned,
    observedAt: res.observedAt || null, finalizedAt: res.finalizedAt || null,
    source: 'espn_scoreboard', sourceReference: res.sourceReference || (fixture.espn_id ? 'espn:' + fixture.espn_id + ':' + (res.providerStatus || '') : 'fixture:' + fixture.fixture_id + ':' + (res.providerStatus || '')),
    captureSource, providerFixtureId: fixture.fixture_id,
  }, { actorId: opts.actorId });

  if (r.skipped) return { state: 'SKIPPED', reason: r.reason, fixture_id: fixture.fixture_id };
  const st = r.settlement.settlement_status;
  const state = st === 'final' ? 'FINALIZED' : st === 'provisional' ? 'PROVISIONAL' : st === 'unresolved' ? 'UNRESOLVED' : st.toUpperCase();
  return { state, settlement_status: st, result_outcome: r.settlement.result_outcome, version: r.settlement.settlement_version, fixture_id: fixture.fixture_id };
}

module.exports = { resolveFixture, resolveCanonicalByFixture, resolveCanonicalByTeams, upsertFixtureMapping, resolveAndSettle };
