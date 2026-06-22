// metrics-engine/rebuild.js — Sprint 6 §27. Orquestador: señales → facts → agregados (idempotente, en un run).
// NO modifica señales. Reconstruible: una corrección de settlement recalcula facts y agregados; los snapshots
// públicos previos NO se reescriben (se crea uno nuevo al publicar).
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const repo = require('./repositories');
const { buildFact } = require('./facts');
const { aggregateMetric } = require('./aggregations');
const locks = require('../market-data/locks');

// cohortes acotadas a agregar (no millones de combinaciones)
const OFFICIAL_METRICS = ['brier_multiclass', 'log_loss_multiclass', 'accuracy_top1', 'ece_equal_width'];
const CLV_METRICS = ['clv_probability_points', 'clv_log_odds', 'closing_beat_rate'];

async function loadInputs(client = db) {
  const r = await client.query(`
    SELECT s.*,
      (SELECT row_to_json(x) FROM (SELECT * FROM signal_settlements ss WHERE ss.signal_id=s.id ORDER BY settlement_version DESC LIMIT 1) x) AS settlement,
      (SELECT row_to_json(y) FROM (SELECT * FROM signal_closing_snapshots cs WHERE cs.signal_id=s.id ORDER BY (capture_status='captured') DESC, created_at DESC LIMIT 1) y) AS closing
    FROM signals s WHERE s.chain_position IS NOT NULL ORDER BY s.chain_position ASC`);
  return r.rows;
}

// run(opts) → resumen. runType: incremental | full_rebuild | correction_rebuild | dry_run.
async function run({ runType = 'incremental', verifiedEpoch = cfg.params && null, dryRun = false } = {}) {
  const epoch = verifiedEpoch || require('../signal-registry/config').params.verifiedEpoch;
  const t0 = Date.now();
  const counts = { scanned: 0, created: 0, updated: 0, excluded: 0, aggregates: 0, errors: 0 };
  let runRow = null;
  if (cfg.flags.writeEnabled && !dryRun) runRow = await repo.runs.start(runType);

  const inputs = await loadInputs();
  counts.scanned = inputs.length;
  const headRow = inputs.length ? Number(inputs[inputs.length - 1].chain_position) : null;

  // 1) facts en memoria + persistencia
  const facts = [];
  for (const row of inputs) {
    try {
      const fact = buildFact(row, row.settlement, row.closing, { verifiedEpoch: epoch });
      facts.push(fact);
      if (fact.eligibility_status === 'excluded') counts.excluded++;
      if (cfg.flags.writeEnabled && !dryRun) { const inserted = await repo.facts.upsert(fact, runRow && runRow.id); inserted ? counts.created++ : counts.updated++; }
    } catch { counts.errors++; }
  }

  // 2) agregados por (métrica, cohorte) sobre facts elegibles
  const aggsOut = [];
  const cohorts = [
    { picked: ['signal_type', 'model_version'], metrics: OFFICIAL_METRICS, filter: f => f.signal_type === 'model_prediction_v1' },
    { picked: ['signal_type'], metrics: CLV_METRICS, filter: f => true },
  ];
  for (const c of cohorts) {
    const subset = facts.filter(c.filter);
    if (!subset.length) continue;
    for (const metricCode of c.metrics) {
      const agg = aggregateMetric(subset, { metricCode, cohortPicked: c.picked, inputChainHead: headRow });
      if (agg.sample_size === 0 && agg.value === null) continue; // no publicar cohortes vacías
      aggsOut.push(agg);
      if (cfg.flags.writeEnabled && !dryRun) {
        const id = await repo.aggregates.upsert(agg, runRow && runRow.id);
        if (agg.calibration_bins) await repo.calibrationBins.replaceForAggregate(id, agg.calibration_bins);
        counts.aggregates++;
      }
    }
  }

  if (runRow) await repo.runs.finish(runRow.id, counts.errors ? 'partial' : 'success', counts, Date.now() - t0);
  return { runType, counts, inputChainHead: headRow, dryRun: dryRun || !cfg.flags.writeEnabled, aggregates: aggsOut, facts: dryRun ? facts : undefined };
}

// runLocked — con advisory lock anti-solape (para el scheduler/endpoints).
async function runLocked(opts = {}) {
  const lr = await locks.withLock(cfg.ADVISORY_LOCK.resource, cfg.ADVISORY_LOCK.op, () => run(opts));
  return lr.acquired ? lr.result : { skipped: lr.skipped };
}

module.exports = { run, runLocked, loadInputs, OFFICIAL_METRICS, CLV_METRICS };
