// signal-registry/config.js — Sprint 5. Flags y constantes del registro inmutable de señales.
// Registro con evidencia de integridad y detección de modificaciones (NO "tamper-proof": la base es de GP).
'use strict';

const platform = require('../database/config');

const LAYER_VERSION = 'signal-registry-1';
// Genesis hash documentado: punto de anclaje de la cadena (señal en posición 0 / previous de la posición 1).
const GENESIS_HASH = 'genesis:gpsimulador:signal-registry:v1';
const HASH_ALGO = 'sha256';
const COMMITMENT_ALGO = 'merkle-sha256-v1';

// versiones de esquema de payload por tipo de señal
const SCHEMA_VERSIONS = {
  model_prediction_v1: 'model_prediction_v1-1',
  arb_publication: 'arb_publication-1',
  gp_intelligence_experiment: 'gp_intelligence_experiment-1',
};
// versión metodológica del modelo oficial V1 (engine.js no la exponía; se ancla aquí para congelarla)
const V1_METHODOLOGY_VERSION = 'gp-core-1.4.0';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function resolveFlags() {
  const enabled = bool(process.env.SIGNAL_REGISTRY_ENABLED, false);
  const writeReq = bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false);
  return {
    enabled,
    writeEnabled: enabled && writeReq,
    publicEnabled: enabled && bool(process.env.SIGNAL_REGISTRY_PUBLIC_ENABLED, false),
    autoModelCapture: enabled && writeReq && bool(process.env.SIGNAL_REGISTRY_AUTO_MODEL_CAPTURE_ENABLED, false),
    autoArbCapture: enabled && writeReq && bool(process.env.SIGNAL_REGISTRY_AUTO_ARB_CAPTURE_ENABLED, false),
    experimentCapture: enabled && writeReq && bool(process.env.SIGNAL_REGISTRY_EXPERIMENT_CAPTURE_ENABLED, false),
    closingCaptureEnabled: bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false),
    settlementEnabled: bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false),
  };
}

const params = {
  // Epoch del registro verificable. Señales con published_at < epoch → legacy_unverified. Se setea al activar.
  verifiedEpoch: process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH || null,
  closingCaptureIntervalMs: int(process.env.SIGNAL_CLOSING_CAPTURE_INTERVAL_MS, 60000),
  closingMaxPrestartWindowMs: int(process.env.SIGNAL_CLOSING_MAX_PRESTART_WINDOW_MS, 3 * 3600 * 1000), // 3h antes del inicio
  settlementIntervalMs: int(process.env.SIGNAL_SETTLEMENT_INTERVAL_MS, 120000),
};

// advisory lock key para serializar la inserción en la cadena (concurrencia)
const CHAIN_ADVISORY_LOCK = 521987;

const SIGNAL_TYPES = ['model_prediction_v1', 'arb_publication', 'gp_intelligence_experiment',
  // contratos preparados para el futuro (no se construyen sus motores en Sprint 5)
  'value_signal', 'editorial_pick', 'sportsbook_signal', 'prediction_market_signal'];

module.exports = {
  platform, flags: resolveFlags(), params,
  LAYER_VERSION, GENESIS_HASH, HASH_ALGO, COMMITMENT_ALGO, SCHEMA_VERSIONS, V1_METHODOLOGY_VERSION,
  CHAIN_ADVISORY_LOCK, SIGNAL_TYPES, resolveFlags,
};
