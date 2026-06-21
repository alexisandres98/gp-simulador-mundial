// orderbookRepository.js — normalized_orderbook_levels (Sprint 1). SQL parametrizado, inserción batch.
// Precios/sizes como string (NUMERIC, sin float). Valida side/levelIndex; rechaza negativos.
'use strict';
const db = require('../../database/client');

const numStr = v => (v === undefined || v === null || v === '') ? null : String(v);

module.exports = {
  // insertLevels(levels[]) → cantidad insertada. Cada level: { normalizedSnapshotId, providerId,
  //   externalMarketId?, externalOutcomeId?, side('bid'|'ask'), price, size, levelIndex, providerTimestamp? }
  // Inserción en una sola sentencia parametrizada. Niveles inválidos (negativos/side malo) se descartan.
  async insertLevels(levels) {
    const valid = (levels || []).filter(l =>
      (l.side === 'bid' || l.side === 'ask') &&
      Number(l.price) >= 0 && Number(l.size) >= 0 && Number.isInteger(l.levelIndex) && l.levelIndex >= 0);
    if (!valid.length) return 0;
    const cols = 9; const params = []; const tuples = [];
    valid.forEach((l, i) => {
      const b = i * cols;
      tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`);
      params.push(l.normalizedSnapshotId, l.providerId, l.externalMarketId || null, l.externalOutcomeId || null,
        l.side, numStr(l.price), numStr(l.size), l.levelIndex, l.providerTimestamp || null);
    });
    const r = await db.query(
      `INSERT INTO normalized_orderbook_levels
         (normalized_snapshot_id, provider_id, external_market_id, external_outcome_id, side, price, size, level_index, provider_timestamp)
       VALUES ${tuples.join(',')}
       ON CONFLICT (normalized_snapshot_id, side, level_index) DO NOTHING`,
      params
    );
    return r.rowCount;
  },
  // getLatestOrderBook(snapshotId) → { bids:[], asks:[] } ordenados por level_index
  async getLatestOrderBook(normalizedSnapshotId) {
    const r = await db.query(
      'SELECT side, price, size, level_index FROM normalized_orderbook_levels WHERE normalized_snapshot_id = $1 ORDER BY side, level_index',
      [normalizedSnapshotId]
    );
    const bids = [], asks = [];
    for (const row of r.rows) (row.side === 'bid' ? bids : asks).push({ price: row.price, size: row.size, level: row.level_index });
    return { bids, asks };
  },
  async countAll() {
    const r = await db.query('SELECT count(*)::int n FROM normalized_orderbook_levels');
    return r.rows[0].n;
  },
};
