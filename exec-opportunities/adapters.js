// exec-opportunities/adapters.js — Sprint 4. Reconstruye la "vista de evaluación" (shape de evaluateCandidate)
// desde filas de DB (arb_evaluations + arb_evaluation_legs) para el camino con DATOS VIVOS (admin).
// Best-effort: se activa del todo cuando Sprints 2-3 están activos y hay evaluaciones reales.
'use strict';
const db = require('../database/client');

const str = v => (v === null || v === undefined ? null : String(v));
const parseJ = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

function reconstructEvalView(evalRow, legRows) {
  const positive = ['pure_arb', 'execution_sensitive'].includes(evalRow.classification);
  return {
    classification: evalRow.classification,
    strategy: evalRow.evaluation_type || (legRows.length === 3 ? '1x2' : 'binary'),
    rulesFingerprint: evalRow.rules_fingerprint,
    mappingVersion: evalRow.mapping_version,
    mappingStatusForDisplay: positive ? 'matched' : 'unknown',
    legTimeSkewMs: evalRow.leg_time_skew_ms,
    warnings: parseJ(evalRow.warning_codes),
    reasons: parseJ(evalRow.rejection_reasons),
    versions: { engine: evalRow.engine_version, feeEngine: 'fee-1', classifier: 'cls-1' },
    confidence: { score: evalRow.confidence_score, label: evalRow.confidence_label, factors: [] },
    evaluation: {
      netRoi: str(evalRow.net_roi), netProfit: str(evalRow.net_profit), grossRoi: str(evalRow.gross_margin),
      feeTotal: str(evalRow.fee_total), executionBuffer: str(evalRow.execution_buffer_total),
      capitalRequired: str(evalRow.capital_required), totalCost: str(evalRow.capital_required), payout: null,
      feeStatus: positive ? 'known' : 'unknown', fullyFillable: positive,
      legs: (legRows || []).map(l => ({
        provider: l.provider_code || l.provider, side: l.side, bestPrice: str(l.best_price), vwap: str(l.vwap),
        worstPrice: str(l.worst_price), grossCost: str(l.gross_cost), fee: str(l.fee), feeStatus: 'known',
        depthConsumed: l.depth_consumed, priceSource: l.price_source, maxAcceptablePrice: null, quantity: str(l.quantity),
      })),
    },
    maxSize: { maxQuantity: str(evalRow.max_executable_size), evaluation: { capitalRequired: str(evalRow.capital_required) } },
  };
}

// loadLiveContext(opportunityKey) → { evaluationView, context } | null  (best-effort, lee DB)
async function loadLiveContext(opportunityKey, { now = Date.now() } = {}) {
  const evs = await db.query('SELECT * FROM arb_evaluations WHERE opportunity_key=$1 ORDER BY created_at DESC LIMIT 1', [opportunityKey]);
  const evalRow = evs.rows[0];
  if (!evalRow) return null;
  const legs = await db.query(
    `SELECT l.*, p.code AS provider_code FROM arb_evaluation_legs l
     LEFT JOIN providers p ON p.id = l.provider_id WHERE l.evaluation_id=$1 ORDER BY l.leg_index`, [evalRow.id]);
  const opp = (await db.query('SELECT * FROM arb_opportunities WHERE opportunity_key=$1', [opportunityKey])).rows[0] || {};
  const evaluationView = reconstructEvalView(evalRow, legs.rows);

  // título best-effort desde canonical
  let event = null, market = null;
  if (opp.canonical_event_id) {
    const ce = (await db.query('SELECT home_participant, away_participant FROM canonical_events WHERE id=$1', [opp.canonical_event_id])).rows[0];
    if (ce) event = [ce.home_participant, ce.away_participant].filter(Boolean).join(' vs. ') || null;
  }
  if (opp.canonical_market_id) {
    const cm = (await db.query('SELECT market_type, period FROM canonical_markets WHERE id=$1', [opp.canonical_market_id])).rows[0];
    if (cm) market = (cm.market_type || 'mercado') + (cm.period ? ' — ' + cm.period : '');
  }

  const context = {
    evaluationId: evalRow.id,
    mappingStatus: evaluationView.mappingStatusForDisplay,
    outcomeMappingStatus: evaluationView.mappingStatusForDisplay,
    hardConflicts: 0,
    marketStatus: 'open',
    currentMappingVersion: evalRow.mapping_version,
    currentRulesFingerprint: evalRow.rules_fingerprint,
    opportunityStatus: opp.status || null,
    lastValidatedAt: opp.last_validated_at || null,
    detectedAt: opp.first_detected_at || null,
    evaluationAgeMs: evalRow.created_at ? now - new Date(evalRow.created_at).getTime() : null,
    event, market, now,
    legMeta: (legs.rows || []).map(l => ({ provider: l.provider_code, side: l.side })),
  };
  return { evaluationView, context };
}

module.exports = { reconstructEvalView, loadLiveContext };
