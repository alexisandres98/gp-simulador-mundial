// sportsbook-providers/repositories.js — persistencia del proveedor (Sprint 8A). Cuotas + runs de ingesta
// + estado de cuota/circuit + catálogo de fuentes. NUNCA persiste la API key.
'use strict';
const db = require('../database/client');

// ---- ingestion runs (sportsbook_ingestion_runs, mig 015 + heartbeat/reconcile en mig 021) ----
async function startRun(meta = {}) {
  const runType = meta.run_type || 'scheduled';
  const r = await db.query(
    `INSERT INTO sportsbook_ingestion_runs (status, run_type, heartbeat_at, metadata) VALUES ('running', $2, now(), $1) RETURNING *`,
    [JSON.stringify(meta), runType]);
  return r.rows[0];
}
async function finishRun(id, { status = 'success', quotes = 0, complete = 0, incomplete = 0, errors = 0, errorCode = null, meta = null }) {
  await db.query(
    `UPDATE sportsbook_ingestion_runs SET status=$2, quotes_ingested=$3, books_complete=$4, books_incomplete=$5, errors=$6, error_code=$8,
       finished_at=now(), heartbeat_at=now(), duration_ms = (EXTRACT(EPOCH FROM (now()-started_at))*1000)::int,
       metadata = CASE WHEN $7::jsonb IS NULL THEN metadata ELSE metadata || $7::jsonb END WHERE id=$1`,
    [id, status, quotes, complete, incomplete, errors, meta ? JSON.stringify(meta) : null, errorCode]
  );
}
// heartbeat de un run vivo (Bloque D) — solo si sigue 'running'
async function heartbeatRun(id) {
  await db.query(`UPDATE sportsbook_ingestion_runs SET heartbeat_at=now() WHERE id=$1 AND status='running'`, [id]);
}
// reconcileOrphanRuns — Bloque D. Marca 'abandoned' los runs 'running' sin heartbeat reciente (proceso muerto).
// NO reanuda escrituras, conserva el error/timeline, registra reconciled_at + nota. Operación administrativa
// auditada (no editar runs a mano por SQL). Devuelve los ids reconciliados.
async function reconcileOrphanRuns({ staleMs = 10 * 60 * 1000, note = 'reconciled: heartbeat ausente', now = null } = {}) {
  const nowExpr = now != null ? `'${new Date(now).toISOString()}'::timestamptz` : 'now()';
  const r = await db.query(
    `UPDATE sportsbook_ingestion_runs
        SET status='abandoned', finished_at=${nowExpr}, reconciled_at=${nowExpr}, reconcile_note=$2,
            duration_ms = COALESCE(duration_ms, (EXTRACT(EPOCH FROM (${nowExpr}-started_at))*1000)::int)
      WHERE status='running'
        AND COALESCE(heartbeat_at, started_at) < ${nowExpr} - ($1::int || ' milliseconds')::interval
      RETURNING id, started_at, heartbeat_at`,
    [staleMs, note]);
  return { reconciled: r.rowCount, ids: r.rows.map(x => x.id) };
}
async function listRunningRuns() {
  const r = await db.query(`SELECT id, status, run_type, started_at, heartbeat_at FROM sportsbook_ingestion_runs WHERE status='running' ORDER BY started_at`);
  return r.rows;
}

// ---- cuotas (idempotente por uq_sbq_book_outcome_run) ----
async function insertQuotes(rows) {
  let inserted = 0;
  for (const q of rows) {
    const r = await db.query(
      `INSERT INTO sportsbook_quotes
        (data_provider, sportsbook_code, sportsbook_name, operator_group, independence_group, source_role, jurisdiction,
         external_event_id, external_market_id, external_outcome_id, market_family, period, is_live, odds_format,
         odds_decimal, implied_probability, raw_implied_probability, quote_status, quote_timestamp, stake_limit_status,
         maximum_stake, normalizer_version, ingestion_run_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (sportsbook_code, external_event_id, market_family, external_outcome_id, ingestion_run_id) DO NOTHING`,
      [q.data_provider, q.sportsbook_code, q.sportsbook_name, q.operator_group, q.independence_group, q.source_role, q.jurisdiction,
       q.external_event_id, q.external_market_id, q.external_outcome_id, q.market_family, q.period, q.is_live, q.odds_format,
       q.odds_decimal, q.implied_probability, q.raw_implied_probability, q.quote_status, q.quote_timestamp, q.stake_limit_status,
       q.maximum_stake, q.normalizer_version, q.ingestion_run_id, JSON.stringify(q.metadata || {})]
    );
    inserted += r.rowCount;
  }
  return inserted;
}

