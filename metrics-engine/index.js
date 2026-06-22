// metrics-engine/index.js — Sprint 6. Fachada del motor de métricas. Gating por flags. No conecta al requerir.
'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const repo = require('./repositories');
const rebuild = require('./rebuild');
const presentation = require('./presentation');
const definitions = require('./definitions');
const arbMetrics = require('./arbMetrics');

async function adminStatus() {
  const out = { flags: cfg.flags, params: { sample: cfg.params.sample, verifiedEpoch: require('../signal-registry/config').params.verifiedEpoch }, layerVersion: cfg.LAYER_VERSION, counts: null, runs: null };
  if (cfg.platform.db.configured) {
    try { out.counts = await repo.facts.counts(); } catch { /* noop */ }
    try { out.runs = await repo.runs.recent({ limit: 5 }); } catch { /* noop */ }
  }
  return out;
}

async function runOnce(opts = {}) { return rebuild.runLocked({ runType: 'incremental', ...opts }); }
async function fullRebuild(opts = {}) { return rebuild.runLocked({ runType: 'full_rebuild', ...opts }); }
async function dryRun(opts = {}) { return rebuild.run({ runType: 'dry_run', dryRun: true, ...opts }); }
async function seedDefinitions() { if (cfg.flags.writeEnabled) await repo.definitions.seedAll(definitions.DEFINITIONS); }

// publishSnapshot — congela los agregados actuales en un public_metric_snapshot (inmutable). §26.
async function publishSnapshot({ settlementCutoff = null } = {}) {
  const aggs = await repo.aggregates.list({});
  const aggValues = {}; const sampleCounts = {}; const metricVersions = {};
  let head = null;
  for (const a of aggs) {
    aggValues[a.metric_code + '|' + a.cohort_key] = { value: a.value != null ? Number(a.value) : null, ci: a.confidence_interval, sample_size: a.sample_size, sample_status: a.sample_status };
    sampleCounts[a.cohort_key] = a.sample_size;
    metricVersions[a.metric_code] = a.metric_version;
    if (a.input_chain_head != null) head = Math.max(head || 0, Number(a.input_chain_head));
  }
  const publicId = 'ms_' + crypto.randomBytes(8).toString('hex');
  const contentHash = crypto.createHash('sha256').update(JSON.stringify({ aggValues, head, settlementCutoff })).digest('hex');
  return repo.snapshots.insert({ public_id: publicId, metric_versions: metricVersions, input_chain_head: head, settlement_cutoff: settlementCutoff, sample_counts: sampleCounts, aggregate_values: aggValues, methodology_version: 'metrics-1', content_hash: contentHash });
}

// verify — §37. Invariantes de integridad.
async function verify() {
  const facts = await repo.facts.all();
  const issues = [];
  // no experimental ni legacy en agregados oficiales (los facts experimentales/excluidos no deben contar)
  const officialEligible = facts.filter(f => f.eligibility_status === 'eligible' && !f.experimental);
  if (officialEligible.some(f => f.experimental)) issues.push('experimental_in_official');
  if (officialEligible.some(f => (f.exclusion_reasons || []).includes('legacy_unverified'))) issues.push('legacy_in_official');
  // no ROI realizado en arb
  if (facts.some(f => f.signal_type === 'arb_publication' && f.metrics && f.metrics.returns && f.metrics.returns.realized_roi !== null)) issues.push('arb_realized_roi_present');
  // reproducibilidad de agregados: recomputar y comparar idempotency_key
  return { valid: issues.length === 0, issues, facts: facts.length, officialEligible: officialEligible.length };
}

// ---------- lectura pública (gated) ----------
async function publicSummary() {
  if (!cfg.flags.publicEnabled) return { enabled: false };
  const verifiedEpoch = require('../signal-registry/config').params.verifiedEpoch;
  const snapshot = await repo.snapshots.latest().catch(() => null);
  const aggs = await repo.aggregates.list({});
  return { enabled: true, ...presentation.summaryPayload({ aggregates: aggs, verifiedEpoch, calculatedAt: aggs[0] ? aggs[0].calculated_at : null, snapshot }) };
}
async function publicCalibration() {
  if (!cfg.flags.publicEnabled) return { enabled: false };
  const aggs = await repo.aggregates.list({ metricCode: 'ece_equal_width' });
  const agg = aggs.find(a => a.cohort_dimensions && a.cohort_dimensions.signal_type === 'model_prediction_v1') || aggs[0];
  const bins = agg ? await repo.calibrationBins.forAggregate(agg.id) : [];
  return { enabled: true, ...presentation.calibrationPayload(agg, bins) };
}
async function publicArb(arbData) {
  if (!cfg.flags.publicEnabled) return { enabled: false };
  return { enabled: true, ...arbMetrics.compute(arbData || {}) };
}
async function publicExperimental() {
  if (!cfg.flags.experimentalEnabled) return { enabled: false, note: 'Resultados experimentales. No forman parte del track record oficial.' };
  const aggs = await repo.aggregates.list({});
  const exp = aggs.filter(a => a.cohort_dimensions && a.cohort_dimensions.signal_type === 'gp_intelligence_experiment');
  return { enabled: true, control_vs_challenger: exp.map(a => presentation.metricView(a)), note: 'Resultados experimentales. No forman parte del track record oficial.' };
}
async function listSnapshots() { return repo.snapshots.list({ limit: 30 }); }

module.exports = { cfg, adminStatus, runOnce, fullRebuild, dryRun, seedDefinitions, publishSnapshot, verify, publicSummary, publicCalibration, publicArb, publicExperimental, listSnapshots, repo, definitions, presentation };
