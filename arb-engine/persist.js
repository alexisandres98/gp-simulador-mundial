// arb-engine/persist.js — persistencia del motor (Sprint 3). Gated por flags. Best-effort.
// Evaluaciones INMUTABLES (idempotentes por input_hash) + legs + ciclo de vida de oportunidad + run.

'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const db = require('../database/client');
const dbRepos = require('../database/repositories');

function inputHash(ev) {
  const ids = (ev.snapshotIds || []).slice().sort();
  return 'inp:' + crypto.createHash('sha256').update(JSON.stringify({ ids, v: ev.versions.engine, s: ev.strategy, ok: ev.opportunityKey })).digest('hex').slice(0, 32);
}

async function startRun() {
  const r = await db.query(`INSERT INTO arb_engine_runs (status, engine_version) VALUES ('running',$1) RETURNING *`, [cfg.ENGINE_VERSION]);
  return r.rows[0];
}
async function finishRun(id, status, counts, durationMs) {
  await db.query(
    `UPDATE arb_engine_runs SET status=$2, finished_at=now(), candidates_evaluated=$3, pure_arb_count=$4,
       execution_sensitive_count=$5, conditional_count=$6, discrepancy_count=$7, rejected_count=$8, error_count=$9, duration_ms=$10
     WHERE id=$1`,
    [id, status, counts.candidates || 0, counts.pure_arb || 0, counts.execution_sensitive || 0, counts.conditional || 0, counts.price_discrepancy || 0, counts.rejected || 0, counts.errors || 0, durationMs || null]
  );
}

const numOr = v => (v === undefined || v === null || v === '') ? null : String(v);

// persistEvaluation(ev, runId) → { written, duplicate, evaluationId }
async function persistEvaluation(ev, runId) {
  const ih = inputHash(ev);
  const e = ev.evaluation || {};
  const r = await db.query(
    `INSERT INTO arb_evaluations
       (engine_run_id, opportunity_key, canonical_event_id, canonical_market_id, evaluation_type, classification,
        mapping_version, rules_fingerprint, snapshot_ids, input_hash, leg_time_skew_ms,
        gross_margin, fee_total, book_slippage_total, execution_buffer_total, net_margin, capital_required,
        net_profit, net_roi, max_executable_size, confidence_score, confidence_label, rejection_reasons, warning_codes, engine_version,
        semantic_ok, semantic_fatal, semantic_sub_reason, semantic_policy_version, semantic_blockers,
        temporal_ok, capacity_status, confirmed_executable_size, temporal_capacity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
     ON CONFLICT (input_hash) DO NOTHING RETURNING id`,
    [runId || null, ev.opportunityKey, uuidOrNull(ev.canonicalEventId), uuidOrNull(ev.canonicalMarketId), ev.strategy, ev.classification,
     ev.mappingVersion, ev.rulesFingerprint, ev.snapshotIds || [], ih, ev.legTimeSkewMs,
     numOr(e.grossProfit), numOr(e.feeTotal), numOr(e.feeTotal /* book slippage está en el VWAP */ ? '0' : '0'), numOr(e.executionBuffer),
     numOr(e.netProfit), numOr(e.capitalRequired), numOr(e.netProfit), numOr(e.netRoi), ev.maxSize ? numOr(ev.maxSize.maxQuantity) : null,
     ev.confidence ? ev.confidence.score : null, ev.confidence ? ev.confidence.label : null,
     JSON.stringify(ev.reasons || []), JSON.stringify(ev.warnings || []), ev.versions.engine,
     // Fase R.1: veredicto del gate semántico (aditivo, columnas mig 038)
     ev.semantic ? ev.semantic.ok : null, ev.semantic ? ev.semantic.fatal : null,
     ev.semantic ? ev.semantic.sub_reason : null, ev.semantic ? ev.semantic.policy_version : null,
     JSON.stringify(ev.semantic ? (ev.semantic.blockers || []) : []),
     // Fase R.2: contemporaneidad temporal + capacidad honesta (aditivo, columnas mig 039)
     ev.temporal ? ev.temporal.ok : null, ev.capacity ? ev.capacity.capacity_status : null,
     ev.capacity && ev.capacity.confirmed_executable_size != null ? String(ev.capacity.confirmed_executable_size) : null,
     JSON.stringify({ temporal: ev.temporal || null, capacity: ev.capacity || null })]
  );
  if (!r.rowCount) return { written: false, duplicate: true, evaluationId: null };
  const evaluationId = r.rows[0].id;
  // legs
  const legs = e.legs || [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    let providerId = null;
    try { const p = await dbRepos.providers.findByCode(l.provider); providerId = p ? p.id : null; } catch { /* noop */ }
    await db.query(
      `INSERT INTO arb_evaluation_legs (evaluation_id, leg_index, provider_id, side, quantity, best_price, vwap, worst_price, gross_cost, fee, execution_buffer, price_source, depth_consumed, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (evaluation_id, leg_index) DO NOTHING`,
      [evaluationId, i, providerId, l.side, numOr(e.quantity), numOr(l.bestPrice), numOr(l.vwap), numOr(l.worstPrice), numOr(l.grossCost), numOr(l.fee), numOr(e.executionBuffer), l.priceSource, l.depthConsumed, JSON.stringify({ feeStatus: l.feeStatus, maxAcceptablePrice: l.maxAcceptablePrice })]
    );
  }
  // ciclo de vida de oportunidad
  await upsertOpportunity(ev, evaluationId);
  return { written: true, duplicate: false, evaluationId };
}