// ---- estado de cuota / circuit del proveedor ----
async function getState(providerName) {
  const r = await db.query(`SELECT * FROM sportsbook_provider_state WHERE provider_name=$1`, [providerName]);
  return r.rows[0] || null;
}
async function upsertState(providerName, s = {}) {
  const r = await db.query(
    `INSERT INTO sportsbook_provider_state
       (provider_name, requests_used, requests_remaining, requests_last_cost, requests_reset_at,
        last_success_at, last_error_at, last_error_code, provider_status, circuit_state, circuit_opened_at, consecutive_failures,
        quota_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        CASE WHEN $2::int IS NOT NULL OR $3::int IS NOT NULL THEN now() ELSE NULL END)
     ON CONFLICT (provider_name) DO UPDATE SET
       requests_used=COALESCE(EXCLUDED.requests_used, sportsbook_provider_state.requests_used),
       requests_remaining=COALESCE(EXCLUDED.requests_remaining, sportsbook_provider_state.requests_remaining),
       requests_last_cost=COALESCE(EXCLUDED.requests_last_cost, sportsbook_provider_state.requests_last_cost),
       requests_reset_at=COALESCE(EXCLUDED.requests_reset_at, sportsbook_provider_state.requests_reset_at),
       -- la marca de la CUOTA solo avanza cuando llegan números reales; sin esto, el trigger de updated_at
       -- ponía fecha fresca sobre números conservados por COALESCE y el panel de créditos mentía (045)
       quota_updated_at=CASE WHEN EXCLUDED.requests_used IS NOT NULL OR EXCLUDED.requests_remaining IS NOT NULL
         THEN now() ELSE sportsbook_provider_state.quota_updated_at END,
       last_success_at=COALESCE(EXCLUDED.last_success_at, sportsbook_provider_state.last_success_at),
       last_error_at=COALESCE(EXCLUDED.last_error_at, sportsbook_provider_state.last_error_at),
       last_error_code=COALESCE(EXCLUDED.last_error_code, sportsbook_provider_state.last_error_code),
       provider_status=EXCLUDED.provider_status, circuit_state=EXCLUDED.circuit_state,
       circuit_opened_at=EXCLUDED.circuit_opened_at, consecutive_failures=EXCLUDED.consecutive_failures
     RETURNING *`,
    [providerName, s.requests_used ?? null, s.requests_remaining ?? null, s.requests_last_cost ?? null, s.requests_reset_at ?? null,
     s.last_success_at ?? null, s.last_error_at ?? null, s.last_error_code ?? null, s.provider_status || 'unknown',
     s.circuit_state || 'closed', s.circuit_opened_at ?? null, s.consecutive_failures ?? 0]
  );
  return r.rows[0];
}

// ---- catálogo de fuentes (independence groups) ----
async function loadSourceCatalog(dataProvider) {
  const r = await db.query(`SELECT * FROM sportsbook_source_metadata WHERE data_provider=$1 AND is_active=true`, [dataProvider]);
  return r.rows.reduce((a, x) => (a[x.sportsbook_code] = x, a), {});
}
async function upsertSource(s, updatedBy = null) {
  const r = await db.query(
    `INSERT INTO sportsbook_source_metadata (data_provider, sportsbook_code, sportsbook_name, operator_group, independence_group, source_role, jurisdiction, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (data_provider, sportsbook_code) DO UPDATE SET
       sportsbook_name=EXCLUDED.sportsbook_name, operator_group=EXCLUDED.operator_group, independence_group=EXCLUDED.independence_group,
       source_role=EXCLUDED.source_role, jurisdiction=EXCLUDED.jurisdiction, version=sportsbook_source_metadata.version+1, updated_by=EXCLUDED.updated_by
     RETURNING *`,
    [s.data_provider, s.sportsbook_code, s.sportsbook_name || null, s.operator_group || null, s.independence_group || null, s.source_role || 'market_consensus', s.jurisdiction || null, updatedBy]
  );
  return r.rows[0];
}

// ---- capabilities por sport key (Bloque E, mig 022) ----
// keys ACTIVAS: las que no se han marcado is_active=false (default: desconocidas se intentan).
async function loadCapabilities(provider) {
  const r = await db.query(`SELECT * FROM sportsbook_provider_capabilities WHERE data_provider=$1`, [provider]);
  return r.rows.reduce((a, x) => (a[x.sport_key] = x, a), {});
}
// registra el resultado de consultar una sport key. ok=true resetea errores; ok=false con no_h2h/bad_request
// la desactiva (is_active=false) tras detectar que no soporta h2h, con razón auditada.
async function recordCapability(provider, sportKey, { sportTitle = null, sportGroup = null, ok = true, status = 'ok', errorCode = null, reason = null, disable = false } = {}) {
  const supportsH2h = ok ? true : (disable ? false : null);
  const r = await db.query(
    `INSERT INTO sportsbook_provider_capabilities
       (data_provider, sport_key, sport_title, sport_group, supports_h2h, is_active, last_status, last_error_code, last_checked_at, consecutive_errors, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10)
     ON CONFLICT (data_provider, sport_key) DO UPDATE SET
       sport_title = COALESCE(EXCLUDED.sport_title, sportsbook_provider_capabilities.sport_title),
       sport_group = COALESCE(EXCLUDED.sport_group, sportsbook_provider_capabilities.sport_group),
       supports_h2h = CASE WHEN $5 IS NULL THEN sportsbook_provider_capabilities.supports_h2h ELSE $5 END,
       is_active = CASE WHEN $11 THEN false ELSE sportsbook_provider_capabilities.is_active END,
       last_status = EXCLUDED.last_status, last_error_code = EXCLUDED.last_error_code, last_checked_at = now(),
       consecutive_errors = CASE WHEN $6 THEN 0 ELSE sportsbook_provider_capabilities.consecutive_errors + 1 END,
       reason = COALESCE(EXCLUDED.reason, sportsbook_provider_capabilities.reason)
     RETURNING *`,
    [provider, sportKey, sportTitle, sportGroup, supportsH2h, !disable, status, errorCode, ok ? 0 : 1, reason, disable]);
  return r.rows[0];
}

module.exports = {
  startRun, finishRun, heartbeatRun, reconcileOrphanRuns, listRunningRuns,
  insertQuotes, getState, upsertState, loadSourceCatalog, upsertSource,
  loadCapabilities, recordCapability,
};
