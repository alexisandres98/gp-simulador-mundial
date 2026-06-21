// market-data/scheduler.js — planificador de ciclos de ingesta (Sprint 1).
// start/stop/runOnce/status. Intervalos por proveedor. ANTI-SOLAPE: si un ciclo tarda más que el
// intervalo, no se inicia otro idéntico (se registra como omitido). No dispersa setInterval por server.js.

'use strict';
const cfg = require('./config');
const pipeline = require('./pipeline');
const metrics = require('./metrics');
const log = require('../database/logger');

const state = { started: false, timers: {}, running: {}, lastSkip: {}, lastRunAt: {} };

async function tick(provider, opts = {}) {
  if (state.running[provider]) {
    state.lastSkip[provider] = new Date().toISOString();
    metrics.record(provider, { /* overlap */ });
    log.warn('scheduler: ciclo omitido por solape', { provider });
    return { provider, skipped: 'overlap' };
  }
  state.running[provider] = true;
  try {
    const res = await pipeline.runProviderCycle(provider, opts);
    state.lastRunAt[provider] = new Date().toISOString();
    return res;
  } catch (e) {
    log.error('scheduler: error en ciclo', { provider, error: e.message });
    return { provider, status: 'failed', error: 'cycle_error' };
  } finally {
    state.running[provider] = false;
  }
}

function start() {
  if (state.started) return { started: true, alreadyRunning: true };
  state.started = true;
  for (const p of cfg.PROVIDERS) {
    const interval = cfg.intervals[p] || 30000;
    state.timers[p] = setInterval(() => { tick(p).catch(() => {}); }, interval);
    if (state.timers[p].unref) state.timers[p].unref(); // no bloquear el cierre del proceso
  }
  log.info('scheduler: iniciado', { providers: cfg.PROVIDERS, intervals: cfg.intervals });
  return { started: true };
}

function stop() {
  for (const p of Object.keys(state.timers)) { clearInterval(state.timers[p]); delete state.timers[p]; }
  state.started = false;
  log.info('scheduler: detenido');
  return { started: false };
}

// runOnce(provider, opts) → resultado de un ciclo controlado (no inicia el scheduler permanente).
async function runOnce(provider, opts = {}) { return tick(provider, opts); }

function status() {
  return {
    started: state.started,
    providers: cfg.PROVIDERS.map(p => ({
      provider: p, running: !!state.running[p], intervalMs: cfg.intervals[p],
      lastRunAt: state.lastRunAt[p] || null, lastSkippedOverlapAt: state.lastSkip[p] || null,
      enabled: cfg.providerEnabled(p),
    })),
  };
}

module.exports = { start, stop, runOnce, status };
