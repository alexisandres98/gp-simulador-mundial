// operations/runner.js — ejecuta UN job de forma segura (Sprint 8A). Corazón del orquestador.
// Garantías: 1 advisory lock por job (anti-doble-ejecución entre instancias), registro de run con
// heartbeat, timeout duro, reintentos con backoff (solo errores recuperables), dependencias verificadas
// (blocked si falta una), error_summary REDACTADO. Degrada con seguridad: sin DB o con jobWrites off
// ejecuta igual pero no persiste el run (no rompe la app).
'use strict';
const cfg = require('./config');
const locks = require('../market-data/locks');
const retries = require('./retries');
const jobRuns = require('./repositories/jobRunRepository');
const { redact } = require('../database/logger');

function safeError(err) {
  const code = (err && err.code) || null;
  const msg = redact(String((err && err.message) || err || 'error')).toString().slice(0, 300);
  return { code: code ? String(code).slice(0, 60) : (msg.split(/\s/)[0] || 'error').slice(0, 60), summary: msg };
}

function withTimeout(promise, ms, onTimeoutCode = 'timeout') {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => { const e = new Error('timed_out'); e.code = onTimeoutCode; rej(e); }, ms); });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

// runJob(job, { runType, isReady }) → resultado estructurado. NUNCA lanza (el orquestador no debe caerse).
// job: { job_name, run, lock_key, timeout_ms, retry_policy:{max,backoffBaseMs}, stale_after_ms, dependencies }
async function runJob(job, { runType = 'scheduled', isReady = () => true } = {}) {
  const flags = cfg.flags;
  const params = cfg.params;
  const write = flags.jobWrites; // ¿persistimos runs?
  const staleAfter = job.stale_after_ms || params.defaultStaleAfterMs;

  // 1) dependencias
  const deps = job.dependencies || [];
  const blockedBy = deps.filter(d => !isReady(d));
  if (blockedBy.length) return { job: job.job_name, status: 'blocked', blockedBy, ran: false };

  // 2) lock — el lock_key se descompone en (provider, jobType) reutilizando market-data/locks
  const [prov, jt] = (job.lock_key || job.job_name + '-run').split('::').length === 2
    ? job.lock_key.split('::') : [job.job_name, 'run'];

  const lockOutcome = await locks.withLock(prov, jt, async () => {
    // dentro del lock: si ya hay una run sana en curso (otra instancia que tomó el lock antes), saltar
    if (write) {
      try { if (await jobRuns.hasHealthyRunning(job.job_name, staleAfter)) return { status: 'skipped_running' }; } catch { /* sin DB → seguir */ }
      try { await jobRuns.markStale(job.job_name, staleAfter); } catch { /* best-effort */ }
    }
    let runId = null;
    if (write) { try { const r = await jobRuns.create({ jobName: job.job_name, runType, lockAcquired: true }); runId = r.id; } catch { /* persistencia best-effort */ } }

    // heartbeat mientras corre
    let hb = null;
    if (runId) hb = setInterval(() => { jobRuns.heartbeat(runId).catch(() => {}); }, params.heartbeatIntervalMs);

    const maxRetries = (job.retry_policy && job.retry_policy.max != null) ? job.retry_policy.max : params.defaultMaxRetries;
    const baseMs = (job.retry_policy && job.retry_policy.backoffBaseMs) || params.defaultBackoffBaseMs;
    const timeoutMs = job.timeout_ms || params.defaultTimeoutMs;

    let attempt = 1, lastErr = null, result = null, ok = false;
    for (;;) {
      try {
        result = await withTimeout(Promise.resolve().then(() => job.run({ runType, attempt })), timeoutMs);
        ok = true; break;
      } catch (err) {
        lastErr = err;
        if (!retries.shouldRetry(err, attempt, maxRetries)) break;
        const wait = retries.backoffMs(attempt + 1, baseMs, job.job_name);
        await new Promise(r => setTimeout(r, wait));
        attempt++;
        if (runId) { try { await jobRuns.heartbeat(runId); } catch { /* noop */ } }
      }
    }
    if (hb) clearInterval(hb);

    if (ok) {
      const counts = (result && result.counts) || {};
      if (runId) { try { await jobRuns.finish(runId, { status: 'success', counts, metadata: result && result.meta ? { result: redact(result.meta) } : null }); } catch { /* noop */ } }
      return { status: 'success', attempt, result };
    }
    const e = safeError(lastErr);
    const status = /timed_out|timeout/i.test(e.code) ? 'timed_out' : 'failed';
    if (runId) { try { await jobRuns.finish(runId, { status, errorCode: e.code, errorSummary: e.summary }); } catch { /* noop */ } }
    return { status, attempt, errorCode: e.code, errorSummary: e.summary, recoverable: retries.isRecoverable(lastErr) };
  });

  if (!lockOutcome.acquired) return { job: job.job_name, status: 'skipped', reason: lockOutcome.skipped, ran: false };
  const r = lockOutcome.result || {};
  if (r.status === 'skipped_running') return { job: job.job_name, status: 'skipped', reason: 'already_running', ran: false };
  return { job: job.job_name, ...r, ran: true };
}

module.exports = { runJob, safeError, withTimeout };
