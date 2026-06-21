// canonicalOutcomeRepository.js — canonical_outcomes (Sprint 0.1 / Sprint 2). SQL parametrizado.
'use strict';
const db = require('../client');

module.exports = {
  // insert({ canonicalMarketId, outcomeCode, outcomeName?, outcomeType?, participantReference?, displayOrder?, status?, metadata? }) → row
  async insert(o) {
    const r = await db.query(
      `INSERT INTO canonical_outcomes
         (canonical_market_id, outcome_code, outcome_name, outcome_type, participant_reference, display_order, status, metadata)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,'active'),COALESCE($8,'{}'::jsonb)) RETURNING *`,
      [o.canonicalMarketId, o.outcomeCode, o.outcomeName || null, o.outcomeType || null, o.participantReference || null,
       o.displayOrder ?? null, o.status || null, o.metadata ? JSON.stringify(o.metadata) : null]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM canonical_outcomes WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // byMarket(canonicalMarketId) → row[]
  async byMarket(canonicalMarketId) {
    const r = await db.query('SELECT * FROM canonical_outcomes WHERE canonical_market_id = $1 ORDER BY display_order, outcome_code', [canonicalMarketId]);
    return r.rows;
  },
};
