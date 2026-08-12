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
  // 12-ago: las cuotas de clubes (sweep de 38 ligas, ~46k upserts/40min) viven en la tabla goal y NADA la
  // podaba — el bloat ahogó Postgres (statement timeout en la query 1X2/goles → SOLID/GOALS sin nacer).
  // Las filas viejas son cuotas de eventos ya jugados: el consenso solo usa frescura <75min y el settle no
  // lee esta tabla. 7 días de margen conserva de sobra el CLV/closing (que se captura aparte en las picks).
  goal_current:     'sportsbook_goal_quote_current',
};
const DEFAULT_DAYS = { redundant_raw: 14, material_history: 180, goal_current: 7 };
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

// columna de tiempo por tabla (received_at para raw legacy, observed_at para history y goal)
function timeCol(table) { return table === 'sportsbook_quotes' ? 'received_at' : 'observed_at'; }

// best-effort: en una tabla ya ahogada el count(*) puede comerse el statement timeout — un conteo
// desconocido (null) no debe frenar la purga, que borra en lotes cortos que sí caben en el timeout.
async function countOlderThan(table, cutoff) {
  try {
    const r = await db.query(`SELECT count(*)::bigint n FROM ${table} WHERE ${timeCol(table)} < $1`, [cutoff]);
    return Number(r.rows[0].n);
  } catch { return null; }
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
let _running = null; // guarda anti-solape: el scheduler de 6h y el endpoint manual no deben correr a la vez
async function run(scope, { days = null, now = null, executedBy = null } = {}) {
  const table = ALLOWED_TABLES[scope];
  if (!table) { const e = new Error('invalid_retention_scope'); e.code = 'invalid_retention_scope'; throw e; }
  if (!db.isConfigured()) return { scope, status: 'skipped', reason: 'no_db' };
  if (_running) return { scope, status: 'skipped', reason: 'already_running', running_scope: _running };

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
  // 12-ago: la tabla goal llegó a 14.6M filas / 6.6GB y el lote moría por el statement timeout GLOBAL (15s):
  // el sub-select por ctid hacía seq scan sin índice por la columna de tiempo. Ahora (a) antes del primer
  // lote se asegura el índice por esa columna (IF NOT EXISTS, idempotente — con los sweeps pausados por
  // créditos es el momento barato de crearlo), y (b) cada lote corre en SU transacción con SET LOCAL
  // statement_timeout amplio: el timeout global corto sigue protegiendo al resto de la app.
  _running = scope;
  try {
    let deleted = 0;
    await db.withTransaction(async (c) => {
      await c.query(`SET LOCAL statement_timeout = '600s'`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_retention_${table}_time ON ${table} (${timeCol(table)})`);
    }).catch(() => { /* índice best-effort: sin él los lotes igual corren (más lentos) */ });
    for (;;) {
      const r = await db.withTransaction(async (c) => {
        await c.query(`SET LOCAL statement_timeout = '300s'`);
        return c.query(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${timeCol(table)} < $1 LIMIT ${DELETE_BATCH})`, [cutoff]);
      });
      deleted += r.rowCount;
      if (r.rowCount < DELETE_BATCH) break;
    }
    await audit({ mode: 'execute', table, scope, cutoff, considered, deleted, executedBy, note: 'incremental_batch' });
    return { scope, table, status: 'executed', cutoff, rows_considered: considered, rows_deleted: deleted };
  } finally { _running = null; }
}

// projection(now) — proyección de storage para el reporte (sin borrar nada).
async function projection({ now = null } = {}) {
  if (!db.isConfigured()) return { status: 'no_db' };
  // reltuples (estimación del planner) en vez de count(*): en tablas con bloat el count exacto puede
  // exceder el statement timeout — para una proyección de storage la estimación sirve igual.
  const sizes = await db.query(`
    SELECT relname t, reltuples::bigint n, pg_total_relation_size(oid) bytes
      FROM pg_class
     WHERE relname IN ('sportsbook_quotes','sportsbook_quote_current','sportsbook_quote_history','sportsbook_goal_quote_current')`);
  return {
    status: 'ok',
    counts: sizes.rows.reduce((a, x) => (a[x.t] = Number(x.n), a), {}),
    bytes: sizes.rows.reduce((a, x) => (a[x.t] = Number(x.bytes), a), {}),
    flags: flags(),
  };
}

module.exports = { run, projection, flags, ALLOWED_TABLES, DEFAULT_DAYS };
