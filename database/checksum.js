// database/checksum.js — checksum determinístico del CONTENIDO de un payload (Sprint 0.1).
// Sirve para detectar contenido idéntico (no para identidad de negocio ni para deduplicar
// observaciones temporales). Se calcula sobre el payload canonicalizado (claves ordenadas),
// EXCLUYENDO campos volátiles y secretos. NUNCA incluye received_at, tokens, headers ni keys.
//
// IMPORTANTE: dos observaciones del mismo contenido en momentos distintos comparten checksum
// pero son filas distintas (distinto id/received_at). El checksum NO debe usarse para borrar
// observaciones legítimas. Ver sprint-0-data-policies.md y sprint-0-identifiers.md.

'use strict';
const crypto = require('crypto');

// Campos que jamás entran al hash: volátiles locales o sensibles.
const ALWAYS_EXCLUDE = new Set([
  'received_at', 'fetched_at', 'processed_at', 'created_at', 'request_latency_ms',
  'authorization', 'cookie', 'set-cookie', 'token', 'api_key', 'apikey',
  'x-apisports-key', 'password', 'secret', '_meta', '_local',
]);

function canonicalize(value, exclude) {
  if (Array.isArray(value)) return value.map(v => canonicalize(v, exclude));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (exclude.has(k.toLowerCase())) continue;
      out[k] = canonicalize(value[k], exclude);
    }
    return out;
  }
  return value;
}

// computeChecksum(payload, { exclude?: string[] }) → 'sha256:<hex>'
function computeChecksum(payload, { exclude = [] } = {}) {
  const ex = new Set(ALWAYS_EXCLUDE);
  for (const k of exclude) ex.add(String(k).toLowerCase());
  const canon = canonicalize(payload, ex);
  const json = JSON.stringify(canon);
  return 'sha256:' + crypto.createHash('sha256').update(json).digest('hex');
}

module.exports = { computeChecksum, ALWAYS_EXCLUDE };
