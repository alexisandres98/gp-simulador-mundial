// signal-registry/settlement.js — Sprint 5 §23-24. Settlement versionado, idempotente. No reescribe la señal.
// Arb: realized_roi SIEMPRE null (GP no ejecuta) → result_type theoretical_structure_settled | not_executed.
'use strict';
const db = require('../database/client');
const hashing = require('./hashing');
const repo = require('./repositories');
const { appendEvent } = require('./eventLog');

function err(code) { const e = new Error(code); e.code = code; return e; }

const EVENT_FOR_STATUS = { pending: 'settlement_pending', provisional: 'settled', final: 'settled', won: 'settled', lost: 'settled', push: 'settled', void: 'voided', cancelled: 'cancelled', postponed: 'settlement_pending', abandoned: 'settlement_pending', unresolved: 'settlement_pending', disputed: 'disputed', corrected: 'correction_added' };
const FINAL_STATUSES = ['final', 'won', 'lost', 'void', 'push', 'cancelled'];
const SETTLED_AT_STATUSES = ['final', 'provisional', 'won', 'lost', 'push', 'void', 'cancelled'];

// settle(signalId, input, opts) → { settlement, skipped } | persiste nueva versión + evento + proyección.
//   input: { status, resultType, winningOutcomeId, eventResult, source, sourceReference, sourceTimestamp, isFinal, voidReason, settlementPayload }
async function settle(signalId, input = {}, opts = {}) {
  const sig = await repo.signals.byId(signalId);
  if (!sig) throw err('signal_not_found');
  // arb: nunca ROI realizado
  const isArb = sig.signal_type === 'arb_publication';
  if (input.realizedRoi != null) throw err('realized_roi_not_allowed');

  const run = async (client) => {
    // idempotencia: misma fuente + referencia no se duplica
    if (await repo.settlements.exists(signalId, input.source, input.sourceReference)) {
      return { skipped: true, reason: 'duplicate_source' };
    }
    const version = (await repo.settlements.latestVersion(signalId, client)) + 1;
    const resultType = input.resultType || (isArb ? 'theoretical_structure_settled' : 'model_prediction');
    const core = {
      signal_id: signalId, settlement_version: version, settlement_status: input.status,
      result_type: resultType, winning_outcome_id: input.winningOutcomeId || null,
      event_result: input.eventResult || null, settlement_source: input.source || null,
      source_reference: input.sourceReference || null, source_timestamp: input.sourceTimestamp || null,
      is_final: FINAL_STATUSES.includes(input.status), void_reason: input.voidReason || null, correction_reason: input.correctionReason || null,
      realized_roi: null, // INVARIANTE
      settlement_payload: input.settlementPayload || {},
      // Fase H: resultado factual de tiempo reglamentario + finalidad del proveedor (§8-10)
      result_outcome: input.resultOutcome || null, provider_result_status: input.providerResultStatus || null,
      result_observed_at: input.resultObservedAt || null, result_finalized_at: input.resultFinalizedAt || null,
      regulation_score: input.regulationScore || null, settlement_policy_version: input.settlementPolicyVersion || null,
      capture_source: input.captureSource || 'automatic', provider_fixture_id: input.providerFixtureId || null,
    };
    core.content_hash = hashing.settlementHash({ ...core, settled_at: undefined, created_at: undefined });
    core.settled_at = SETTLED_AT_STATUSES.includes(input.status) ? new Date().toISOString() : null;
    const settlement = await repo.settlements.insert(core, client);

    await appendEvent(client, signalId, {
      eventType: EVENT_FOR_STATUS[input.status] || 'settled', reasonCode: input.status, actorId: opts.actorId,
      payload: { settlement_version: version, result_type: resultType, winning_outcome_id: core.winning_outcome_id },
      projection: { settlement_status: input.status, latest_settlement_version: version, current_status: isArb ? undefined : undefined },
    });
    return { settlement };
  };
  return opts.client ? run(opts.client) : db.withTransaction(run);
}

// settleFromProvider(signalId, providerInput, opts) — §9-12. Resuelve el resultado factual reglamentario vía el
// proveedor y persiste un settlement versionado. Aplica el guard §12: una señal en DATA_ERROR no se liquida
// automáticamente (resolución requiere acción admin). QUARANTINED sí permite captura factual.
async function settleFromProvider(signalId, providerInput = {}, opts = {}) {
  const provider = require('./settlementProvider');
  const adminState = (await db.query(`SELECT admin_status FROM signal_admin_state WHERE signal_id=$1`, [signalId]).catch(() => ({ rows: [] }))).rows[0];
  if (adminState && adminState.admin_status === 'DATA_ERROR') return { skipped: true, reason: 'blocked_data_error' };
  const resolved = provider.resolveRegulation1x2(providerInput);
  return settle(signalId, {
    status: resolved.settlement_status, resultOutcome: resolved.result_outcome, winningOutcomeId: ['home', 'draw', 'away'].includes(resolved.result_outcome) ? resolved.result_outcome : null,
    providerResultStatus: resolved.provider_result_status, resultObservedAt: resolved.result_observed_at, resultFinalizedAt: resolved.result_finalized_at,
    regulationScore: resolved.regulation_score || null, settlementPolicyVersion: resolved.settlement_policy_version,
    source: providerInput.source || provider.PROVIDER, sourceReference: providerInput.sourceReference || null,
    eventResult: resolved.regulation_score || null, voidReason: resolved.result_outcome === 'void' ? (providerInput.voidReason || 'event_void') : null,
    captureSource: providerInput.captureSource || 'automatic', providerFixtureId: providerInput.providerFixtureId || null,
  }, opts);
}

module.exports = { settle, settleFromProvider };
