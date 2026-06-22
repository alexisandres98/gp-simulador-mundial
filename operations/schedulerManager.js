// operations/schedulerManager.js — gestiona los timers por job y el conteo de ejecuciones en vuelo
// (para drenar en shutdown). No conoce la lógica de cada job: delega en runner.runJob. (Sprint 8A §17)
'use strict';
const cfg = require('./config');
const { runJob } = require('./runner');

function createManager() {
  const timers = new Map();      // job_name -> interval handle
  const inFlight = new Set();     // job_names corriendo ahora
  let started = false;
  let draining = false;

  async function fire(job, isReady, runType = 'scheduled') {
    if (draining) return { job: job.job_name, status: 'skipped', reason: 'draining', ran: false };
    if (job.enabled && !job.enabled()) return { job: job.job_name, status: 'disabled', ran: false };
    if (inFlight.has(job.job_name)) return { job: job.job_name, status: 'skipped', reason: 'in_flight_local', ran: false };
    inFlight.add(job.job_name);
    try { return await runJob(job, { runType, isReady }); }
    finally { inFlight.delete(job.job_name); }
  }

  function start(jobs, isReady) {
    if (started) return { started: true, already: true };
    started = true; draining = false;
    for (const job of jobs) {
      if (!job.schedule_ms) continue;
      const h = setInterval(() => { fire(job, isReady).catch(() => {}); }, job.schedule_ms);
      if (h.unref) h.unref();
      timers.set(job.job_name, h);
    }
    return { started: true, scheduled: timers.size };
  }

  // detiene timers y espera (hasta drainMs) a que terminen los ticks en vuelo.
  async function stop() {
    draining = true;
    for (const h of timers.values()) clearInterval(h);
    timers.clear();
    const deadline = Date.now() + cfg.params.shutdownDrainMs;
    while (inFlight.size > 0 && Date.now() < deadline) { await new Promise(r => setTimeout(r, 100)); }
    started = false; draining = false;
    return { stopped: true, drained: inFlight.size === 0, pending: [...inFlight] };
  }

  return {
    start, stop, fire,
    status: () => ({ started, draining, scheduled: [...timers.keys()], inFlight: [...inFlight] }),
  };
}

module.exports = { createManager };
