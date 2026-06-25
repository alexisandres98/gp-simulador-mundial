// sportsbook-providers/retention.js — Post-shadow Bloque B. Retención de almacenamiento de cuotas.
// PRINCIPIOS (spec §5): toda purga es configurable, incremental, auditable, PAUSADA POR DEFECTO, protegida
// por feature flag, e INCAPAZ de tocar señales/closing/datos oficiales. NO destruye los 283k raw legacy sin
// reporte: dry-run cuenta; execute solo borra si AMBOS flags lo permiten, en lotes, registrando cada acción.
'use strict';
const db = require('../database/client');
const cfg = require('./config');

// SOLO estas tablas pueden ser objeto de retención (defensa: nunca señales/value/picks/closing/oficiales).
const ALLOWED_TABLES = {
  redundant_raw:    'sportsbook_quotes',          // snapshots completos legacy (la causa del bloat)
  material_history: 'sportsbook_quote_history',   // historia material (retención larga)
};
const DEFAULT_DAYS = { redundant_raw: 14, material_history: 180 };
const DELETE_BATCH = 5000;

function flags() {
  return {
    enabled: cfg.bool(process.env.SPORTSBOOK_RETENTION_ENABLED, false),
    dryRun: cfg.bool(process.env.SPORTSBOOK_RETENTION_DRY_RUN, true),  // por defecto: solo simula
  };
}

function cutoffISO(days, now) {
  const t = (now != null ? +new Date(now) : Date.now()) - days * 86400000;
  return new Date(t).toISOString();
}

// columna de tiempo por tabla (received_at para raw legacy, observed_at para history)
function timeCol(table) { return table === 'sportsbook_quote_history' ? 'observed_at' : 'received_at'; }

async function countOlderThan(table, cutoff) {
  const r = await db.query(`SELECT count(*)::bigint n FROM ${table} WHERE ${timeCol(table)} < $1`, [cutoff]);
  return Number(r.rows[0].n);
}

async function audit({ mode, table, scope, cutoff, considered, deleted, executedBy, note }) {
  try {
    await db.query(
      `INSERT INTO sportsbook_retention_audit (mode, target_table, scope, cutoff_at, rows_considered, rows_deleted, flags_snapshot, executed_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [mode, table, scope, cutoff, considered, deleted, JSON.stringify(flags()), executedBy || null, note || null]);
  } catch { /* auditoría best-effort, nunca bloquea */ }
}

// run(scope, { days, now, executedBy }) — planifica y, si está habilitado, ejecuta la purga incremental.
async function run(scope, { days = null, now = null, executedBy = null } = {}) {
  const table = ALLOWED_TABLES[scope];
  if (!table) { const e = new Error('invalid_retention_scope'); e.code = 'invalid_retention_scope'; throw e; }
  if (!db.isConfigured()) return { scope, status: 'skipped', reason: 'no_db' };

  const f = flags();
  const d = days != null ? days : DEFAULT_DAYS[scope];
  const cutoff = cutoffISO(d, now);
  const considered = await countOlderThan(table, cutoff);

  // DRY-RUN: por flag global o por scope (siempre que enabled=false o dryRun=true)
  if (!f.enabled || f.dryRun) {
    await audit({ mode: 'dry_run', table, scope, cutoff, considered, deleted: 0, executedBy, note: f.enabled ? 'dry_run_flag' : 'retention_disabled' });
    return { scope, table, status: 'dry_run', cutoff, rows_considered: considered, rows_deleted: 0, reason: f.enabled ? 'dry_run' : 'disabled' };
  }

  // EXECUTE: incremental, en lotes, auditado. Nunca toca otras tablas (table viene del allowlist).
  let deleted = 0;
  for (;;) {
    const r = await db.query(
      `DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${timeCol(table)} < $1 LIMIT ${DELETE_BATCH})`, [cutoff]);
    deleted += r.rowCount;
    if (r.rowCount < DELETE_BATCH) break;
  }
  await audit({ mode: 'execute', table, scope, cutoff, considered, deleted, executedBy, note: 'incremental_batch' });
  return { scope, table, status: 'executed', cutoff, rows_considered: considered, rows_deleted: deleted };
}

// projection(now) — proyección de storage para el reporte (sin borrar nada).
async function projection({ now = null } = {}) {
  if (!db.isConfigured()) return { status: 'no_db' };
  const sizes = await db.query(`
    SELECT 'sportsbook_quotes' t, count(*)::bigint n FROM sportsbook_quotes
    UNION ALL SELECT 'sportsbook_quote_current', count(*)::bigint FROM sportsbook_quote_current
    UNION ALL SELECT 'sportsbook_quote_history', count(*)::bigint FROM sportsbook_quote_history`);
  return { status: 'ok', counts: sizes.rows.reduce((a, x) => (a[x.t] = Number(x.n), a), {}), flags: flags() };
}

module.exports = { run, projection, flags, ALLOWED_TABLES, DEFAULT_DAYS };
