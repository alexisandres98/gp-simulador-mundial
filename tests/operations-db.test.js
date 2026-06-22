// tests/operations-db.test.js — Sprint 8A. Orquestador contra PostgreSQL real (embedded-postgres).
// Cubre §95/§96 parcial: migración 016, job runs (create/heartbeat/finish/stale/summary), dead letters
// (dedup), runner (success/retry/non-recoverable/timeout), recuperación de stale, anti-doble-ejecución,
// scheduler manager start/stop con drenado.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.OPERATIONS_ORCHESTRATOR_ENABLED = 'true';
process.env.OPERATIONS_JOB_WRITES_ENABLED = 'true';
process.env.OPERATIONS_STALE_AFTER_MS = '300';     // stale rápido para el test
process.env.OPERATIONS_HEARTBEAT_INTERVAL_MS = '50';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const h = await boot();
  const db = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const jobRuns = require(R + '/operations/repositories/jobRunRepository');
  const deadLetters = require(R + '/operations/repositories/deadLetterRepository');
  const runner = require(R + '/operations/runner');
  const heartbeats = require(R + '/operations/heartbeats');
  const { createManager } = require(R + '/operations/schedulerManager');

  try {
    await migrate.up();
    const t = await db.query(`SELECT to_regclass('operational_job_runs') a, to_regclass('operational_dead_letters') b, to_regclass('admin_audit_events') c`);
    ok('migración 016: tablas creadas', t.rows[0].a && t.rows[0].b && t.rows[0].c);

    // ---- jobRunRepository ----
    const run = await jobRuns.create({ jobName: 'jobA', lockAcquired: true });
    ok('jobRuns.create → running', run.status === 'running' && run.job_name === 'jobA');
    await jobRuns.heartbeat(run.id);
    await jobRuns.finish(run.id, { status: 'success', counts: { scanned: 5, created: 2 } });
    const recent = await jobRuns.recent('jobA', 5);
    ok('jobRuns.finish → success + counts + duration', recent[0].status === 'success' && recent[0].records_created === 2 && recent[0].duration_ms != null);
    const summary = await jobRuns.summary();
    ok('jobRuns.summary agrega por job', summary.find(s => s.job_name === 'jobA').successes_24h >= 1);

    // hasHealthyRunning + markStale
    const r2 = await jobRuns.create({ jobName: 'jobStale', lockAcquired: true });
    ok('hasHealthyRunning true con run fresca', await jobRuns.hasHealthyRunning('jobStale', 5000) === true);
    await sleep(400); // supera OPERATIONS_STALE_AFTER_MS=300
    const swept = await jobRuns.markStale('jobStale', 300);
    ok('markStale marca abandonada (no borra)', swept === 1);
    const after = await jobRuns.recent('jobStale', 1);
    ok('run stale conserva la fila con status=stale', after[0].status === 'stale' && after[0].id === r2.id);
    ok('hasHealthyRunning false tras stale', await jobRuns.hasHealthyRunning('jobStale', 300) === false);

    // ---- deadLetterRepository: dedup incrementa attempts ----
    const dl1 = await deadLetters.record({ jobName: 'jobA', entityType: 'quote', entityId: 'q1', errorCode: 'invalid', safePayload: { k: 1 } });
    const dl2 = await deadLetters.record({ jobName: 'jobA', entityType: 'quote', entityId: 'q1', errorCode: 'invalid', safePayload: { k: 2 } });
    ok('deadLetters dedup por (job,entity) incrementa attempts', dl1.id === dl2.id && dl2.attempts === 2);
    const resolved = await deadLetters.setStatus(dl1.id, 'resolved', 'arreglado');
    ok('deadLetters setStatus resolved con resolved_at', resolved.status === 'resolved' && resolved.resolved_at != null);
    const c = await deadLetters.counts();
    ok('deadLetters counts agrupa por status', (c.resolved || 0) >= 1);

    // ---- runner.runJob: SUCCESS persiste run ----
    let calls = 0;
    const okJob = { job_name: 'rj_ok', dependencies: [], run: async () => { calls++; return { counts: { scanned: 3, created: 1 } }; } };
    const rOk = await runner.runJob(okJob, { isReady: () => true });
    ok('runner success: ran + status success', rOk.ran === true && rOk.status === 'success');
    const okRun = (await jobRuns.recent('rj_ok', 1))[0];
    ok('runner success: run persistido con success', okRun && okRun.status === 'success' && okRun.lock_acquired === true);

    // ---- runner.runJob: RETRY recuperable luego success ----
    let n = 0;
    const retryJob = { job_name: 'rj_retry', dependencies: [], retry_policy: { max: 2, backoffBaseMs: 1 },
      run: async () => { n++; if (n === 1) { const e = new Error('connect ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } return { counts: {} }; } };
    const rRetry = await runner.runJob(retryJob, { isReady: () => true });
    ok('runner retry: reintenta error recuperable y termina success', rRetry.status === 'success' && rRetry.attempt === 2 && n === 2);

    // ---- runner.runJob: NO recuperable → failed sin reintentar ----
    let m = 0;
    const authJob = { job_name: 'rj_auth', dependencies: [], retry_policy: { max: 3, backoffBaseMs: 1 },
      run: async () => { m++; const e = new Error('unauthorized'); e.code = 'unauthorized'; throw e; } };
    const rAuth = await runner.runJob(authJob, { isReady: () => true });
    ok('runner no-recuperable: failed sin reintentos', rAuth.status === 'failed' && m === 1 && rAuth.recoverable === false);
    const authRun = (await jobRuns.recent('rj_auth', 1))[0];
    ok('runner failed: run persistido con error_code redactado', authRun.status === 'failed' && authRun.error_code && !/postgres|password/i.test(authRun.error_summary || ''));

    // ---- runner.runJob: TIMEOUT (max=0 → no reintenta) → timed_out ----
    const toJob = { job_name: 'rj_to', dependencies: [], timeout_ms: 40, retry_policy: { max: 0, backoffBaseMs: 1 },
      run: async () => { await sleep(300); return {}; } };
    const rTo = await runner.runJob(toJob, { isReady: () => true });
    ok('runner timeout: status timed_out', rTo.status === 'timed_out');

    // ---- anti-doble-ejecución: con una run sana en curso, runJob salta ----
    await jobRuns.create({ jobName: 'rj_busy', lockAcquired: true }); // run "viva" (heartbeat fresco)
    let busyRan = false;
    const busyJob = { job_name: 'rj_busy', dependencies: [], run: async () => { busyRan = true; return {}; } };
    const rBusy = await runner.runJob(busyJob, { isReady: () => true });
    ok('anti-doble-ejecución: salta si ya hay run sana', rBusy.ran === false && busyRan === false && rBusy.reason === 'already_running');

    // ---- heartbeats.recoverStale ----
    await jobRuns.create({ jobName: 'rj_recover', lockAcquired: true });
    await sleep(400);
    const rec = await heartbeats.recoverStale(300);
    ok('heartbeats.recoverStale barre abandonadas', rec.swept >= 1);

    // ---- schedulerManager: start/stop con drenado ----
    const mgr = createManager();
    let fired = 0;
    const fakeJobs = [{ job_name: 'sm_job', schedule_ms: 50, enabled: () => true, dependencies: [], run: async () => { fired++; return {}; } }];
    mgr.start(fakeJobs, () => true);
    ok('schedulerManager: start agenda el job', mgr.status().scheduled.includes('sm_job'));
    await sleep(160);
    const st = await mgr.stop();
    ok('schedulerManager: stop drena y limpia timers', st.stopped === true && mgr.status().scheduled.length === 0);
    ok('schedulerManager: el job corrió al menos una vez', fired >= 1);
    // disabled → no corre
    const dmgr = createManager();
    const fired2 = { n: 0 };
    const off = await dmgr.fire({ job_name: 'sm_off', enabled: () => false, dependencies: [], run: async () => { fired2.n++; return {}; } }, () => true);
    ok('schedulerManager: job disabled no corre', off.status === 'disabled' && fired2.n === 0);
  } catch (e) {
    fail++; console.log('  ✗ excepción', e && e.stack || e);
  } finally {
    try { await db.close(); } catch { /* noop */ }
    await h.stop();
  }
  console.log(`\noperations-db: ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
