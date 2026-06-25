// sportsbook-providers/persistence.js — Post-shadow Bloque A. Persistencia BATCH e idempotente de cuotas
// en sportsbook_quote_current (un upsert set-based por lote, SIN N+1). El trigger sbq_write_history escribe
// history SOLO en cambio material (precio/estado/disponibilidad), así que una reingesta idéntica no añade
// filas históricas. La idempotencia depende de la IDENTIDAD NATURAL, no de ingestion_run_id:
//   (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id)
'use strict';
const db = require('../database/client');

const CHUNK = 1000;  // filas por transacción (jsonb_to_recordset no usa placeholders → sin límite de params, pero acotamos la tx)

// columnas del recordset (orden y tipos importan para jsonb_to_recordset)
const RECORD_COLS = `
  data_provider text, sportsbook_code text, external_event_id text, market_family text, period text, external_outcome_id text,
  sportsbook_name text, operator_group text, independence_group text, source_role text, jurisdiction text,
  is_live boolean, odds_format text, odds_decimal numeric, implied_probability numeric, raw_implied_probability numeric,
  quote_status text, stake_limit_status text, maximum_stake numeric, external_market_id text,
  provider_update timestamptz, normalizer_version text, metadata jsonb`;

const UPSERT_SQL = `
INSERT INTO sportsbook_quote_current
  (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id,
   sportsbook_name, operator_group, independence_group, source_role, jurisdiction,
   is_live, odds_format, odds_decimal, implied_probability, raw_implied_probability,
   quote_status, stake_limit_status, maximum_stake, external_market_id,
   provider_update, observed_at, last_changed_at, normalizer_version, last_ingestion_run_id, metadata)
SELECT
   x.data_provider, x.sportsbook_code, x.external_event_id, x.market_family, x.period, x.external_outcome_id,
   x.sportsbook_name, x.operator_group, x.independence_group, COALESCE(x.source_role,'market_consensus'), x.jurisdiction,
   COALESCE(x.is_live,false), COALESCE(x.odds_format,'decimal'), x.odds_decimal, x.implied_probability, x.raw_implied_probability,
   COALESCE(x.quote_status,'open'), COALESCE(x.stake_limit_status,'unknown'), x.maximum_stake, x.external_market_id,
   x.provider_update, now(), now(), x.normalizer_version, $2::uuid, COALESCE(x.metadata,'{}'::jsonb)
FROM jsonb_to_recordset($1::jsonb) AS x(${RECORD_COLS})
ON CONFLICT (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id)
DO UPDATE SET
   odds_decimal = EXCLUDED.odds_decimal,
   implied_probability = EXCLUDED.implied_probability,
   raw_implied_probability = EXCLUDED.raw_implied_probability,
   quote_status = EXCLUDED.quote_status,
   is_live = EXCLUDED.is_live,
   stake_limit_status = EXCLUDED.stake_limit_status,
   maximum_stake = EXCLUDED.maximum_stake,
   external_market_id = COALESCE(EXCLUDED.external_market_id, sportsbook_quote_current.external_market_id),
   sportsbook_name = COALESCE(EXCLUDED.sportsbook_name, sportsbook_quote_current.sportsbook_name),
   operator_group = EXCLUDED.operator_group,
   independence_group = EXCLUDED.independence_group,
   source_role = EXCLUDED.source_role,
   jurisdiction = COALESCE(EXCLUDED.jurisdiction, sportsbook_quote_current.jurisdiction),
   provider_update = EXCLUDED.provider_update,
   observed_at = EXCLUDED.observed_at,
   observation_count = sportsbook_quote_current.observation_count + 1,
   last_ingestion_run_id = EXCLUDED.last_ingestion_run_id,
   normalizer_version = EXCLUDED.normalizer_version,
   last_changed_at = CASE
     WHEN sportsbook_quote_current.odds_decimal IS DISTINCT FROM EXCLUDED.odds_decimal
       OR sportsbook_quote_current.quote_status IS DISTINCT FROM EXCLUDED.quote_status
       OR sportsbook_quote_current.is_live   IS DISTINCT FROM EXCLUDED.is_live
     THEN EXCLUDED.observed_at ELSE sportsbook_quote_current.last_changed_at END
RETURNING (xmax = 0) AS inserted`;

