// metrics-engine/cohorting.js — Sprint 6 §23. Dimensiones de cohorte + horizonte de predicción. Puro.
'use strict';

// predictionHorizon(eventStartAt, publishedAt) → bucket de horizonte
function predictionHorizon(eventStartAt, publishedAt) {
  if (!eventStartAt || !publishedAt) return 'unknown';
  const h = (new Date(eventStartAt).getTime() - new Date(publishedAt).getTime()) / 3600000;
  if (!Number.isFinite(h) || h < 0) return 'unknown';
  if (h < 1) return '<1h';
  if (h < 6) return '1-6h';
  if (h < 24) return '6-24h';
  if (h < 72) return '1-3d';
  return '>3d';
}

// probabilityBucket(p) → rango 0-10..90-100 (del outcome principal / argmax)
function probabilityBucket(p) {
  const x = parseFloat(p); if (!Number.isFinite(x)) return 'unknown';
  const lo = Math.min(9, Math.floor(x * 10)) * 10;
  return `${lo}-${lo + 10}%`;
}

// dimensions(signal) → objeto de dimensiones de cohorte (no se generan millones de combinaciones; se usan subconjuntos)
function dimensions(signal, { topProb = null } = {}) {
  const pl = signal.signal_payload || {};
  return {
    signal_type: signal.signal_type,
    model_version: signal.model_version || null,
    methodology_version: signal.methodology_version || null,
    sport: pl.sport || 'football',
    competition: pl.competition || 'world_cup',
    market_family: pl.market_type || pl.market_family || null,
    prediction_horizon: predictionHorizon(signal.event_start_at, signal.published_at),
    probability_bucket: topProb != null ? probabilityBucket(topProb) : null,
    data_quality: (pl.data_quality && pl.data_quality.label) || null,
    verified_epoch: signal.verified_epoch || null,
  };
}

// cohortKey(dims, picked) → clave estable para un subconjunto de dimensiones (orden fijo).
function cohortKey(dims, picked = ['signal_type', 'model_version']) {
  return picked.map(k => `${k}=${dims[k] == null ? '*' : dims[k]}`).join('|');
}

module.exports = { predictionHorizon, probabilityBucket, dimensions, cohortKey };
