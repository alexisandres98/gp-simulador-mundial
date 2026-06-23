// operations/orchestrator.js — fachada del orquestador de jobs (Sprint 8A §12). INERTE si
// OPERATIONS_ORCHESTRATOR_ENABLED=false (no arranca timers, no escribe). Coordina: registry + manager +
// runner + readiness de dependencias + boot report. No mueve lógica; llama a los servicios existentes.
'use strict';
const cfg = require('./config');
const { buildJobs } = require('./jobRegistry');
const { createManager } = require('./schedulerManager');
const { runJob } = require('./runner');
const depGraph = require('./dependencyGraph');
const jobRuns = require('./repositories/jobRunRepository');
const db = require('../database/client');
const log = require('../database/logger');

const manager = createManager();
let jobs = [];

// readiness de una dependencia: tuvo una ejecución 'success' reciente. Sin DB / jobWrites off → no bloquea
// (true) para conservar el comportamiento previo. (El freshness contract fino llega en el paso 3 de 8A.)
let readyCache = { at: 0, byName: {} };
function makeIsReady() {
  return (depName) => {
    if (!cfg.flags.jobWrites) return true;
    const e = readyCache.byName[depName];
    if (!e) return true; // sin datos aún → no bloquear de entrada
    return e === 'success';
  };
}
async function refreshReadiness() {
  if (!cfg.flags.jobWrites || !db.isConfigured()) return;
  try {
    const rows = await jobRuns.summary();
    readyCache = { at: Date.now(), byName: rows.reduce((a, r) => (a[r.job_name] = r.last_status, a), {}) };
  } catch { /* best-effort */ }
}

function start() {
  if (!cfg.flags.orchestrator) return { started: false, reason: 'orchestrator_disabled' };
  jobs = buildJobs();
  // allowlist (§12): si está configurada, el orquestador SOLO gestiona esos jobs (el resto siguen en sus
  // schedulers legacy). Permite activar sportsbook_ingestion sin tocar el pipeline de arbitraje vivo.
  const allow = cfg.params.managedJobs;
  if (allow.length) jobs = jobs.filter(j => allow.includes(j.job_name));
  const cycle = depGraph.detectCycle(jobs);
  if (cycle) { log.error('operations: ciclo en el grafo de jobs', { cycle }); return { started: false, reason: 'dependency_cycle', cycle }; }
  refreshReadiness().catch(() => {});
  const r = manager.start(jobs, makeIsReady());
  log.info('operations: orquestador iniciado', { scheduled: r.scheduled });
  return { started: true, ...r };
}

async function stop() {
  const r = await manager.stop();
  log.info('operations: orquestador detenido', { drained: r.drained, pending: r.pending });
  return r;
}

// ejecuta UN job a demanda (admin/CLI). runType='manual'. Funciona aunque el orquestador esté off.
async function runOnce(jobName, { runType = 'manual' } = {}) {
  const all = jobs.length ? jobs : buildJobs();
  const job = all.find(j => j.job_name === jobName);
  if (!job) return { status: 'unknown_job', jobName };
  await refreshReadiness();
  return runJob(job, { runType, isReady: makeIsReady() });
}

// status para admin/health. No ejecuta nada.
async function status() {
  const all = jobs.length ? jobs : buildJobs();
  const mgr = manager.status();
  const out = all.map(j => ({
    job_name: j.job_name, owner_module: j.owner_module, criticality: j.criticality,
    enabled: j.enabled ? !!j.enabled() : true, scheduled: mgr.scheduled.includes(j.job_name),
    in_flight: mgr.inFlight.includes(j.job_name), schedule_ms: j.schedule_ms || null,
    dependencies: j.dependencies || [],
  }));
  let runs = [], summary = [], dl = {};
  if (cfg.flags.jobWrites && db.isConfigured()) {
    try { summary = await jobRuns.summary(); } catch { /* noop */ }
    try { runs = await jobRuns.recent(null, cfg.params.recentRunsLimit); } catch { /* noop */ }
    try { dl = await require('./repositories/deadLetterRepository').counts(); } catch { /* noop */ }
  }
  return { orchestrator: mgr.started, draining: mgr.draining, flags: cfg.flags, jobs: out, summary, recent_runs: runs, dead_letters: dl, topo: depGraph.topoOrder(all) };
}

// boot report estructurado (§19). No imprime secretos.
async function bootReport() {
  const all = buildJobs();
  const health = await db.healthProbe().catch(() => ({ configured: false, connected: false }));
  return {
    db_connected: !!health.connected,
    db_configured: !!health.configured,
    orchestrator_enabled: cfg.flags.orchestrator,
    job_writes_enabled: cfg.flags.jobWrites,
    enabled_jobs: all.filter(j => !j.enabled || j.enabled()).map(j => j.job_name),
    disabled_jobs: all.filter(j => j.enabled && !j.enabled()).map(j => j.job_name),
    layer_version: cfg.LAYER_VERSION,
  };
}

module.exports = { start, stop, runOnce, status, bootReport, makeIsReady, refreshReadiness, _manager: manager };
