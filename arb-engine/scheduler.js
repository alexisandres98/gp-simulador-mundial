// arb-engine/scheduler.js — planificador shadow del motor (Sprint 3). Lock advisory 'arb-engine-evaluate'.
// No publica nada. Anti-solape. No tiene sentido correr más rápido que la llegada de datos nuevos.
'use strict';
const cfg = require('./config');
const locks = require('../market-data/locks'); // reutiliza advisory locks de Sprint 1
const log = require('../database/logger');

const state = { started: false, timer: null, running: false, lastRunAt: null };

async function tick(opts = {}) {
  if (state.running) { log.warn('arb: ciclo omitido por solape'); return { skipped: 'overlap' }; }
  state.running = true;
  try {
    const lr = await locks.withLock('arb-engine', 'evaluate', async () => {
      const candidates = await require('./candidateGenerator').generateFromDB().catch(() => []);
      return require('./index').runShadow({ candidates });
    });
    state.lastRunAt = new Date().toISOString();
    if (!lr.acquired) return { skipped: lr.skipped };
    return lr.result;
  } catch (e) { log.error('arb: error en ciclo', { error: e.message }); return { error: 'cycle_error' }; }
  finally { state.running = false; }
}

function start() {
  if (state.started) return { started: true, alreadyRunning: true };
  if (!cfg.flags.schedulerEnabled) return { started: false, reason: 'scheduler_disabled' };
  state.started = true;
  state.timer = setInterval(() => { tick().catch(() => {}); }, cfg.params.intervalMs);
  if (state.timer.unref) state.timer.unref();
  log.info('arb: scheduler iniciado (shadow)', { intervalMs: cfg.params.intervalMs });
  return { started: true };
}
function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; state.started = false; return { started: false }; }
async function runOnce(opts) { return tick(opts); }
function status() { return { started: state.started, running: state.running, lastRunAt: state.lastRunAt, intervalMs: cfg.params.intervalMs, enabled: cfg.flags.schedulerEnabled }; }

module.exports = { start, stop, runOnce, status };
