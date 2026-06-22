// metrics-engine/repositories.js — Sprint 6. DB del motor de métricas. Facts/aggregates reconstruibles;
// snapshots inmutables (solo INSERT). Parametrizado.
'use strict';
const db = require('../database/client');
const jsonOr = v => (v == null ? null : JSON.stringify(v));
const numOr = v => (v === undefined || v === null || v === '') ? null : String(v);
const uuidOrNull = v => (/^[0-9a-f-]{36}$/i.test(String(v || '')) ? v : null);

const definitions = {
  async seedAll(defs) {
    for (const d of defs) {
      await db.query(
        `INSERT INTO metric_definitions (metric_code, metric_name, metric_version, signal_type, calculation_type, formula_description, eligibility_policy, minimum_sample_size, higher_is_better, unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (metric_code, metric_version) DO UPDATE SET metric_name=EXCLUDED.metric_name, formula_description=EXCLUDED.formula_description`,
        [d.metric_code, d.metric_name, d.metric_version, d.signal_type || null, d.calculation_type || null, d.formula_description || null, d.eligibility_policy || null, d.minimum_sample_size || null, d.higher_is_better, d.unit || null]
      );
    }
  },
  async all() { return (await db.query('SELECT * FROM metric_definitions ORDER BY metric_code')).rows; },
};

const runs = {
  async start(runType = 'incremental', { metricVersion = 'metrics-1', codeVersion = 'metrics-1', inputChainHead = null } = {}) {
    const r = await db.query(`INSERT INTO metric_runs (status, run_type, metric_version, code_version, input_chain_head) VALUES ('running',$1,$2,$3,$4) RETURNING *`, [runType, metricVersion, codeVersion, inputChainHead]);
    return r.rows[0];
  },
  async finish(id, status, c = {}, durationMs = null) {
    await db.query(
      `UPDATE metric_runs SET status=$2, finished_at=now(), signals_scanned=$3, facts_created=$4, facts_updated=$5, signals_excluded=$6, aggregates_created=$7, errors=$8, duration_ms=$9 WHERE id=$1`,
      [id, status, c.scanned || 0, c.created || 0, c.updated || 0, c.excluded || 0, c.aggregates || 0, c.errors || 0, durationMs]
    );
  },
  async recent({ limit = 20 } = {}) { return (await db.query('SELECT * FROM metric_runs ORDER BY created_at DESC LIMIT $1', [Math.min(limit, 100)])).rows; },
};

const facts = {
  async upsert(f, runId = null) {
    const r = await db.query(
      `INSERT INTO signal_metric_facts
        (signal_id, metric_version, signal_type, model_version, methodology_version, sport, competition, market_family,
         prediction_horizon, probability_bucket, data_quality, published_at, event_start_at, settled_at, settlement_outcome,
         benchmark_status, experimental, metrics, calibration_points, eligibility_status, clv_eligibility_status, exclusion_reasons,
         cohort_dimensions, input_hash, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (signal_id, metric_version) DO UPDATE SET
         metrics=EXCLUDED.metrics, calibration_points=EXCLUDED.calibration_points, eligibility_status=EXCLUDED.eligibility_status,
         clv_eligibility_status=EXCLUDED.clv_eligibility_status, exclusion_reasons=EXCLUDED.exclusion_reasons,
         settlement_outcome=EXCLUDED.settlement_outcome, settled_at=EXCLUDED.settled_at, benchmark_status=EXCLUDED.benchmark_status,
         cohort_dimensions=EXCLUDED.cohort_dimensions, input_hash=EXCLUDED.input_hash, calculated_at=now(), run_id=EXCLUDED.run_id
       RETURNING (xmax = 0) AS inserted`,
      [uuidOrNull(f.signal_id), f.metric_version, f.signal_type, f.model_version, f.methodology_version, f.sport, f.competition, f.market_family,
       f.prediction_horizon, f.probability_bucket, f.data_quality, f.published_at, f.event_start_at, f.settled_at, f.settlement_outcome,
       f.benchmark_status, !!f.experimental, jsonOr(f.metrics), jsonOr(f.calibration_points), f.eligibility_status, f.clv_eligibility_status, jsonOr(f.exclusion_reasons),
       jsonOr(f.cohort_dimensions), f.input_hash, uuidOrNull(runId)]
    );
    return r.rows[0] ? r.rows[0].inserted : false;
  },
  async all() { return (await db.query('SELECT * FROM signal_metric_facts')).rows; },
  async counts() {
    const r = await db.query(`SELECT count(*)::int total, count(*) FILTER (WHERE eligibility_status='eligible' AND NOT experimental)::int eligible, count(*) FILTER (WHERE experimental)::int experimental, count(*) FILTER (WHERE eligibility_status='excluded')::int excluded FROM signal_metric_facts`);
    return r.rows[0];
  },
  async exclusions({ limit = 200 } = {}) { return (await db.query(`SELECT signal_id, signal_type, exclusion_reasons FROM signal_metric_facts WHERE eligibility_status='excluded' LIMIT $1`, [limit])).rows; },
};

