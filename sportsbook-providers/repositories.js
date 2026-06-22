// sportsbook-providers/repositories.js — persistencia del proveedor (Sprint 8A). Cuotas + runs de ingesta
// + estado de cuota/circuit + catálogo de fuentes. NUNCA persiste la API key.
'use strict';
const db = require('../database/client');

// ---- ingestion runs (reutiliza sportsbook_ingestion_runs de mig 015) ----
async function startRun(meta = {}) {
  const r = await db.query(`INSERT INTO sportsbook_ingestion_runs (status, metadata) VALUES ('running', $1) RETURNING *`, [JSON.stringify(meta)]);
  return r.rows[0];
}
async function finishRun(id, { status = 'success', quotes = 0, complete = 0, incomplete = 0, errors = 0, meta = null }) {
  await db.query(
    `UPDATE sportsbook_ingestion_runs SET status=$2, quotes_ingested=$3, books_complete=$4, books_incomplete=$5, errors=$6,
       finished_at=now(), duration_ms = (EXTRACT(EPOCH FROM (now()-started_at))*1000)::int,
       metadata = CASE WHEN $7::jsonb IS NULL THEN metadata ELSE metadata || $7::jsonb END WHERE id=$1`,
    [id, status, quotes, complete, incomplete, errors, meta ? JSON.stringify(meta) : null]
  );
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
        last_success_at, last_error_at, last_error_code, provider_status, circuit_state, circuit_opened_at, consecutive_failures)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (provider_name) DO UPDATE SET
       requests_used=COALESCE(EXCLUDED.requests_used, sportsbook_provider_state.requests_used),
       requests_remaining=COALESCE(EXCLUDED.requests_remaining, sportsbook_provider_state.requests_remaining),
       requests_last_cost=COALESCE(EXCLUDED.requests_last_cost, sportsbook_provider_state.requests_last_cost),
       requests_reset_at=COALESCE(EXCLUDED.requests_reset_at, sportsbook_provider_state.requests_reset_at),
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

module.exports = { startRun, finishRun, insertQuotes, getState, upsertState, loadSourceCatalog, upsertSource };
