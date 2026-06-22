// signal-registry/hashing.js — Sprint 5 §13-14. Hashing determinístico de contenido y de cadena.
'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { canonicalString } = require('./canonicalize');

function sha256(str) { return crypto.createHash('sha256').update(str, 'utf8').digest('hex'); }

// contentHash(signal) → hash del CONTENIDO lógico de la señal (no incluye hashes de cadena ni proyección).
// Cubre: tipo, payloads, timestamps relevantes, IDs canónicos, versiones, source references.
function contentHash(signal) {
  const material = {
    signal_type: signal.signal_type,
    signal_schema_version: signal.signal_schema_version,
    canonical_event_id: signal.canonical_event_id || null,
    canonical_market_id: signal.canonical_market_id || null,
    canonical_outcome_id: signal.canonical_outcome_id || null,
    direction: signal.direction || null,
    event_start_at: isoOrNull(signal.event_start_at),
    market_close_at: isoOrNull(signal.market_close_at),
    source_created_at: isoOrNull(signal.source_created_at),
    published_at: isoOrNull(signal.published_at),
    input_cutoff_at: isoOrNull(signal.input_cutoff_at),
    model_version: signal.model_version || null,
    methodology_version: signal.methodology_version || null,
    mapping_version: signal.mapping_version || null,
    rules_version: signal.rules_version || null,
    normalizer_version: signal.normalizer_version || null,
    prediction_edition: signal.prediction_edition || null,
    supersedes_signal_id: signal.supersedes_signal_id || null,
    signal_payload: signal.signal_payload || {},
    public_payload: signal.public_payload || {},
    source_references: (signal.source_references || []).map(s => ({
      source_type: s.source_type, source_id: s.source_id || null, source_version: s.source_version || null,
      content_hash: s.content_hash || null, snapshot_timestamp: isoOrNull(s.snapshot_timestamp),
    })),
  };
  return sha256(canonicalString(material));
}

// registryHash(previousRegistryHash, contentHash, chainPosition) → eslabón de la cadena global.
function registryHash(previousRegistryHash, contentHashHex, chainPosition) {
  return sha256(`${previousRegistryHash || cfg.GENESIS_HASH}|${contentHashHex}|${chainPosition}`);
}

// eventHash(previousEventHash, eventCore) → hash de evento, encadenado por señal.
function eventHash(previousEventHash, eventCore) {
  return sha256(`${previousEventHash || cfg.GENESIS_HASH}|${canonicalString(eventCore)}`);
}

// settlementHash(core) → hash de contenido de un settlement.
function settlementHash(core) { return sha256(canonicalString(core)); }

// merkleRoot(hashes[]) → raíz determinística (duplica el último si nivel impar). Vacío → genesis.
function merkleRoot(hashes) {
  let level = (hashes || []).slice();
  if (!level.length) return sha256('empty:' + cfg.GENESIS_HASH);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = level[i + 1] || level[i];
      next.push(sha256(a + b));
    }
    level = next;
  }
  return level[0];
}

function isoOrNull(v) { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }

module.exports = { sha256, contentHash, registryHash, eventHash, settlementHash, merkleRoot, isoOrNull };
