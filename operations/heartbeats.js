// operations/heartbeats.js — recuperación de runs abandonadas (Sprint 8A §16). Una run 'running' cuyo
// heartbeat superó stale_after se marca 'stale' (no se borra). NO inicia una run nueva si hay una sana.
'use strict';
const cfg = require('./config');
const jobRuns = require('./repositories/jobRunRepository');
const db = require('../database/client');

// Barrido de recuperación: marca stale las runs abandonadas de todos los jobs. Devuelve cuántas.
async function recoverStale(staleAfterMs = cfg.params.defaultStaleAfterMs) {
  if (!cfg.flags.jobWrites || !db.isConfigured()) return { swept: 0, skipped: 'inactive' };
  try { const n = await jobRuns.markStale(null, staleAfterMs); return { swept: n }; }
  catch (e) { return { swept: 0, error: String(e && e.message) }; }
}

module.exports = { recoverStale };
