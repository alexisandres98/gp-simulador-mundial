// value-engine/scheduler.js — Sprint 7 §52. Scheduler del Value Engine + monitor de precio de picks. Lock anti-solape.
// HOY no hay quotes reales de sportsbooks → el tick no encuentra mercados completos (consenso unavailable): seguro.
'use strict';
const cfg = require('./config');
const locks = require('../market-data/locks');
const repo = require('./repositories');
const log = require('../database/logger');
const state = { value: { started: false, timer: null, running: false }, monitor: { started: false, timer: null, running: false } };

// tick del Value Engine: procesa mercados con quotes nuevas. Requiere proveedor de sportsbooks (hoy ausente).
async function valueTick() {
  if (state.value.running) return { skipped: 'overlap' };
  state.value.running = true;
  try {
    return await locks.withLock(cfg.ADVISORY.value.resource, cfg.ADVISORY.value.op, async () => {
      // Fase J §4-7: tras una ingesta válida, refrescar la Candidate Factory (price state + lifecycle + readiness).
      // Aislado: una falla de la factory no rompe Value. Con 0 STRONG operativas → 0 candidates (correcto §1/§17).
      let candidates = null;
      try { candidates = await require('./candidateFactory').run({ now: Date.now() }); } catch (e) { candidates = { error: 'factory_error' }; }
      return { evaluated: 0, reason: 'no_sportsbook_quotes', candidates };
    });
  } catch (e) { log.error('value: error ciclo', { error: e.message }); return { error: 'cycle_error' }; }
  finally { state.value.running = false; }
}

// monitor de precio: marca price_moved las picks publicadas cuya cuota actual cae bajo el mínimo.
async function monitorTick() {
  if (state.monitor.running) return { skipped: 'overlap' };
  state.monitor.running = true;
  try {
    return await locks.withLock(cfg.ADVISORY.pickMonitor.resource, cfg.ADVISORY.pickMonitor.op, async () => {
      // (con feed real: comparar current_odds vs minimum_acceptable_odds y llamar picks.priceMoved)
      return { checked: 0 };
    });
  } catch (e) { return { error: 'cycle_error' }; } finally { state.monitor.running = false; }
}

function start() {
  const out = {};
  if (cfg.flags.valueScheduler && !state.value.started) {
    state.value.started = true; state.value.timer = setInterval(() => valueTick().catch(() => {}), cfg.params.valueEngineIntervalMs);
    if (state.value.timer.unref) state.value.timer.unref(); log.info('value: scheduler iniciado'); out.value = true;
  }
  if (cfg.flags.picksEnabled && !state.monitor.started) {
    state.monitor.started = true; state.monitor.timer = setInterval(() => monitorTick().catch(() => {}), cfg.params.valueEngineIntervalMs);
    if (state.monitor.timer.unref) state.monitor.timer.unref(); out.monitor = true;
  }
  return out;
}
function stop() { for (const k of ['value', 'monitor']) { if (state[k].timer) clearInterval(state[k].timer); state[k].timer = null; state[k].started = false; } return { stopped: true }; }
module.exports = { start, stop, valueTick, monitorTick, status: () => ({ value: state.value.started, monitor: state.monitor.started }) };
