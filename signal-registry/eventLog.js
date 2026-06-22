// signal-registry/eventLog.js — Sprint 5 §21. Append de eventos hash-linked por señal + proyección.
'use strict';
const cfg = require('./config');
const hashing = require('./hashing');
const repo = require('./repositories');

// appendEvent(client, signalId, { eventType, reasonCode, actorId, payload, projection }) → evento
// Encadena con el último evento de la señal. NO altera la señal original. Actualiza la proyección (mutable).
async function appendEvent(client, signalId, { eventType, reasonCode = null, actorId = null, payload = {}, projection = {} } = {}) {
  const last = await repo.events.lastForSignal(signalId, client);
  const prevHash = last ? last.event_hash : cfg.GENESIS_HASH;
  const version = last ? (last.event_version || 1) + 1 : 1;
  const evCore = { signal_id: signalId, event_type: eventType, event_version: version, reason_code: reasonCode, payload };
  const eventHash = hashing.eventHash(prevHash, evCore);
  const ev = await repo.events.insert({
    signal_id: signalId, event_type: eventType, event_version: version,
    actor_type: actorId ? 'admin' : 'system', actor_id: actorId, reason_code: reasonCode,
    event_payload: payload, previous_event_hash: prevHash, event_hash: eventHash,
  }, client);
  await repo.projection.upsert({ signal_id: signalId, last_event_type: eventType, last_event_at: new Date().toISOString(), ...projection }, client);
  return ev;
}

module.exports = { appendEvent };