// mapea una fila del normalizer (setsToQuoteRows) → objeto del recordset
function toRecord(q) {
  return {
    data_provider: q.data_provider, sportsbook_code: q.sportsbook_code, external_event_id: q.external_event_id,
    market_family: q.market_family, period: q.period, external_outcome_id: q.external_outcome_id,
    sportsbook_name: q.sportsbook_name ?? null, operator_group: q.operator_group ?? null,
    independence_group: q.independence_group ?? null, source_role: q.source_role ?? 'market_consensus',
    jurisdiction: q.jurisdiction ?? null, is_live: q.is_live ?? false, odds_format: q.odds_format ?? 'decimal',
    odds_decimal: q.odds_decimal ?? null, implied_probability: q.implied_probability ?? null,
    raw_implied_probability: q.raw_implied_probability ?? q.implied_probability ?? null,
    quote_status: q.quote_status ?? 'open', stake_limit_status: q.stake_limit_status ?? 'unknown',
    maximum_stake: q.maximum_stake ?? null, external_market_id: q.external_market_id ?? null,
    provider_update: q.quote_timestamp ?? null, normalizer_version: q.normalizer_version ?? null,
    metadata: q.metadata ?? {},
  };
}

function sanitizeRowError(e) {
  const msg = String((e && e.message) || 'row_error').slice(0, 160);
  // nunca incluye valores de cuota ni la key; solo el código/tipo de error de Postgres
  return { code: (e && e.code) || 'row_error', detail: msg.replace(/\d{3,}/g, '·') };
}

// persistCurrentBatch(rows, runId) → métricas. rows = filas del normalizer (ya validadas semánticamente).
// Happy path: un upsert por chunk (sin N+1). Error de chunk: ROLLBACK + reintento fila-a-fila para AISLAR
// la fila mala (errores sanitizados), preservando el resto del lote.
async function persistCurrentBatch(rows, runId) {
  const out = { received: rows.length, validated: rows.length, inserted: 0, updated: 0, unchanged: 0, rejected: 0, history_written: 0, errors: [] };
  if (!rows.length) return out;
  if (!db.isConfigured()) { out.rejected = rows.length; out.errors.push({ code: 'no_db' }); return out; }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK).map(toRecord);
    try {
      const res = await db.withTransaction(async (c) => c.query(UPSERT_SQL, [JSON.stringify(slice), runId || null]));
      out.inserted += res.rows.filter(r => r.inserted).length;
    } catch (chunkErr) {
      // aislar la fila culpable sin abortar todo el lote
      for (const rec of slice) {
        try {
          const r = await db.withTransaction(async (c) => c.query(UPSERT_SQL, [JSON.stringify([rec]), runId || null]));
          if (r.rows[0] && r.rows[0].inserted) out.inserted++;
        } catch (rowErr) {
          out.rejected++;
          if (out.errors.length < 20) out.errors.push(sanitizeRowError(rowErr));
        }
      }
    }
  }

  // métricas derivadas de la history escrita por el trigger en este run
  if (runId) {
    try {
      const h = await db.query(
        `SELECT change_type, count(*)::int n FROM sportsbook_quote_history WHERE ingestion_run_id=$1 GROUP BY change_type`, [runId]);
      const by = h.rows.reduce((a, x) => (a[x.change_type] = x.n, a), {});
      out.history_written = h.rows.reduce((a, x) => a + x.n, 0);
      out.updated = (by.price || 0) + (by.status || 0) + (by.availability || 0);
      // 'new' (history) debe coincidir con inserted; unchanged = recibidas sin cambio material
      out.unchanged = Math.max(0, out.received - out.rejected - out.inserted - out.updated);
    } catch { /* métricas best-effort */ }
  } else {
    out.unchanged = Math.max(0, out.received - out.rejected - out.inserted - out.updated);
  }
  return out;
}

module.exports = { persistCurrentBatch, toRecord, UPSERT_SQL, _sanitizeRowError: sanitizeRowError };
