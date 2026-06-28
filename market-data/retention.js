// market-data/retention.js — Poda periódica de la TELEMETRÍA SHADOW (market-data + arb-engine) para que la DB
// no se llene (incidente jun-28: 14GB en raw_market_snapshots/orderbook/arb_evaluations). Borra por antigüedad;
// las FK ON DELETE limpian las dependientes: normalized_market_snapshots → CASCADE a normalized_orderbook_levels,
// arb_evaluations → CASCADE a arb_evaluation_legs. Es telemetría regenerable: el motor solo necesita lo RECIENTE.
// Gateada por GP_TELEMETRY_RETENTION_ENABLED (default false). Best-effort, aislada, idempotente.
'use strict';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

function enabled() { return bool(process.env.GP_TELEMETRY_RETENTION_ENABLED, false); }
function windowHours() { return num(process.env.GP_TELEMETRY_RETENTION_HOURS, 12); }

// pruneTelemetry(db) — borra filas más viejas que la ventana. db = cliente con .query (pool del proyecto).
async function pruneTelemetry(db) {
  if (!enabled()) return { skipped: true, reason: 'disabled' };
  const hours = windowHours();
  const cutoff = `now() - interval '${hours} hours'`;
  const out = { window_hours: hours };
  const del = async (key, sql) => { try { const r = await db.query(sql); out[key] = r.rowCount; } catch (e) { out[key] = 'err:' + e.message; } };
  // normalized primero (CASCADE poda normalized_orderbook_levels, la tabla más grande), luego raw, luego arb.
  await del('normalized_market_snapshots', `DELETE FROM normalized_market_snapshots WHERE created_at < ${cutoff}`);
  await del('raw_market_snapshots', `DELETE FROM raw_market_snapshots WHERE created_at < ${cutoff}`);
  await del('arb_evaluations', `DELETE FROM arb_evaluations WHERE created_at < ${cutoff}`);
  out.ran_at = new Date().toISOString();
  return out;
}

module.exports = { pruneTelemetry, enabled, windowHours };
