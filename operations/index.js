// operations/index.js — fachada de la capa de operaciones (Sprint 8A). Punto único de integración para
// server.js. INERTE si OPERATIONS_ORCHESTRATOR_ENABLED=false.
'use strict';
const cfg = require('./config');
const orchestrator = require('./orchestrator');
const shutdown = require('./shutdown');
const health = require('./health');
const heartbeats = require('./heartbeats');
const jobRegistry = require('./jobRegistry');
const log = require('../database/logger');

// initialize() — se llama en el boot del server. Best-effort y aislada (un fallo no afecta al flujo
// principal). Con el orquestador apagado, no arranca nada y deja el manejo de señales intacto.
async function initialize() {
  if (!cfg.flags.orchestrator) return { started: false, reason: 'orchestrator_disabled' };
  try {
    const report = await orchestrator.bootReport();
    log.info('operations: boot report', report);
    const r = orchestrator.start();
    // apagado ordenado: drena jobs antes de cerrar el pool
    shutdown.install({ stopFns: [() => orchestrator.stop()] });
    // recuperación inicial de runs abandonadas tras un restart
    heartbeats.recoverStale().catch(() => {});
    return { started: r.started, ...report };
  } catch (e) {
    log.warn('operations: initialize falló (aislado)', { error: String(e && e.message) });
    return { started: false, error: 'init_failed' };
  }
}

module.exports = {
  cfg, initialize,
  orchestrator, health, heartbeats, shutdown, jobRegistry,
  // atajos usados por endpoints admin
  status: (...a) => orchestrator.status(...a),
  runOnce: (...a) => orchestrator.runOnce(...a),
  bootReport: (...a) => orchestrator.bootReport(...a),
};
