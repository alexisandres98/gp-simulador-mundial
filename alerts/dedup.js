// alerts/dedup.js — Sprint 8A §31. Clave de deduplicación: una observación idéntica NO genera otra alerta;
// los retries de delivery NO crean alerta nueva. dedup_key = user + type + entity + material_state_version.
'use strict';
const crypto = require('crypto');

// materialStateVersion: lo que hace "materialmente distinta" a la alerta. Ejemplos:
//  - nueva pick → publicId
//  - price_moved → "moved" (una vez por cruce del umbral, no por cada ciclo)
//  - settlement → "final"
function dedupKey({ userRef, type, entityType = '', entityId = '', materialStateVersion = '' }) {
  const raw = [userRef, type, entityType, entityId, materialStateVersion].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

module.exports = { dedupKey };
