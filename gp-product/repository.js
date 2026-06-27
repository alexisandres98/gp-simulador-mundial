// gp-product/repository.js — Fase Q. Lecturas READ-ONLY para la experiencia de producto beta. Consultas
// batched (anti N+1, §17): por evento se traen las últimas evals por outcome y el último snapshot en queries
// agregadas, no en bucle. NUNCA escribe. Devuelve filas crudas; el mapeo a DTO lo hace dto.js (puro).
'use strict';

const OPERATIONAL = `evaluation_mode='internal_operational'`;

// Eventos próximos (o en juego) con al menos una eval oficial V2 reciente. Orden por kickoff ascendente.
async function upcomingEvents(db, { limit = 12, now = Date.now() } = {}) {
  const since = new Date(now - 3 * 3600 * 1000).toISOString();   // incluye partidos que arrancaron hace ≤3h
  const r = await db.query(
    `SELECT e.id, e.home_participant, e.away_participant, e.scheduled_start, e.competition, e.stage, e.status, e.venue, e.metadata
       FROM canonical_events e
      WHERE e.scheduled_start >= $1
        AND e.id IN (SELECT DISTINCT canonical_event_id FROM value_evaluations WHERE ${OPERATIONAL} AND official_gp_model='V2')
      ORDER BY e.scheduled_start ASC
      LIMIT $2`, [since, limit]);
  return r.rows;
}

// Últimas evals oficiales V2 por (evento, outcome) para un conjunto de eventos. DISTINCT ON = la más reciente.
async function latestEvalsForEvents(db, eventIds) {
  if (!eventIds || !eventIds.length) return new Map();
  const r = await db.query(
    `SELECT DISTINCT ON (canonical_event_id, selection) *
       FROM value_evaluations
      WHERE ${OPERATIONAL} AND official_gp_model='V2' AND canonical_event_id = ANY($1::uuid[])
      ORDER BY canonical_event_id, selection, created_at DESC`, [eventIds]);
  const byEvent = new Map();
  for (const row of r.rows) {
    if (!byEvent.has(row.canonical_event_id)) byEvent.set(row.canonical_event_id, {});
    byEvent.get(row.canonical_event_id)[row.selection] = row;
  }
  return byEvent;
}

// Último v2_probability_snapshot por evento (lineage de contexto).
async function latestSnapshots(db, eventIds) {
  if (!eventIds || !eventIds.length) return new Map();
  const r = await db.query(
    `SELECT DISTINCT ON (canonical_event_id) *
       FROM v2_probability_snapshots
      WHERE canonical_event_id = ANY($1::uuid[])
      ORDER BY canonical_event_id, created_at DESC`, [eventIds]);
  const m = new Map();
  for (const row of r.rows) m.set(row.canonical_event_id, row);
  return m;
}

// Observaciones de contexto aplicadas (factor lineage) de un evento.
async function observationsForEvent(db, eventId) {
  const r = await db.query(
    `SELECT factor_code, category, subject_type, subject_id, direction, applied_impact, proposed_impact,
            fact_or_inference, confidence, timestamp_quality
       FROM context_observations
      WHERE canonical_event_id = $1
      ORDER BY ABS(applied_impact) DESC NULLS LAST
      LIMIT 50`, [eventId]);
  return r.rows;
}

// Último goal_model_snapshot por evento (informativo). Normaliza over_under (array → {line:{over,under}}).
async function goalSnapshot(db, eventId) {
  const r = await db.query(
    `SELECT final_lambda_home, final_lambda_away, expected_total_goals, total_goals_distribution, over_under, btts, top_scorelines
       FROM goal_model_snapshots WHERE canonical_event_id = $1 ORDER BY created_at DESC LIMIT 1`, [eventId]);
  const g = r.rows[0];
  if (!g) return null;
  const ou = {};
  for (const item of (Array.isArray(g.over_under) ? g.over_under : [])) {
    const line = item.line != null ? String(item.line) : null;
    if (line) ou[line] = { over: item.over, under: item.under };
  }
  return {
    lambda_home: g.final_lambda_home, lambda_away: g.final_lambda_away, lambda_total: g.expected_total_goals,
    over_under: ou, btts: g.btts,
    top_scores: (Array.isArray(g.top_scorelines) ? g.top_scorelines : []).map((s) => ({
      score: s.score || (s.home != null ? `${s.home}-${s.away}` : null), probability: s.probability != null ? s.probability : s.p,
    })),
  };
}

// Value: últimas evals V2 por (evento,outcome), con header del evento. Filtros aplicados en api/dto.
async function valueEvaluations(db, { now = Date.now(), limit = 200 } = {}) {
  const since = new Date(now - 3 * 3600 * 1000).toISOString();
  const r = await db.query(
    `SELECT DISTINCT ON (v.canonical_event_id, v.selection) v.*, e.home_participant, e.away_participant, e.scheduled_start, e.stage, e.status
       FROM value_evaluations v
       JOIN canonical_events e ON e.id = v.canonical_event_id
      WHERE v.${OPERATIONAL} AND v.official_gp_model='V2' AND e.scheduled_start >= $1
      ORDER BY v.canonical_event_id, v.selection, v.created_at DESC
      LIMIT $2`, [since, limit]);
  return r.rows;
}

// Picks internas (neutral snapshot). Las 2 V1 históricas + futuras V2. Con settlement/result si existe.
// CLV no vive en signal_settlements (lo calcula metrics-engine); aquí se deja null y se completará al liquidar.
async function picks(db) {
  const r = await db.query(
    `SELECT p.*, s.result_outcome, s.realized_roi, s.settled_at, s.is_final,
            e.scheduled_start, e.status AS event_status
       FROM internal_picks p
       LEFT JOIN signal_settlements s ON s.signal_id = p.signal_id
       LEFT JOIN canonical_events e ON e.id = p.canonical_event_id
      ORDER BY p.kickoff_at ASC`).catch((err) => ({ rows: [], _err: err.message }));
  return r.rows;
}

async function pickById(db, pickId) {
  const r = await db.query(
    `SELECT p.*, s.result_outcome, s.realized_roi, s.settled_at, s.is_final, e.status AS event_status
       FROM internal_picks p
       LEFT JOIN signal_settlements s ON s.signal_id = p.signal_id
       LEFT JOIN canonical_events e ON e.id = p.canonical_event_id
      WHERE p.pick_id = $1`, [pickId]).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

// Un evento por id (para match detail).
async function eventById(db, eventId) {
  const r = await db.query(
    `SELECT id, home_participant, away_participant, scheduled_start, competition, stage, status, venue, metadata
       FROM canonical_events WHERE id = $1`, [eventId]).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

// Métricas de historial: tamaño de muestra de señales liquidadas (para el gate "muestra insuficiente").
async function historySummary(db) {
  const settled = await db.query(
    `SELECT result_outcome, count(*) n FROM signal_settlements GROUP BY 1`).catch(() => ({ rows: [] }));
  const facts = await db.query(
    `SELECT model_label, count(*) n, avg(brier_score) brier, avg(log_loss) ll
       FROM shadow_metric_facts GROUP BY 1`).catch(() => ({ rows: [] }));
  return { settled: settled.rows, shadow_facts: facts.rows };
}

module.exports = {
  upcomingEvents, latestEvalsForEvents, latestSnapshots, observationsForEvent,
  goalSnapshot, valueEvaluations, picks, pickById, eventById, historySummary,
};
