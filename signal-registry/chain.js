// signal-registry/chain.js — Sprint 5 §14. Inserción concurrente-segura en la cadena de hash global.
// Serializa con advisory lock transaccional: dos señales concurrentes nunca reciben la misma posición ni
// un previous_hash incorrecto. Genesis hash documentado en config.
'use strict';
const cfg = require('./config');
const hashing = require('./hashing');
const repo = require('./repositories');

// appendSignalTx(client, signalInput, sourceRefList, opts) → fila de señal insertada.
// DEBE llamarse dentro de una transacción (client). Toma el lock, calcula posición + hashes, inserta señal,
// source references, primer evento 'published' (hash-linked) y la proyección.
async function appendSignalTx(client, input, sourceRefList = [], opts = {}) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [cfg.CHAIN_ADVISORY_LOCK]);
  const head = await repo.signals.chainHead(client);
  const chainPosition = head ? Number(head.chain_position) + 1 : 1;
  const previousRegistryHash = head ? head.registry_hash : cfg.GENESIS_HASH;

  const contentHash = hashing.contentHash({ ...input, source_references: sourceRefList });
  const registryHash = hashing.registryHash(previousRegistryHash, contentHash, chainPosition);

  const row = await repo.signals.insert({
    ...input, chain_position: chainPosition, previous_registry_hash: previousRegistryHash,
    content_hash: contentHash, registry_hash: registryHash,
  }, client);

  for (const ref of sourceRefList) await repo.sourceRefs.insert({ ...ref, signal_id: row.id }, client);

  // primer evento de la señal: 'published' (cadena de eventos por señal arranca en genesis)
  const evCore = { signal_id: row.id, event_type: 'published', event_version: 1, reason_code: 'registered', payload: { chain_position: chainPosition } };
  const eventHash = hashing.eventHash(cfg.GENESIS_HASH, evCore);
  await repo.events.insert({
    signal_id: row.id, event_type: 'published', event_version: 1,
    actor_type: opts.actorId ? 'admin' : 'system', actor_id: opts.actorId || null, reason_code: 'registered',
    event_payload: evCore.payload, previous_event_hash: cfg.GENESIS_HASH, event_hash: eventHash,
  }, client);

  await repo.projection.upsert({
    signal_id: row.id, current_status: 'published', verification_status: row.verification_status,
    score_eligible: row.score_eligible, settlement_status: 'pending', last_event_type: 'published',
    last_event_at: new Date().toISOString(),
  }, client);

  return row;
}

module.exports = { appendSignalTx };
