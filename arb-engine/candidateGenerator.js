// arb-engine/candidateGenerator.js — genera candidatos desde la DB (Sprint 3).
// Solo mappings de mercado 'matched' con ≥2 proveedores; construye patas desde el último snapshot
// normalizado + order book de cada proveedor. Si no hay datos (Sprint 1/2 inertes) → [] (honesto).
'use strict';
const db = require('../database/client');
const cfg = require('./config');

// generateFromDB() → [candidate]. Best-effort; nunca lanza.
async function generateFromDB() {
  if (!cfg.platform.db.configured) return [];
  try {
    // mercados canónicos con ≥2 proveedores mapeados 'matched'
    const r = await db.query(`
      SELECT canonical_market_id, count(*)::int n FROM provider_market_mappings
      WHERE mapping_status='matched' AND canonical_market_id IS NOT NULL
      GROUP BY canonical_market_id HAVING count(*) >= 2 LIMIT 200`);
    if (!r.rows.length) return [];
    const candidates = [];
    for (const row of r.rows) {
      const sides = await sidesForMarket(row.canonical_market_id);
      candidates.push(...buildCandidates(row.canonicalMarketId || row.canonical_market_id, sides));
    }
    return candidates;
  } catch { return []; }
}

// sidesForMarket → un objeto por proveedor con sus libros bid/ask del último snapshot (sin asumir estructura).
async function sidesForMarket(canonicalMarketId) {
  const maps = await db.query(`SELECT pm.provider_id, pm.external_market_id, pm.mapping_version, p.code AS provider
    FROM provider_market_mappings pm JOIN providers p ON p.id=pm.provider_id
    WHERE pm.canonical_market_id=$1 AND pm.mapping_status='matched'`, [canonicalMarketId]);
  const out = [];
  for (const m of maps.rows) {
    const snap = await db.query(`SELECT * FROM normalized_market_snapshots WHERE provider_id=$1 AND external_market_id=$2 ORDER BY received_at DESC LIMIT 1`, [m.provider_id, m.external_market_id]);
    if (!snap.rows.length) continue;
    const s = snap.rows[0];
    const lv = await db.query(`SELECT side, price, size FROM normalized_orderbook_levels WHERE normalized_snapshot_id=$1 ORDER BY level_index`, [s.id]);
    const asks = lv.rows.filter(x => x.side === 'ask').map(x => ({ price: x.price, size: x.size }));
    const bids = lv.rows.filter(x => x.side === 'bid').map(x => ({ price: x.price, size: x.size }));
    out.push({
      provider: m.provider, externalMarketId: m.external_market_id, side: s.side || 'yes', mappingVersion: m.mapping_version,
      rulesFingerprint: s.metadata && s.metadata.rules_fingerprint, marketStatus: s.market_status, currency: s.currency,
      asks, bids, snapshotId: s.id, snapshotReceivedAt: s.received_at, isLive: s.is_live,
    });
  }
  return out;
}

// leg DIRECTO de compra del lado del snapshot (normalmente YES): se compra contra los asks.
function directLeg(p, side) {
  return baseLeg(p, side, p.asks, 'direct_ask');
}
// leg DERIVADO del complemento: NO_ask = 1 - YES_bid (mismos tamaños). Mejor NO-ask = 1 - mejor YES-bid.
function derivedComplementLeg(p, side) {
  const derived = (p.bids || []).map(b => ({ price: oneMinus(b.price), size: b.size }))
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price)); // mejor (más barato) primero
  return baseLeg(p, side, derived, 'derived_from_complement_bid');
}
function baseLeg(p, side, asks, priceSource) {
  return {
    provider: p.provider, externalMarketId: p.externalMarketId, side, priceSource,
    mappingStatus: 'matched', outcomeMappingStatus: 'matched', mappingVersion: p.mappingVersion,
    rulesFingerprint: p.rulesFingerprint, marketStatus: p.marketStatus, freshness: 'fresh', currency: p.currency,
    payoutKnown: true, asks, snapshotId: p.snapshotId, snapshotReceivedAt: p.snapshotReceivedAt, isLive: p.isLive,
  };
}
function oneMinus(price) { const v = 1 - parseFloat(price); return (v > 0 ? v : 0).toFixed(8); }

// buildCandidates → emite candidatos con estructura de arb VÁLIDA.
//  - 1x2 (3 proveedores/outcomes distintos): patas directas (ya complementarias exhaustivas).
//  - binario (2 proveedores, MISMO outcome YES): se construyen AMBAS direcciones complementarias
//    YES@A+NO@B y NO@A+YES@B (NO derivado del bid del complemento). Una de ellas es la dirección del arb.
function buildCandidates(canonicalMarketId, sides) {
  if (sides.length === 3) {
    const legs = sides.map(p => directLeg(p, p.side));
    return [{ canonicalMarketId, strategy: '1x2', mappingStatus: 'matched', mappingVersion: legs[0].mappingVersion, rulesFingerprint: legs[0].rulesFingerprint, legs }];
  }
  if (sides.length === 2) {
    const [a, b] = sides;
    const mk = legs => ({ canonicalMarketId, strategy: 'binary', mappingStatus: 'matched', mappingVersion: legs[0].mappingVersion, rulesFingerprint: legs[0].rulesFingerprint, legs });
    return [
      mk([directLeg(a, 'yes'), derivedComplementLeg(b, 'no')]),  // YES@A + NO@B
      mk([derivedComplementLeg(a, 'no'), directLeg(b, 'yes')]),  // NO@A + YES@B
    ];
  }
  return [];
}

module.exports = { generateFromDB, sidesForMarket, buildCandidates };
