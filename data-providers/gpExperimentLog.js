// gpExperimentLog.js — registro experimental de ejecuciones de GP Intelligence (Sprint 0.1).
// BEST-EFFORT y AISLADO:
//   • flag GP_INTELLIGENCE_EXPERIMENT_LOGGING=false por defecto → no escribe nada.
//   • sin DATABASE_URL → no escribe (GP Intelligence sigue funcionando igual).
//   • un fallo al registrar NUNCA rompe la simulación del usuario (no propaga).
// No se mezcla con el track record global (es una tabla separada, model_analysis_runs).

'use strict';

function enabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.GP_INTELLIGENCE_EXPERIMENT_LOGGING || '').trim());
}

let _repos, _configured;
function deps() {
  if (_repos === undefined) { try { _repos = require('../database/repositories'); } catch { _repos = null; } }
  if (_configured === undefined) { try { _configured = require('../database/config').db.configured; } catch { _configured = false; } }
  return { repos: _repos, configured: _configured };
}

// logRun(run) → { logged, reason?|id }. Nunca lanza.
async function logRun(run) {
  try {
    if (!enabled()) return { logged: false, reason: 'flag_off' };
    const { repos, configured } = deps();
    if (!configured || !repos) return { logged: false, reason: 'no_db' };
    const row = await repos.modelAnalysisRuns.insert(run);
    return { logged: true, id: row && row.id };
  } catch {
    return { logged: false, reason: 'error' };
  }
}

module.exports = { logRun, enabled };
