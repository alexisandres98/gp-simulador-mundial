// signal-registry/settlement.js — Sprint 5 §23-24. Settlement versionado, idempotente. No reescribe la señal.
// Arb: realized_roi SIEMPRE null (GP no ejecuta) → result_type theoretical_structure_settled | not_executed.
'use strict';
const db = require('../database/client');
const hashing = require('./hashing');
const repo = require('./repositories');
const { appendEvent } = require('./eventLog');

function err(code) { const e = new Error(code); e.code = code; return e; }

const EVENT_FOR_STATUS = { pending: 'settlement_pending', provisional: 'settled', final: 'settled', void: 'voided', cancelled: 'cancelled', disputed: 'disputed', corrected: 'correction_added' };

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
      is_final: input.status === 'final', void_reason: input.voidReason || null, correction_reason: input.correctionReason || null,
      realized_roi: null, // INVARIANTE
      settlement_payload: input.settlementPayload || {},
    };
    core.content_hash = hashing.settlementHash({ ...core, settled_at: undefined, created_at: undefined });
    core.settled_at = ['final', 'provisional', 'void', 'cancelled'].includes(input.status) ? new Date().toISOString() : null;
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

module.exports = { settle };
