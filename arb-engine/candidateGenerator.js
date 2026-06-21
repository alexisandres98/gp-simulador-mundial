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
      const legs = await legsForMarket(row.canonical_market_id);
      if (legs.length >= 2) candidates.push(buildCandidate(row.canonical_market_id, legs));
    }
    return candidates;
  } catch { return []; }
}

async function legsForMarket(canonicalMarketId) {
  // proveedores + external_market_id mapeados a este mercado canónico
  const maps = await db.query(`SELECT pm.provider_id, pm.external_market_id, pm.mapping_status, pm.mapping_version, p.code AS provider
    FROM provider_market_mappings pm JOIN providers p ON p.id=pm.provider_id
    WHERE pm.canonical_market_id=$1 AND pm.mapping_status='matched'`, [canonicalMarketId]);
  const legs = [];
  for (const m of maps.rows) {
    // último snapshot normalizado + order book asks
    const snap = await db.query(`SELECT * FROM normalized_market_snapshots WHERE provider_id=$1 AND external_market_id=$2 ORDER BY received_at DESC LIMIT 1`, [m.provider_id, m.external_market_id]);
    if (!snap.rows.length) continue;
    const s = snap.rows[0];
    const ob = await db.query(`SELECT price, size FROM normalized_orderbook_levels WHERE normalized_snapshot_id=$1 AND side='ask' ORDER BY level_index`, [s.id]);
    legs.push({
      provider: m.provider, externalMarketId: m.external_market_id, side: s.side, mappingStatus: 'matched',
      outcomeMappingStatus: 'matched', mappingVersion: m.mapping_version, rulesFingerprint: s.metadata && s.metadata.rules_fingerprint,
      marketStatus: s.market_status, freshness: 'fresh', currency: s.currency, payoutKnown: true,
      asks: ob.rows.map(x => ({ price: x.price, size: x.size })), snapshotId: s.id, snapshotReceivedAt: s.received_at, isLive: s.is_live,
    });
  }
  return legs;
}

function buildCandidate(canonicalMarketId, legs) {
  const strategy = legs.length === 3 ? '1x2' : 'binary';
  return { canonicalMarketId, strategy, mappingStatus: 'matched', mappingVersion: legs[0].mappingVersion, rulesFingerprint: legs[0].rulesFingerprint, legs };
}

module.exports = { generateFromDB, legsForMarket };
