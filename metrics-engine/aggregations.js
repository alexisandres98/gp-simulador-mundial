// metrics-engine/aggregations.js — Sprint 6 §24-25. Facts → agregados (valor + CI + calibración + estado de muestra).
'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const ci = require('./confidenceIntervals');
const calibration = require('./calibration');
const cohorting = require('./cohorting');

// aggregateMetric(facts, { metricCode, cohortPicked, inputChainHead, fromDate, toDate }) → agregado
// Solo facts ELEGIBLES para la métrica entran al valor; las excluidas se cuentan aparte (no se borran).
function aggregateMetric(facts, { metricCode, cohortPicked = ['signal_type', 'model_version'], inputChainHead = null, fromDate = null, toDate = null } = {}) {
  const isClv = metricCode.startsWith('clv') || metricCode === 'closing_beat_rate';
  const eligible = facts.filter(f => (isClv ? f.clv_eligibility_status === 'eligible' : f.eligibility_status === 'eligible') && !f.experimental);
  const excluded = facts.length - eligible.length;

  let value = null, secondary = {}, interval = null, calBins = null;

  if (metricCode === 'brier_multiclass' || metricCode === 'brier_binary') {
    const vals = eligible.map(f => f.metrics.brier).filter(Number.isFinite);
    if (vals.length) { value = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6); interval = ci.bootstrapMean(vals); }
  } else if (metricCode === 'log_loss_multiclass') {
    const vals = eligible.map(f => f.metrics.log_loss).filter(Number.isFinite);
    if (vals.length) { value = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6); interval = ci.bootstrapMean(vals); }
  } else if (metricCode === 'accuracy_top1') {
    const vals = eligible.map(f => f.metrics.accuracy_correct).filter(v => v === 0 || v === 1);
    const hits = vals.reduce((a, b) => a + b, 0);
    if (vals.length) { value = +(hits / vals.length).toFixed(6); interval = ci.wilson(hits, vals.length); secondary = { hits, misses: vals.length - hits }; }
  } else if (metricCode === 'ece_equal_width') {
    const pts = eligible.flatMap(f => f.calibration_points || []);
    const rel = calibration.reliability(pts, { buckets: cfg.params.calibrationBuckets, ci: (s, n) => { const w = ci.wilson(s, n); return { low: w.low, high: w.high }; } });
    value = rel.ece; calBins = rel.bins; secondary = { points: rel.n, buckets: rel.buckets };
  } else if (metricCode === 'clv_probability_points') {
    const vals = eligible.map(f => f.metrics.clv && f.metrics.clv.clv_probability_points).filter(Number.isFinite);
    if (vals.length) { value = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6); interval = ci.bootstrapMean(vals); }
  } else if (metricCode === 'clv_log_odds') {
    const vals = eligible.map(f => f.metrics.clv && f.metrics.clv.clv_log_odds).filter(Number.isFinite);
    if (vals.length) { value = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6); interval = ci.bootstrapMean(vals); }
  } else if (metricCode === 'closing_beat_rate') {
    const vals = eligible.map(f => f.metrics.clv && f.metrics.clv.clv_probability_points).filter(Number.isFinite);
    const beat = vals.filter(v => v > 0).length;
    if (vals.length) { value = +(beat / vals.length).toFixed(6); interval = ci.wilson(beat, vals.length); secondary = { beat, total: vals.length }; }
  }

  const sampleSize = effectiveSample(metricCode, eligible);
  const dims = eligible[0] ? eligible[0].cohort_dimensions : {};
  const cohortKey = cohorting.cohortKey(dims, cohortPicked);

  const agg = {
    metric_code: metricCode, metric_version: defVersion(metricCode),
    cohort_key: cohortKey, cohort_dimensions: pickDims(dims, cohortPicked),
    sample_size: sampleSize, eligible_count: eligible.length, excluded_count: excluded,
    value, secondary_values: secondary, confidence_interval: interval, calibration_bins: calBins,
    sample_status: cfg.sampleStatus(sampleSize),
    from_date: fromDate, to_date: toDate, input_chain_head: inputChainHead,
  };
  agg.idempotency_key = crypto.createHash('sha256').update(JSON.stringify({ m: agg.metric_version, c: cohortKey, h: inputChainHead || '', f: fromDate || '', t: toDate || '' })).digest('hex').slice(0, 32);
  return agg;
}

function effectiveSample(metricCode, eligible) {
  if (metricCode === 'ece_equal_width') return eligible.length; // n señales, no puntos
  if (metricCode.startsWith('clv') || metricCode === 'closing_beat_rate') return eligible.filter(f => f.metrics.clv && f.metrics.clv.clv_probability_points != null).length;
  if (metricCode === 'accuracy_top1') return eligible.filter(f => f.metrics.accuracy_correct != null).length;
  return eligible.filter(f => Number.isFinite(f.metrics.brier) || Number.isFinite(f.metrics.log_loss)).length;
}
function defVersion(code) { const m = { brier_multiclass: 'brier_multiclass_v1', brier_binary: 'brier_binary_v1', log_loss_multiclass: 'log_loss_multiclass_v1', accuracy_top1: 'accuracy_top1_v1', ece_equal_width: 'ece_equal_width_v1', clv_probability_points: 'clv_probability_points_v1', clv_log_odds: 'clv_log_odds_v1', closing_beat_rate: 'closing_beat_rate_v1' }; return m[code] || code + '_v1'; }
function pickDims(dims, picked) { const o = {}; for (const k of picked) o[k] = dims[k] == null ? null : dims[k]; return o; }

module.exports = { aggregateMetric };
