// tests/operations.test.js — Sprint 8A. Tests PUROS del orquestador (sin DB): config inerte por defecto,
// política de reintentos (backoff determinístico), grafo de dependencias (ciclos/topo/blocked), registry,
// y caminos del runner que no tocan DB (blocked antes del lock; skip si no hay DB). (§95 parcial)
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  // ---- config: INERTE por defecto (§20) ----
  delete process.env.OPERATIONS_ORCHESTRATOR_ENABLED;
  delete process.env.OPERATIONS_JOB_WRITES_ENABLED;
  const cfg = require(R + '/operations/config');
  ok('config: orquestador off por defecto', cfg.flags.orchestrator === false);
  ok('config: jobWrites off por defecto', cfg.flags.jobWrites === false);
  ok('config: admin off por defecto', cfg.flags.admin === false);
  process.env.OPERATIONS_ORCHESTRATOR_ENABLED = 'true';
  ok('config: jobWrites requiere su propio flag aunque orquestador on', cfg.flags.jobWrites === false);
  process.env.OPERATIONS_JOB_WRITES_ENABLED = 'true';
  ok('config: jobWrites on con ambos flags', cfg.flags.jobWrites === true);
  delete process.env.OPERATIONS_ORCHESTRATOR_ENABLED; delete process.env.OPERATIONS_JOB_WRITES_ENABLED;

  // ---- retries: backoff determinístico + clasificación ----
  const retries = require(R + '/operations/retries');
  ok('retries: auth no recuperable', retries.isRecoverable({ message: 'auth failed' }) === false);
  ok('retries: quota_exhausted no recuperable', retries.isRecoverable({ code: 'quota_exhausted' }) === false);
  ok('retries: timeout recuperable', retries.isRecoverable({ code: 'timeout' }) === true);
  ok('retries: ECONNREFUSED recuperable', retries.isRecoverable({ message: 'connect ECONNREFUSED' }) === true);
  const b1 = retries.backoffMs(2, 500, 'jobX'), b2 = retries.backoffMs(2, 500, 'jobX');
  ok('retries: backoff determinístico (misma semilla → mismo valor)', b1 === b2);
  ok('retries: backoff crece con el intento', retries.backoffMs(3, 500, 'jobX') > retries.backoffMs(1, 500, 'jobX'));
  ok('retries: backoff topado a 30s', retries.backoffMs(20, 5000, 'jobX') <= 30000);
  ok('retries: shouldRetry false si supera max', retries.shouldRetry({ code: 'timeout' }, 4, 2) === false);
  ok('retries: shouldRetry true dentro de max y recuperable', retries.shouldRetry({ code: 'timeout' }, 1, 2) === true);
  ok('retries: shouldRetry false si no recuperable', retries.shouldRetry({ message: 'unauthorized' }, 1, 2) === false);

  // ---- dependencyGraph ----
  const dg = require(R + '/operations/dependencyGraph');
  const acyclic = [{ job_name: 'a', dependencies: [] }, { job_name: 'b', dependencies: ['a'] }, { job_name: 'c', dependencies: ['b'] }];
  ok('depgraph: sin ciclo → null', dg.detectCycle(acyclic) === null);
  const cyclic = [{ job_name: 'a', dependencies: ['c'] }, { job_name: 'b', dependencies: ['a'] }, { job_name: 'c', dependencies: ['b'] }];
  ok('depgraph: detecta ciclo', Array.isArray(dg.detectCycle(cyclic)));
  ok('depgraph: topo respeta dependencias', (() => { const o = dg.topoOrder(acyclic); return o.indexOf('a') < o.indexOf('b') && o.indexOf('b') < o.indexOf('c'); })());
  ok('depgraph: checkDependencies ok cuando todo ready', dg.checkDependencies({ dependencies: ['a', 'b'] }, () => true).ok === true);
  const chk = dg.checkDependencies({ dependencies: ['a', 'b'] }, (d) => d === 'a');
  ok('depgraph: checkDependencies bloquea por la faltante', chk.ok === false && chk.blockedBy.join() === 'b');

  // ---- jobRegistry ----
  const { buildJobs, norm } = require(R + '/operations/jobRegistry');
  const jobs = buildJobs();
  ok('registry: registra 11 jobs', jobs.length === 11);
  ok('registry: cada job tiene run/enabled/deps', jobs.every(j => typeof j.run === 'function' && typeof j.enabled === 'function' && Array.isArray(j.dependencies)));
  ok('registry: value depende de canonical_matching + sportsbook_ingestion', (() => { const d = jobs.find(j => j.job_name === 'value_evaluation').dependencies; return d.includes('canonical_matching') && d.includes('sportsbook_ingestion'); })());
  ok('registry: el grafo del registry no tiene ciclos', dg.detectCycle(jobs) === null);
  ok('registry: norm extrae counts', norm({ created: 3, updated: 2 }).counts.created === 3);

  // ---- runner: caminos sin DB ----
  const runner = require(R + '/operations/runner');
  // blocked: se decide ANTES del lock → no necesita DB
  const blocked = await runner.runJob({ job_name: 'x', dependencies: ['dep1'], run: async () => ({}) }, { isReady: () => false });
  ok('runner: blocked cuando falta dependencia', blocked.status === 'blocked' && blocked.ran === false && blocked.blockedBy.join() === 'dep1');
  // sin DB el lock devuelve no_db → skipped (no ejecuta el job)
  let ranFlag = false;
  const skipped = await runner.runJob({ job_name: 'y', dependencies: [], run: async () => { ranFlag = true; return {}; } }, { isReady: () => true });
  ok('runner: sin DB → skipped (no corre el job)', skipped.ran === false && ranFlag === false);
  ok('runner: withTimeout rechaza al vencer', await (async () => { try { await runner.withTimeout(new Promise(r => setTimeout(r, 200)), 20); return false; } catch (e) { return e.code === 'timeout'; } })());
  ok('runner: safeError redacta y acota', (() => { const e = runner.safeError(new Error('x'.repeat(500))); return e.summary.length <= 300 && typeof e.code === 'string'; })());

  console.log(`\noperations (puros): ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
