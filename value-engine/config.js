// value-engine/config.js — Sprint 7. Flags + thresholds + pesos. Centralizado (no hardcodear en varios sitios).
// INVARIANTES: PICKS_AUTO_PUBLICATION_ENABLED forzado a false; V2 nunca alimenta picks oficiales (peso 0).
'use strict';
const platform = require('../database/config');

const LAYER_VERSION = 'value-engine-1';
const VERSIONS = { noVig: 'no-vig-proportional-1', noVigAlt: 'no-vig-power-1', ensemble: 'ensemble-logit-1', classification: 'value-classify-1', quality: 'quality-1', uncertainty: 'uncertainty-1' };
const OFFICIAL_NO_VIG = 'no-vig-proportional-1';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function resolveFlags() {
  const sbEnabled = bool(process.env.SPORTSBOOK_DATA_ENABLED, false);
  const veEnabled = bool(process.env.VALUE_ENGINE_ENABLED, false);
  const veWrite = veEnabled && bool(process.env.VALUE_ENGINE_WRITE_ENABLED, false);
  const picksEnabled = bool(process.env.PICKS_ENABLED, false);
  return {
    sportsbookData: sbEnabled,
    sportsbookWrite: sbEnabled && bool(process.env.SPORTSBOOK_DATA_WRITE_ENABLED, false),
    valueEnabled: veEnabled,
    valueWrite: veWrite,
    // Bloque K (post-shadow): el scheduler se DESACOPLA de la escritura. Con ENABLED+SCHEDULER pero WRITE=false
    // el pipeline corre en DRY-RUN (consenso/no-vig/ensemble/clasificación) sin escribir tablas oficiales.
    valueScheduler: veEnabled && bool(process.env.VALUE_ENGINE_SCHEDULER_ENABLED, false),
    valueDryRun: veEnabled && !veWrite,
    // escritura a tablas SHADOW (separadas de las oficiales); gateada y por defecto off.
    valueShadowRuns: bool(process.env.VALUE_SHADOW_RUNS_ENABLED, false),
    valueAdminPreview: veEnabled && bool(process.env.VALUE_ADMIN_PREVIEW_ENABLED, false),
    valuePublic: veEnabled && bool(process.env.VALUE_PUBLIC_ENABLED, false),
    picksEnabled,
    picksAdminPreview: picksEnabled && bool(process.env.PICKS_ADMIN_PREVIEW_ENABLED, false),
    picksManualPublication: picksEnabled && bool(process.env.PICKS_MANUAL_PUBLICATION_ENABLED, false),
    picksPublic: picksEnabled && bool(process.env.PICKS_PUBLIC_ENABLED, false),
    // INVARIANTE: auto-publicación de picks SIEMPRE bloqueada en Sprint 7 (aunque el env diga true).
    picksAutoPublicationBlocked: true,
    picksAutoPublicationRequested: bool(process.env.PICKS_AUTO_PUBLICATION_ENABLED, false),
    // INVARIANTE: V2 experimental nunca alimenta el ensemble oficial.
    valueExperimentalV2: bool(process.env.VALUE_EXPERIMENTAL_V2_ENABLED, false),
    // Corte 4B (aditivo, ADITIVO/INERTE por defecto): horizonte de evaluación en horas. null = comportamiento
    // actual (solo eventos con cuota fresca). Para ampliar la cobertura a todos los fixtures canónicos dentro del
    // horizonte hay que, además, cablear linkedEvents() + ingesta/auto-match (decisión operativa/costo). Hoy SOLO
    // se expone la config; NO cambia el universo evaluado.
    evaluationHorizonHours: process.env.GP_INTELLIGENCE_EVALUATION_HORIZON_HOURS != null && process.env.GP_INTELLIGENCE_EVALUATION_HORIZON_HOURS !== '' ? Number(process.env.GP_INTELLIGENCE_EVALUATION_HORIZON_HOURS) : null,
  };
}

const params = {
  // freshness / sincronización (§11)
  maxBookOutcomeSkewMs: int(process.env.VALUE_MAX_BOOK_OUTCOME_SKEW_MS, 60000),
  maxQuoteAgePrematchMs: int(process.env.VALUE_MAX_QUOTE_AGE_PREMATCH_MS, 600000),
  maxSourceTimeSkewMs: int(process.env.VALUE_MAX_SOURCE_TIME_SKEW_MS, 300000),
  // pesos del ensemble (§20) — política conservadora: consenso sportsbook domina; GP limitado con muestra chica
  weights: {
    sportsbookConsensus: num(process.env.VALUE_WEIGHT_SPORTSBOOK_CONSENSUS, 0.55),
    gpModel: num(process.env.VALUE_WEIGHT_GP_MODEL, 0.20),
    predictionMarkets: num(process.env.VALUE_WEIGHT_PREDICTION_MARKETS, 0.25),
    sharpReference: num(process.env.VALUE_WEIGHT_SHARP_REFERENCE, 0.0),
    maxGpWithInsufficientSample: num(process.env.VALUE_MAX_GP_WEIGHT_WITH_INSUFFICIENT_SAMPLE, 0.10),
  },
  // thresholds de clasificación (§28) — en puntos de probabilidad (pp = fracción) y EV (fracción)
  thresholds: {
    watchEdge: num(process.env.VALUE_WATCH_MIN_ADJUSTED_EDGE_PP, 0.01),
    leanEdge: num(process.env.VALUE_LEAN_MIN_ADJUSTED_EDGE_PP, 0.02),
    strongEdge: num(process.env.VALUE_STRONG_MIN_ADJUSTED_EDGE_PP, 0.035),
    watchEv: num(process.env.VALUE_WATCH_MIN_ADJUSTED_EV, 0.01),
    leanEv: num(process.env.VALUE_LEAN_MIN_ADJUSTED_EV, 0.02),
    strongEv: num(process.env.VALUE_STRONG_MIN_ADJUSTED_EV, 0.04),
    strongMinQuality: num(process.env.VALUE_STRONG_MIN_QUALITY_SCORE, 65),
    strongMaxUncertainty: num(process.env.VALUE_STRONG_MAX_UNCERTAINTY_SCORE, 45),
    minSportsbookSources: int(process.env.VALUE_MIN_SPORTSBOOK_SOURCES, 3),
    minIndependenceGroups: int(process.env.VALUE_MIN_INDEPENDENCE_GROUPS, 3),
    minDataQuality: num(process.env.VALUE_MIN_DATA_QUALITY, 0.5),
  },
  minEv: num(process.env.VALUE_MINIMUM_EV, 0.02), // EV mínimo para cuota mínima aceptable
  ensembleLogitClip: num(process.env.VALUE_ENSEMBLE_LOGIT_CLIP, 1e-6),
  sportsbookIngestionIntervalMs: int(process.env.SPORTSBOOK_INGESTION_INTERVAL_MS, 120000),
  valueEngineIntervalMs: int(process.env.VALUE_ENGINE_INTERVAL_MS, 120000),
  trackingPolicy: 'flat_1_unit_v1',
};

const ADVISORY = { sportsbook: { resource: 'sportsbook-ingestion', op: 'ingest' }, value: { resource: 'value-engine', op: 'evaluate' }, pickMonitor: { resource: 'pick-price-monitor', op: 'monitor' } };

module.exports = { platform, flags: resolveFlags(), params, VERSIONS, OFFICIAL_NO_VIG, LAYER_VERSION, ADVISORY, resolveFlags };
