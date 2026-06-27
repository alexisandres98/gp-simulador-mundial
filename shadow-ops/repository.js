// shadow-ops/repository.js — Fase N.1. Persistencia del lifecycle SHADOW + observabilidad/locks de jobs.
// INERTE salvo invocación. Append-only/idempotente. NO escribe en tablas oficiales.
'use strict';
const db = require('../database/client');

// ---------- jobs (observabilidad + lock anti-solape) ----------
async function acquireLock(jobName, ttlMs = 4 * 60 * 1000, holder = 'shadow', { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO shadow_job_locks (job_name, locked_at, locked_until, holder)
     VALUES ($1, now(), now() + ($2 || ' milliseconds')::interval, $3)
     ON CONFLICT (job_name) DO UPDATE SET locked_at=now(), locked_until=now() + ($2 || ' milliseconds')::interval, holder=$3
       WHERE shadow_job_locks.locked_until IS NULL OR shadow_job_locks.locked_until < now()
     RETURNING job_name`, [jobName, String(ttlMs), holder]);
  return !!r.rows[0];
}
async function releaseLock(jobName, { client = db } = {}) { await client.query(`UPDATE shadow_job_locks SET locked_until=now() WHERE job_name=$1`, [jobName]); }
async function startRun(jobName, { quotaBefore = null, client = db } = {}) {
  return (await client.query(`INSERT INTO shadow_job_runs (job_name, status, quota_before) VALUES ($1,'running',$2) RETURNING run_id`, [jobName, quotaBefore])).rows[0].run_id;
}
async function heartbeat(runId, { client = db } = {}) { await client.query(`UPDATE shadow_job_runs SET heartbeat_at=now() WHERE run_id=$1`, [runId]); }
async function finishRun(runId, { status = 'success', rows = 0, quotaAfter = null, requestsCharged = null, errorReason = null, metadata = {}, client = db } = {}) {
  await client.query(`UPDATE shadow_job_runs SET status=$2, finished_at=now(), duration_ms=EXTRACT(EPOCH FROM (now()-started_at))*1000,
     rows_processed=$3, quota_after=$4, requests_charged=$5, error_reason=$6, metadata=$7 WHERE run_id=$1`,
    [runId, status, rows, quotaAfter, requestsCharged, errorReason, JSON.stringify(metadata)]);
}
async function recentRuns({ limit = 40, client = db } = {}) {
  return (await client.query(`SELECT job_name,status,started_at,finished_at,duration_ms,rows_processed,requests_charged,error_reason FROM shadow_job_runs ORDER BY started_at DESC LIMIT $1`, [limit])).rows;
}

// ---------- closing / settlement / metrics shadow (idempotente por input_hash) ----------
async function recordClosing(c, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO shadow_closing_snapshots (canonical_event_id,subject_type,market_id,outcome,period_code,publication_at,
       closing_at,publication_probability,closing_probability,publication_odds,closing_fair_odds,price_clv,
       entry_vs_closing_gap,market_movement_no_vig,closing_status,input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [c.canonical_event_id || null, c.subject_type, c.market_id || null, c.outcome || null, c.period_code || 'REGULATION',
     c.publication_at || null, c.closing_at || null, c.publication_probability ?? null, c.closing_probability ?? null,
     c.publication_odds ?? null, c.closing_fair_odds ?? null, c.price_clv ?? null, c.entry_vs_closing_gap ?? null,
     c.market_movement_no_vig ?? null, c.closing_status || 'AVAILABLE', c.input_hash]);
  return r.rows[0] ? { row: r.rows[0], idempotent: false } : { row: (await client.query(`SELECT * FROM shadow_closing_snapshots WHERE input_hash=$1`, [c.input_hash])).rows[0], idempotent: true };
}
async function recordSettlement(s, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO shadow_settlements (canonical_event_id,subject_type,market_id,outcome,settlement_version,settlement_status,
       result_outcome,regulation_home_goals,regulation_away_goals,result_observed_at,input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [s.canonical_event_id || null, s.subject_type, s.market_id || null, s.outcome || null, s.settlement_version || 1,
     s.settlement_status || 'final', s.result_outcome || null, s.regulation_home_goals ?? null, s.regulation_away_goals ?? null,
     s.result_observed_at || null, s.input_hash]);
  return r.rows[0] ? { row: r.rows[0], idempotent: false } : { row: (await client.query(`SELECT * FROM shadow_settlements WHERE input_hash=$1`, [s.input_hash])).rows[0], idempotent: true };
}
async function recordMetricFact(f, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO shadow_metric_facts (canonical_event_id,model_label,subject_type,market_id,published_probability,
       closing_probability,result_outcome,brier_score,log_loss,clv_probability,input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [f.canonical_event_id || null, f.model_label, f.subject_type, f.market_id || null,
     JSON.stringify(f.published_probability || null), JSON.stringify(f.closing_probability || null),
     f.result_outcome || null, f.brier_score ?? null, f.log_loss ?? null, f.clv_probability ?? null, f.input_hash]);
  return r.rows[0] ? { row: r.rows[0], idempotent: false } : { row: (await client.query(`SELECT * FROM shadow_metric_facts WHERE input_hash=$1`, [f.input_hash])).rows[0], idempotent: true };
}

module.exports = { acquireLock, releaseLock, startRun, heartbeat, finishRun, recentRuns, recordClosing, recordSettlement, recordMetricFact };
