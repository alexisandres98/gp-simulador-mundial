// operations/health.js — salud operativa (Sprint 8A §25). Read-only. No ejecuta jobs, no migra, no
// imprime secretos. Alimenta /api/internal/operations/health y la consola admin.
'use strict';
const cfg = require('./config');
const db = require('../database/client');
const orchestrator = require('./orchestrator');
const deadLetters = require('./repositories/deadLetterRepository');
const fresh = require('../freshness');
const degradation = require('../freshness/degradation');

// snapshot de frescura de fuentes (§21) → estado por fuente + decisión de degradación (§22). DB-light.
async function freshnessSnapshot(now = null) {
  const sources = { sportsbooks: 'unknown', predictionMarkets: 'unknown', signalRegistry: 'unknown', closing: 'unknown' };
  const detail = {};
  if (db.isConfigured()) {
    try {
      const sb = await db.query(`SELECT last_success_at, provider_status, circuit_state FROM sportsbook_provider_state ORDER BY updated_at DESC LIMIT 1`);
      if (sb.rows[0]) { const f = fresh.evaluate(sb.rows[0].last_success_at, 'sportsbook_quote', now); sources.sportsbooks = sb.rows[0].circuit_state === 'open' ? 'down' : f.status; detail.sportsbooks = { ...f, circuit: sb.rows[0].circuit_state }; }
    } catch { /* tabla puede no existir aún */ }
    try {
      const pm = await db.query(`SELECT max(received_at) m FROM normalized_market_snapshots`);
      if (pm.rows[0] && pm.rows[0].m) { const f = fresh.evaluate(pm.rows[0].m, 'prediction_market_book', now); sources.predictionMarkets = f.status; detail.predictionMarkets = f; }
    } catch { /* noop */ }
  }
  return { sources, detail, degradation: degradation.decide(sources), contract_version: fresh.CONTRACT_VERSION };
}

async function health() {
  const dbProbe = await db.healthProbe().catch(() => ({ configured: false, connected: false, latencyMs: null }));
  const out = {
    layer: cfg.LAYER_VERSION,
    flags: cfg.flags,
    db: { configured: dbProbe.configured, connected: dbProbe.connected, latency_ms: dbProbe.latencyMs },
    orchestrator: orchestrator._manager.status(),
    jobs: [], dead_letters: {}, warnings: [],
  };
  try { const st = await orchestrator.status(); out.jobs = st.summary || []; out.recent_runs = st.recent_runs || []; } catch { out.warnings.push('status_unavailable'); }
  try { out.freshness = await freshnessSnapshot(); if (out.freshness.degradation && out.freshness.degradation.warnings.length) out.warnings.push(...out.freshness.degradation.warnings); } catch { out.warnings.push('freshness_unavailable'); }
  if (cfg.flags.jobWrites && dbProbe.connected) { try { out.dead_letters = await deadLetters.counts(); } catch { out.warnings.push('dead_letters_unavailable'); } }
  if (!dbProbe.connected && cfg.flags.orchestrator) out.warnings.push('db_unavailable_with_orchestrator_on');
  // jobs con fallos recientes
  for (const j of out.jobs) if ((j.failures_24h || 0) > 0 && (j.last_status === 'failed' || j.last_status === 'timed_out' || j.last_status === 'stale')) out.warnings.push('job_unhealthy:' + j.job_name);
  return out;
}

// salud pública mínima (§25): solo status/timestamp/version. Sin detalles sensibles.
function publicHealth(version) {
  return { status: 'ok', version: version || null };
}

module.exports = { health, publicHealth, freshnessSnapshot };
