// metrics-engine/scheduler.js — Sprint 6 §36. Recalcula incremental con lock anti-solape. No corre sin cambios útiles.
'use strict';
const cfg = require('./config');
const rebuild = require('./rebuild');
const log = require('../database/logger');
const state = { started: false, timer: null, running: false, lastRunAt: null };

async function tick() {
  if (state.running) return { skipped: 'overlap' };
  state.running = true;
  try { const r = await rebuild.runLocked({ runType: 'incremental' }); state.lastRunAt = new Date().toISOString(); return r; }
  catch (e) { log.error('metrics: error en ciclo', { error: e.message }); return { error: 'cycle_error' }; }
  finally { state.running = false; }
}
function start() {
  if (state.started) return { started: true, alreadyRunning: true };
  if (!cfg.flags.schedulerEnabled) return { started: false, reason: 'scheduler_disabled' };
  state.started = true;
  state.timer = setInterval(() => { tick().catch(() => {}); }, cfg.params.intervalMs);
  if (state.timer.unref) state.timer.unref();
  log.info('metrics: scheduler iniciado', { intervalMs: cfg.params.intervalMs });
  return { started: true, intervalMs: cfg.params.intervalMs };
}
function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; state.started = false; return { started: false }; }
async function runOnce() { return tick(); }
module.exports = { start, stop, runOnce, status: () => ({ ...state, intervalMs: cfg.params.intervalMs }) };