const aggregates = {
  async upsert(a, runId = null) {
    const r = await db.query(
      `INSERT INTO metric_aggregates
        (metric_code, metric_version, cohort_key, cohort_dimensions, sample_size, eligible_count, excluded_count, value,
         secondary_values, confidence_interval, sample_status, from_date, to_date, input_chain_head, idempotency_key, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         sample_size=EXCLUDED.sample_size, eligible_count=EXCLUDED.eligible_count, excluded_count=EXCLUDED.excluded_count,
         value=EXCLUDED.value, secondary_values=EXCLUDED.secondary_values, confidence_interval=EXCLUDED.confidence_interval,
         sample_status=EXCLUDED.sample_status, calculated_at=now(), run_id=EXCLUDED.run_id
       RETURNING id`,
      [a.metric_code, a.metric_version, a.cohort_key, jsonOr(a.cohort_dimensions), a.sample_size, a.eligible_count, a.excluded_count, numOr(a.value),
       jsonOr(a.secondary_values), jsonOr(a.confidence_interval), a.sample_status, a.from_date, a.to_date, a.input_chain_head, a.idempotency_key, uuidOrNull(runId)]
    );
    return r.rows[0].id;
  },
  async list({ metricCode = null, cohortKey = null } = {}) {
    const w = [], p = [];
    if (metricCode) { p.push(metricCode); w.push(`metric_code=$${p.length}`); }
    if (cohortKey) { p.push(cohortKey); w.push(`cohort_key=$${p.length}`); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    // más reciente primero: el agregado se versiona por input_chain_head (historia preservada);
    // las vistas "actuales" toman el de la cabeza de cadena más reciente.
    return (await db.query(`SELECT * FROM metric_aggregates ${where} ORDER BY calculated_at DESC, metric_code`, p)).rows;
  },
};

const calibrationBins = {
  async replaceForAggregate(aggregateId, bins) {
    await db.query('DELETE FROM metric_calibration_bins WHERE aggregate_id=$1', [aggregateId]);
    for (const b of bins || []) {
      await db.query(
        `INSERT INTO metric_calibration_bins (aggregate_id, bucket_start, bucket_end, predicted_average, observed_frequency, sample_size, confidence_low, confidence_high, absolute_gap)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [aggregateId, b.bucket_start, b.bucket_end, b.predicted_average, b.observed_frequency, b.sample_size, b.confidence_low ?? null, b.confidence_high ?? null, b.absolute_gap]
      );
    }
  },
  async forAggregate(aggregateId) { return (await db.query('SELECT * FROM metric_calibration_bins WHERE aggregate_id=$1 ORDER BY bucket_start', [aggregateId])).rows; },
};

const snapshots = {
  async insert(s) {
    const r = await db.query(
      `INSERT INTO public_metric_snapshots (public_id, metric_versions, input_chain_head, settlement_cutoff, sample_counts, aggregate_values, methodology_version, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [s.public_id, jsonOr(s.metric_versions), s.input_chain_head, s.settlement_cutoff, jsonOr(s.sample_counts), jsonOr(s.aggregate_values), s.methodology_version, s.content_hash]
    );
    return r.rows[0];
  },
  async latest() { return (await db.query('SELECT * FROM public_metric_snapshots ORDER BY published_at DESC LIMIT 1')).rows[0] || null; },
  async byPublicId(id) { return (await db.query('SELECT * FROM public_metric_snapshots WHERE public_id=$1', [id])).rows[0] || null; },
  async list({ limit = 30 } = {}) { return (await db.query('SELECT public_id, published_at, input_chain_head, methodology_version, content_hash FROM public_metric_snapshots ORDER BY published_at DESC LIMIT $1', [limit])).rows; },
};

module.exports = { definitions, runs, facts, aggregates, calibrationBins, snapshots };
