// operations/repositories/jobRunRepository.js — persistencia de operational_job_runs (Sprint 8A).
// Todas las escrituras son best-effort y SOLO si jobWrites está activo (el caller decide). error_summary
// se redacta arriba (runner) — aquí nunca se concatenan secretos.
'use strict';
const db = require('../../database/client');

async function create({ jobName, runType = 'scheduled', scheduledFor = null, attempt = 1, lockAcquired = false, status = 'running', metadata = {} }) {
  const r = await db.query(
    `INSERT INTO operational_job_runs (job_name, run_type, status, scheduled_for, started_at, heartbeat_at, attempt, lock_acquired, metadata)
     VALUES ($1,$2,$3,$4, now(), now(), $5,$6,$7) RETURNING *`,
    [jobName, runType, status, scheduledFor, attempt, lockAcquired, JSON.stringify(metadata || {})]
  );
  return r.rows[0];
}

async function heartbeat(id) {
  await db.query(`UPDATE operational_job_runs SET heartbeat_at = now() WHERE id = $1 AND status = 'running'`, [id]);
}

async function finish(id, { status, counts = {}, errorCode = null, errorSummary = null, metadata = null }) {
  const c = counts || {};
  await db.query(
    `UPDATE operational_job_runs
       SET status=$2, finished_at=now(), heartbeat_at=now(),
           records_scanned=$3, records_created=$4, records_updated=$5, records_skipped=$6,
           error_code=$7, error_summary=$8,
           metadata = CASE WHEN $9::jsonb IS NULL THEN metadata ELSE metadata || $9::jsonb END,
           duration_ms = CASE WHEN started_at IS NOT NULL THEN (EXTRACT(EPOCH FROM (now()-started_at))*1000)::int ELSE NULL END
     WHERE id=$1`,
    [id, status, c.scanned || 0, c.created || 0, c.updated || 0, c.skipped || 0, errorCode, errorSummary, metadata ? JSON.stringify(metadata) : null]
  );
}

// Marca como 'stale' las runs 'running' cuyo heartbeat superó staleAfterMs. Devuelve cuántas. No borra.
async function markStale(jobName, staleAfterMs) {
  const r = await db.query(
    `UPDATE operational_job_runs SET status='stale', finished_at=now(), error_code='stale'
       WHERE status='running' AND ($1::text IS NULL OR job_name=$1)
         AND heartbeat_at < now() - ($2::int || ' milliseconds')::interval
     RETURNING id`,
    [jobName || null, staleAfterMs]
  );
  return r.rowCount;
}

// ¿Hay una run sana (running + heartbeat fresco) para este job? Evita lanzar otra encima.
async function hasHealthyRunning(jobName, staleAfterMs) {
  const r = await db.query(
    `SELECT 1 FROM operational_job_runs
       WHERE job_name=$1 AND status='running'
         AND heartbeat_at >= now() - ($2::int || ' milliseconds')::interval
       LIMIT 1`,
    [jobName, staleAfterMs]
  );
  return r.rowCount > 0;
}

async function recent(jobName, limit = 20) {
  const r = await db.query(
    `SELECT * FROM operational_job_runs WHERE ($1::text IS NULL OR job_name=$1)
       ORDER BY created_at DESC LIMIT $2`,
    [jobName || null, limit]
  );
  return r.rows;
}

// Resumen por job: último estado + última ejecución + tasa de éxito reciente.
async function summary() {
  const r = await db.query(
    `SELECT job_name,
            max(created_at) AS last_run_at,
            (array_agg(status ORDER BY created_at DESC))[1] AS last_status,
            count(*) FILTER (WHERE status='success' AND created_at > now()-interval '24 hours') AS successes_24h,
            count(*) FILTER (WHERE status IN ('failed','timed_out','stale') AND created_at > now()-interval '24 hours') AS failures_24h
       FROM operational_job_runs GROUP BY job_name ORDER BY job_name`
  );
  return r.rows;
}

module.exports = { create, heartbeat, finish, markStale, hasHealthyRunning, recent, summary };
