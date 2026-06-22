// signal-registry/verifier.js — Sprint 5 §29/§35. Verificación de integridad: recomputa hashes y valida la cadena.
'use strict';
const cfg = require('./config');
const hashing = require('./hashing');
const repo = require('./repositories');

// reconstruye el material de contenido de una fila de señal + sus source refs.
function signalContentHash(sigRow, sourceRefRows) {
  return hashing.contentHash({ ...sigRow, source_references: sourceRefRows });
}

// verifySignal(publicIdOrRow) → { valid, checks }
async function verifySignal(idOrRow) {
  const sig = typeof idOrRow === 'string' ? (await repo.signals.byPublicId(idOrRow)) || (await repo.signals.byId(idOrRow)) : idOrRow;
  if (!sig) return { valid: false, error: 'not_found' };
  const refs = await repo.sourceRefs.listForSignal(sig.id);
  const events = await repo.events.listForSignal(sig.id);

  const recomputedContent = signalContentHash(sig, refs);
  const contentOk = recomputedContent === sig.content_hash;
  const recomputedRegistry = hashing.registryHash(sig.previous_registry_hash, sig.content_hash, sig.chain_position);
  const registryOk = recomputedRegistry === sig.registry_hash;

  // cadena de eventos por señal
  let prev = cfg.GENESIS_HASH, eventsOk = true;
  for (const ev of events) {
    const core = { signal_id: ev.signal_id, event_type: ev.event_type, event_version: ev.event_version, reason_code: ev.reason_code, payload: ev.event_payload };
    const h = hashing.eventHash(prev, core);
    if (h !== ev.event_hash || (ev.previous_event_hash || cfg.GENESIS_HASH) !== prev) { eventsOk = false; break; }
    prev = ev.event_hash;
  }

  return {
    valid: contentOk && registryOk && eventsOk,
    checks: { content_hash: contentOk, registry_hash: registryOk, event_chain: eventsOk, chain_position: sig.chain_position },
    public_id: sig.public_id,
  };
}

// verifyChain({ fromPosition, toPosition }) → report. Detecta hash alterado, previous incorrecto, posición faltante/duplicada.
async function verifyChain({ fromPosition = 1 } = {}) {
  const rows = await repo.signals.allOrdered();
  const errors = [];
  let prevHash = cfg.GENESIS_HASH, expectedPos = 1;
  const seen = new Set();
  for (const sig of rows) {
    const pos = Number(sig.chain_position);
    if (seen.has(pos)) errors.push({ position: pos, error: 'duplicate_position' });
    seen.add(pos);
    if (pos !== expectedPos) errors.push({ position: pos, error: 'missing_or_out_of_order', expected: expectedPos });
    if ((sig.previous_registry_hash || cfg.GENESIS_HASH) !== prevHash) errors.push({ position: pos, error: 'previous_hash_mismatch' });
    const refs = await repo.sourceRefs.listForSignal(sig.id);
    const recomputedContent = signalContentHash(sig, refs);
    if (recomputedContent !== sig.content_hash) errors.push({ position: pos, error: 'content_hash_modified' });
    const recomputedRegistry = hashing.registryHash(sig.previous_registry_hash, sig.content_hash, pos);
    if (recomputedRegistry !== sig.registry_hash) errors.push({ position: pos, error: 'registry_hash_modified' });
    prevHash = sig.registry_hash;
    expectedPos = pos + 1;
  }
  return { valid: errors.length === 0, head: rows.length ? Number(rows[rows.length - 1].chain_position) : 0, checked: rows.length, errors };
}

module.exports = { verifySignal, verifyChain, signalContentHash };
