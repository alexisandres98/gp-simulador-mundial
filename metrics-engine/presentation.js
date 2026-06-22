// metrics-engine/presentation.js — Sprint 6 §30-32. Payloads públicos con metadata. N/A ≠ cero. Sin cherry-picking.
'use strict';
const cfg = require('./config');

// metricView(agg) → vista pública de un agregado (siempre con n, versión, intervalo, estado de muestra).
function metricView(agg, def = null) {
  if (!agg) return { available: false, reason: 'unavailable' };
  return {
    metric_code: agg.metric_code,
    metric_version: agg.metric_version,
    value: agg.value != null ? Number(agg.value) : null,   // null = N/A, NUNCA se muestra como 0
    available: agg.value != null,
    sample_size: agg.sample_size,
    sample_status: agg.sample_status,
    eligible_count: agg.eligible_count,
    excluded_count: agg.excluded_count,
    confidence_interval: agg.confidence_interval || null,
    secondary_values: agg.secondary_values || {},
    higher_is_better: def ? def.higher_is_better : null,
    provisional: ['insufficient', 'early'].includes(agg.sample_status),
  };
}

// summaryPayload({ aggregates, verifiedEpoch, calculatedAt, snapshot }) → resumen oficial V1.
function summaryPayload({ aggregates = [], verifiedEpoch = null, calculatedAt = null, snapshot = null } = {}) {
  const official = aggregates.filter(a => (a.cohort_dimensions && a.cohort_dimensions.signal_type === 'model_prediction_v1'));
  const find = code => official.find(a => a.metric_code === code) || null;
  return {
    verified_epoch: verifiedEpoch,
    verified_epoch_configured: !!verifiedEpoch,
    calculated_at: calculatedAt,
    snapshot_public_id: snapshot ? snapshot.public_id : null,
    metrics: {
      brier_multiclass: metricView(find('brier_multiclass')),
      log_loss: metricView(find('log_loss_multiclass')),
      accuracy_top1: metricView(find('accuracy_top1')),
      ece: metricView(find('ece_equal_width')),
    },
    methodology_version: 'metrics-1',
    copy: copyFor(official),
    disclaimer: 'Resultados desde el inicio del registro verificable. Las métricas incluyen todas las señales oficiales elegibles. Las señales experimentales y legacy se muestran por separado.',
  };
}

function copyFor(official) {
  const n = official.reduce((m, a) => Math.max(m, a.sample_size || 0), 0);
  if (n === 0) return 'Aún no hay señales oficiales liquidadas en el registro verificable.';
  if (n <= cfg.params.sample.earlyMax) return 'Muestra todavía limitada. Estos resultados pueden cambiar sustancialmente.';
  return 'Resultados desde el inicio del registro verificable.';
}

// calibrationPayload(agg, bins) → reliability chart (predicho vs observado + línea ideal implícita).
function calibrationPayload(agg, bins = []) {
  if (!agg) return { available: false };
  return {
    available: !!(bins && bins.length), method: 'equal_width', metric_version: 'ece_equal_width_v1',
    ece: agg.value != null ? Number(agg.value) : null, sample_size: agg.sample_size, sample_status: agg.sample_status,
    bins: (bins || []).map(b => ({ bucket_start: Number(b.bucket_start), bucket_end: Number(b.bucket_end), predicted_average: Number(b.predicted_average), observed_frequency: Number(b.observed_frequency), sample_size: b.sample_size, confidence_low: b.confidence_low != null ? Number(b.confidence_low) : null, confidence_high: b.confidence_high != null ? Number(b.confidence_high) : null, absolute_gap: Number(b.absolute_gap) })),
  };
}

module.exports = { metricView, summaryPayload, calibrationPayload };