async function upsertOpportunity(ev, evaluationId) {
  const e = ev.evaluation || {};
  const positive = ev.classification === 'pure_arb' || ev.classification === 'execution_sensitive';
  const status = ev.classification === 'conditional' ? 'rejected' : positive ? 'detected' : ev.classification === 'price_discrepancy' ? 'detected' : 'rejected';
  await db.query(
    `INSERT INTO arb_opportunities (opportunity_key, canonical_event_id, canonical_market_id, classification, observation_count, best_net_roi, best_net_profit, best_executable_size, current_evaluation_id, status, last_validated_at)
     VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9, CASE WHEN $10 THEN now() ELSE NULL END)
     ON CONFLICT (opportunity_key) DO UPDATE SET
       classification = EXCLUDED.classification, last_seen_at = now(), observation_count = arb_opportunities.observation_count + 1,
       best_net_roi = GREATEST(COALESCE(arb_opportunities.best_net_roi, '-1'), COALESCE(EXCLUDED.best_net_roi, '-1')),
       best_net_profit = GREATEST(COALESCE(arb_opportunities.best_net_profit, '-1e9'), COALESCE(EXCLUDED.best_net_profit, '-1e9')),
       best_executable_size = GREATEST(COALESCE(arb_opportunities.best_executable_size, '0'), COALESCE(EXCLUDED.best_executable_size, '0')),
       current_evaluation_id = EXCLUDED.current_evaluation_id, status = EXCLUDED.status,
       last_validated_at = CASE WHEN $10 THEN now() ELSE arb_opportunities.last_validated_at END`,
    [ev.opportunityKey, uuidOrNull(ev.canonicalEventId), uuidOrNull(ev.canonicalMarketId), ev.classification,
     numOr(e.netRoi), numOr(e.netProfit), ev.maxSize ? numOr(ev.maxSize.maxQuantity) : null, evaluationId, status, positive]
  );
}

function uuidOrNull(v) { return /^[0-9a-f-]{36}$/i.test(String(v || '')) ? v : null; }

async function counts() {
  const r = await db.query(`SELECT
    (SELECT count(*)::int FROM arb_opportunities) AS opportunities,
    (SELECT count(*)::int FROM arb_opportunities WHERE classification='pure_arb') AS pure_arb,
    (SELECT count(*)::int FROM arb_opportunities WHERE classification='execution_sensitive') AS execution_sensitive,
    (SELECT count(*)::int FROM arb_evaluations) AS evaluations,
    (SELECT count(*)::int FROM arb_engine_runs) AS runs`);
  return r.rows[0];
}

module.exports = { startRun, finishRun, persistEvaluation, upsertOpportunity, counts, inputHash };
