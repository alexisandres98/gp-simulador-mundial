// arb-engine/opportunityKey.js — clave determinística de oportunidad (Sprint 3).
// Agrupa la MISMA estructura a través del tiempo. Depende de mercado/outcomes/proveedores/direcciones/
// estrategia. NO depende de precio, timestamp ni snapshot id (esos cambian en cada evaluación).
'use strict';
const crypto = require('crypto');

function opportunityKey({ canonicalMarketId, strategy, legs }) {
  const legParts = (legs || []).map(l => `${l.provider}:${l.externalMarketId || ''}:${l.canonicalOutcomeId || l.side}:${l.side}`).sort();
  const canon = JSON.stringify({ m: canonicalMarketId || null, s: strategy, legs: legParts });
  return 'opp:' + crypto.createHash('sha256').update(canon).digest('hex').slice(0, 24);
}

module.exports = { opportunityKey };
