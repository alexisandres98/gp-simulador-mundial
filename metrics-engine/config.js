// metrics-engine/config.js — Sprint 6. Flags y parámetros del motor de métricas. Todo versionado.
// Objetivo: hacer a GP MEDIBLE, no hacerlo parecer exitoso. Inerte con flags apagados.
'use strict';
const platform = require('../database/config');

const LAYER_VERSION = 'metrics-engine-1';
const CODE_VERSION = 'metrics-1';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

function resolveFlags() {
  const enabled = bool(process.env.METRICS_ENGINE_ENABLED, false);
  const writeReq = bool(process.env.METRICS_ENGINE_WRITE_ENABLED, false);
  return {
    enabled,
    writeEnabled: enabled && writeReq,
    schedulerEnabled: enabled && writeReq && bool(process.env.METRICS_ENGINE_SCHEDULER_ENABLED, false),
    publicEnabled: enabled && bool(process.env.METRICS_PUBLIC_ENABLED, false),
    adminPreviewEnabled: enabled && bool(process.env.METRICS_ADMIN_PREVIEW_ENABLED, false),
    experimentalEnabled: bool(process.env.METRICS_EXPERIMENTAL_ENABLED, false),
    // ROI simulado: apagado hasta que exista una política válida de señales con precio (Sprint 7+).
    simulatedReturnsEnabled: bool(process.env.METRICS_SIMULATED_RETURNS_ENABLED, false),
  };
}

const params = {
  logLossEpsilon: num(process.env.METRICS_LOG_LOSS_EPSILON, 1e-12),
  bootstrapIterations: int(process.env.METRICS_BOOTSTRAP_ITERATIONS, 2000),
  bootstrapSeed: int(process.env.METRICS_BOOTSTRAP_SEED, 20260622),
  intervalMs: int(process.env.METRICS_ENGINE_INTERVAL_MS, 300000), // 5 min
  // política de tamaño de muestra (comunicación, NO ley científica)
  sample: {
    insufficientMax: int(process.env.METRICS_SAMPLE_INSUFFICIENT_MAX, 29),
    earlyMax: int(process.env.METRICS_SAMPLE_EARLY_MAX, 99),
    developingMax: int(process.env.METRICS_SAMPLE_DEVELOPING_MAX, 299),
  },
  // calibración: buckets equal-width de 10 (configurable)
  calibrationBuckets: int(process.env.METRICS_CALIBRATION_BUCKETS, 10),
};

// estado de muestra a partir de n
function sampleStatus(n) {
  const s = params.sample;
  if (n <= s.insufficientMax) return 'insufficient';
  if (n <= s.earlyMax) return 'early';
  if (n <= s.developingMax) return 'developing';
  return 'established';
}

const ADVISORY_LOCK = { resource: 'metrics-engine', op: 'run' };

module.exports = { platform, flags: resolveFlags(), params, sampleStatus, LAYER_VERSION, CODE_VERSION, ADVISORY_LOCK, resolveFlags };
