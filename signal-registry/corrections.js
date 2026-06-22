// signal-registry/corrections.js — Sprint 5 §22. Una corrección NUNCA altera el contenido original.
// Resultado mal registrado → nueva versión de settlement + correction event (ambas versiones quedan visibles).
// NO se permite "corregir" prob/precio/timestamp/modelo publicados: si eran erróneos → marcar disputed.
'use strict';
const db = require('../database/client');
const repo = require('./repositories');
const { settle } = require('./settlement');
const { appendEvent } = require('./eventLog');

function err(code) { const e = new Error(code); e.code = code; return e; }

// Campos del contenido ORIGINAL que no admiten corrección (solo disputa).
const IMMUTABLE_FIELDS = ['probability', 'price', 'timestamp', 'published_at', 'model', 'model_version'];

// addCorrection(signalId, input, opts) → nueva versión de settlement marcada 'corrected' + evento.
//   input: { correctionReason, status, winningOutcomeId, eventResult, source, sourceReference, sourceTimestamp }
async function addCorrection(signalId, input = {}, opts = {}) {
  if (input.field && IMMUTABLE_FIELDS.includes(String(input.field))) throw err('cannot_correct_published_content:' + input.field);
  if (!input.correctionReason) throw err('correction_reason_required');
  // corrección = nueva versión de settlement con estado 'corrected' (o el nuevo estado final)
  return settle(signalId, {
    status: input.status || 'corrected', resultType: input.resultType, winningOutcomeId: input.winningOutcomeId,
    eventResult: input.eventResult, source: input.source, sourceReference: input.sourceReference, sourceTimestamp: input.sourceTimestamp,
    correctionReason: input.correctionReason, settlementPayload: { correction: true, previous_reason: input.previousReason || null },
  }, opts);
}

// markDisputed(signalId, input, opts) → evento 'disputed' + proyección. No reescribe la señal.
async function markDisputed(signalId, { reason, actorId } = {}, opts = {}) {
  const sig = await repo.signals.byId(signalId);
  if (!sig) throw err('signal_not_found');
  const run = (client) => appendEvent(client, signalId, { eventType: 'disputed', reasonCode: reason || 'disputed', actorId, payload: { reason }, projection: { settlement_status: 'disputed', current_status: 'disputed' } });
  return opts.client ? run(opts.client) : db.withTransaction(run);
}

module.exports = { addCorrection, markDisputed, IMMUTABLE_FIELDS };
