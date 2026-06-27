// value-engine/scheduler.js — Sprint 7 §52. Scheduler del Value Engine + monitor de precio de picks. Lock anti-solape.
// HOY no hay quotes reales de sportsbooks → el tick no encuentra mercados completos (consenso unavailable): seguro.
'use strict';
const cfg = require('./config');
const locks = require('../market-data/locks');
const repo = require('./repositories');
const log = require('../database/logger');
const state = { value: { started: false, timer: null, running: false }, monitor: { started: false, timer: null, running: false } };

// Fase J.1: resolver oficial V1 inyectado desde server.js (donde viven engine + db.elos). Sin él, Value no evalúa
// (no se inventa GP). gpResolver({canonicalEventId,label,meta}) → { probabilities:{home,draw,away}, model_version, ... } | null.
let _gpResolver = null;
function setGpResolver(fn) { _gpResolver = fn; }

// tick del Value Engine (Fase J.1): tras una ingesta fresh/exitosa → V1 evalúa eventos canónicos elegibles
// (internal_operational) → persiste → Candidate Factory. Orden garantizado: Value ANTES de la Factory. Lock
// anti-solape. Aislado: una falla de Value no rompe la Factory y viceversa. Sin gpResolver → no evalúa.
async function valueTick() {
  if (state.value.running) return { skipped: 'overlap' };
  state.value.running = true;
  try {
    return await locks.withLock(cfg.ADVISORY.value.resource, cfg.ADVISORY.value.op, async () => {
      const startedAt = Date.now();
      let value = null;
      if (_gpResolver) {
        // runOperational tiene su propio gate de frescura (no evalúa sobre ingesta stale/failed) + idempotencia por input_hash.
        try { value = await require('../sportsbook-providers/valueDryRun').runOperational({ gpResolver: _gpResolver, now: Date.now() }); }
        catch (e) { log.error('value: error operational', { error: e.message }); value = { error: 'operational_error' }; }
      } else { value = { skipped: true, reason: 'no_gp_resolver' }; }
      // Candidate Factory DESPUÉS de persistir las evaluaciones (orden §3). Aislado.
      let candidates = null;
      try { candidates = await require('./candidateFactory').run({ now: Date.now() }); } catch (e) { candidates = { error: 'factory_error' }; }
      state.value.lastRunAt = new Date().toISOString();
      return { value, candidates, duration_ms: Date.now() - startedAt };
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
module.exports = { start, stop, valueTick, monitorTick, setGpResolver, hasGpResolver: () => !!_gpResolver, status: () => ({ value: state.value.started, monitor: state.monitor.started, gp_resolver_wired: !!_gpResolver, last_run_at: state.value.lastRunAt || null }) };
