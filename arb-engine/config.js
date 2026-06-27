// arb-engine/config.js — flags y parámetros del motor de arbitraje (Sprint 3). Centralizado.
// REGLA CRÍTICA: ARB_ENGINE_ALLOW_AUTO_PUBLICATION se FUERZA a false en Sprint 3 (no hay publicación).

'use strict';
const platform = require('../database/config');
const ENGINE_VERSION = 'arb-engine-1';

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

function resolveFlags() {
  const engineEnabled = bool(process.env.ARB_ENGINE_ENABLED, false);
  const writeReq = bool(process.env.ARB_ENGINE_WRITE_ENABLED, false);
  const schedReq = bool(process.env.ARB_ENGINE_SCHEDULER_ENABLED, false);
  const autoReq = bool(process.env.ARB_ENGINE_ALLOW_AUTO_PUBLICATION, false);
  return {
    engineEnabled,
    writeEnabled: engineEnabled && writeReq,
    schedulerEnabled: engineEnabled && writeReq && schedReq,
    // SIEMPRE false en Sprint 3 — no existe publicación pública. Aunque el env diga true, se ignora.
    allowAutoPublication: false,
    autoPublicationRequestedButBlocked: autoReq,
    // Fase R.1: gate semántico estricto. Default TRUE (seguridad). Un candidato solo puede ser ejecutable si
    // pasa el gate; ante cualquier duda semántica → rejected (semantic_mismatch). Solo añade rechazos.
    semanticStrict: bool(process.env.GP_ARBITRAGE_SEMANTIC_STRICT, true),
  };
}
const flags = resolveFlags();

const params = {
  minNetRoi: String(process.env.ARB_MIN_NET_ROI || '0.005'),         // 0.5% neto mínimo por defecto
  executionBufferBps: num(process.env.ARB_EXECUTION_BUFFER_BPS, 50), // 0.5% buffer operativo (no es fee)
  maxLegTimeSkewMs: num(process.env.ARB_MAX_LEG_TIME_SKEW_MS, 3000),
  maxSnapshotAgePrematchMs: num(process.env.ARB_MAX_SNAPSHOT_AGE_PREMATCH_MS, 120000),
  maxSnapshotAgeLiveMs: num(process.env.ARB_MAX_SNAPSHOT_AGE_LIVE_MS, 15000),
  opportunityExpiryMultiplier: num(process.env.ARB_OPPORTUNITY_EXPIRY_MULTIPLIER, 3),
  volatilityWindowMs: num(process.env.ARB_VOLATILITY_WINDOW_MS, 60000),
  intervalMs: num(process.env.ARB_ENGINE_INTERVAL_MS, 10000),
  minEquivalenceScore: num(process.env.ARB_MIN_EQUIVALENCE_SCORE, 0.95),
  // capital ejecutable mínimo para considerar Pure Arb (por debajo → execution_sensitive: muy fino/frágil)
  minExecutableCapital: String(process.env.ARB_MIN_EXECUTABLE_CAPITAL || '25'),
  referenceSizes: ['25', '50', '100', '250', '500', '1000'],
};

module.exports = { platform, flags, params, ENGINE_VERSION };
