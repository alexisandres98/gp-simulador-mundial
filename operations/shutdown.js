// operations/shutdown.js — apagado ordenado (Sprint 8A §17). Render puede reiniciar el proceso en
// cualquier momento. Cuando el orquestador está activo, este coordinador: (1) detiene los timers y DRENA
// los jobs en vuelo, (2) cierra el pool de PostgreSQL, (3) termina. SOLO se instala si el orquestador
// está habilitado → en fase inerte NO toca el manejo de señales (conserva el hook de pool existente).
'use strict';
const cfg = require('./config');
const log = require('../database/logger');

let installed = false;

function install({ stopFns = [], preExit = null } = {}) {
  if (installed) return { installed: true, already: true };
  if (!cfg.flags.orchestrator) return { installed: false, reason: 'orchestrator_disabled' };
  installed = true;
  const db = require('../database/client');

  for (const sig of ['SIGTERM', 'SIGINT']) {
    // Tomamos la autoría del apagado: quitamos el hook de pool existente (lo reemplazamos por uno que
    // drena jobs ANTES de cerrar el pool) y registramos el coordinador.
    process.removeAllListeners(sig);
    process.once(sig, async () => {
      log.info('operations: señal de apagado, drenando jobs', { signal: sig });
      try { await Promise.race([Promise.all(stopFns.map(f => Promise.resolve().then(f))), new Promise(r => setTimeout(r, cfg.params.shutdownDrainMs + 2000))]); }
      catch (e) { log.warn('operations: error drenando', { error: String(e && e.message) }); }
      try { if (typeof preExit === 'function') preExit(); } catch { /* persistir db.json best-effort */ }
      try { await db.close(); } catch { /* noop */ }
      log.info('operations: apagado completo', { signal: sig });
      process.exit(0);
    });
  }
  return { installed: true };
}

module.exports = { install, isInstalled: () => installed };
