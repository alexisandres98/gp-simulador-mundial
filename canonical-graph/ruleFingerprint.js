// canonical-graph/ruleFingerprint.js — fingerprint determinístico de reglas normalizadas (Sprint 2).
// Depende SOLO de la semántica MATERIAL (no de espacios/formato/texto libre). Cambia si cambia una
// condición material; estable ante reformateo. Versionado.

'use strict';
const crypto = require('crypto');
const FINGERPRINT_VERSION = 'rule-fp-2';

// Campos materiales que definen la EXPOSICIÓN (qué se apuesta). Orden fijo, valores canónicos (null→'?').
// rule-fp-2: se excluyen campos OPERATIVOS/de detección (settlementTrigger, resolutionSource, postponement,
// abandonment) que dependen del texto y de heurísticas por proveedor — dos mercados con la MISMA exposición
// (mismo período/prórroga/penales/empate/clasificación) deben tener el mismo fingerprint aunque su texto difiera.
// La precisión se mantiene: una diferencia de exposición real (p.ej. penales/empate distinto) SÍ cambia el hash.
const MATERIAL_FIELDS = [
  'marketPeriod', 'includesExtraTime', 'includesPenalties', 'drawPossible', 'qualificationMarket',
];

function canonValue(v) {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

// fingerprint(normalizedRules) → 'rule-fp-1:sha256:<hex>'
function fingerprint(normalizedRules = {}) {
  const parts = MATERIAL_FIELDS.map(f => `${f}=${canonValue(normalizedRules[f])}`);
  const canon = parts.join('|');
  return `${FINGERPRINT_VERSION}:sha256:` + crypto.createHash('sha256').update(canon).digest('hex').slice(0, 32);
}

module.exports = { FINGERPRINT_VERSION, fingerprint, MATERIAL_FIELDS };
