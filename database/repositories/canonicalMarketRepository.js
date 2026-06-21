// canonicalMarketRepository.js — canonical_markets (Sprint 2). SQL parametrizado.
'use strict';
const db = require('../client');

module.exports = {
  // insert({ canonicalEventId, marketType, period?, outcomeType?, drawPossible?, includesExtraTime?, includesPenalties?,
  //          qualificationMarket?, resolutionSource?, rulesFingerprint?, status?, metadata? }) → row
  async insert(m) {
    const r = await db.query(
      `INSERT INTO canonical_markets
         (canonical_event_id, market_type, period, outcome_type, draw_possible, includes_extra_time, includes_penalties,
          qualification_market, resolution_source, rules_fingerprint, status, metadata)
       VALUES ($1,$2,COALESCE($3,'full_time'),$4,$5,$6,$7,COALESCE($8,false),$9,$10,COALESCE($11,'open'),COALESCE($12,'{}'::jsonb)) RETURNING *`,
      [m.canonicalEventId, m.marketType, m.period || null, m.outcomeType || null, m.drawPossible ?? null, m.includesExtraTime ?? null,
       m.includesPenalties ?? null, m.qualificationMarket ?? null, m.resolutionSource || null, m.rulesFingerprint || null,
       m.status || null, m.metadata ? JSON.stringify(m.metadata) : null]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM canonical_markets WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // byEvent(canonicalEventId) → row[]
  async byEvent(canonicalEventId) {
    const r = await db.query('SELECT * FROM canonical_markets WHERE canonical_event_id = $1 ORDER BY market_type', [canonicalEventId]);
    return r.rows;
  },
};
