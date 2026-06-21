// exec-opportunities/repositories/publicationHistoryRepository.js — Sprint 4. arb_publication_history (auditoría).
'use strict';
const db = require('../../database/client');

module.exports = {
  // insert(entry, client?) — client opcional para correr dentro de una transacción con el cambio de estado.
  async insert(e, client = db) {
    const r = await client.query(
      `INSERT INTO arb_publication_history
         (publication_id, previous_status, new_status, action, actor_id, reason, evaluation_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'{}'::jsonb)) RETURNING *`,
      [e.publicationId, e.previousStatus || null, e.newStatus || null, e.action, e.actorId || null,
       e.reason || null, uuidOrNull(e.evaluationId), e.metadata != null ? JSON.stringify(e.metadata) : null]
    );
    return r.rows[0];
  },

  async listForPublication(publicationId, { limit = 100 } = {}) {
    const r = await db.query(
      'SELECT * FROM arb_publication_history WHERE publication_id = $1 ORDER BY created_at DESC LIMIT $2',
      [publicationId, Math.min(limit, 500)]
    );
    return r.rows;
  },
};

function uuidOrNull(v) { return /^[0-9a-f-]{36}$/i.test(String(v || '')) ? v : null; }
