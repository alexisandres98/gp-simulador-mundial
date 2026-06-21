// signalRepository.js — signals (Sprint 5). SQL parametrizado.
// En sprints futuros las señales serán INMUTABLES: este repo NO expone update/delete del payload.
// Una corrección se modela como una NUEVA fila (nueva versión) que referencia a la anterior en metadata.
'use strict';
const db = require('../client');

module.exports = {
  // insert({ signalType, canonicalEventId?, canonicalMarketId?, status?, modelVersion?, mappingVersion?, rulesVersion?,
  //          publishedAt?, expiredAt?, snapshotIds?, signalPayload?, resultPayload?, metadata? }) → row
  async insert(s) {
    const r = await db.query(
      `INSERT INTO signals
         (signal_type, canonical_event_id, canonical_market_id, status, model_version, mapping_version, rules_version,
          published_at, expired_at, snapshot_ids, signal_payload, result_payload, metadata)
       VALUES ($1,$2,$3,COALESCE($4,'draft'),$5,$6,$7,$8,$9,COALESCE($10,'{}'::uuid[]),COALESCE($11,'{}'::jsonb),$12,COALESCE($13,'{}'::jsonb))
       RETURNING *`,
      [s.signalType, s.canonicalEventId || null, s.canonicalMarketId || null, s.status || null, s.modelVersion || null,
       s.mappingVersion || null, s.rulesVersion || null, s.publishedAt || null, s.expiredAt || null,
       s.snapshotIds || null, s.signalPayload ? JSON.stringify(s.signalPayload) : null,
       s.resultPayload ? JSON.stringify(s.resultPayload) : null, s.metadata ? JSON.stringify(s.metadata) : null]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM signals WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // listPublished(limit) → row[]
  async listPublished(limit = 50) {
    const r = await db.query("SELECT * FROM signals WHERE status = 'published' ORDER BY published_at DESC LIMIT $1", [limit]);
    return r.rows;
  },
};
