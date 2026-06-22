// operations/repositories/deadLetterRepository.js — operational_dead_letters (Sprint 8A §24).
// safe_payload SIEMPRE redactado por el caller. Dedup: una entrada abierta por (job, entity).
'use strict';
const db = require('../../database/client');

// Registra/incrementa una dead letter. Si ya existe una abierta para (job,entity), suma attempts.
async function record({ jobName, entityType = null, entityId = null, errorCode = null, safePayload = {} }) {
  const r = await db.query(
    `INSERT INTO operational_dead_letters (job_name, entity_type, entity_id, error_code, safe_payload, attempts, first_failed_at, last_failed_at, status)
     VALUES ($1,$2,$3,$4,$5,1, now(), now(), 'open')
     ON CONFLICT (job_name, entity_type, entity_id) WHERE status IN ('open','retrying')
     DO UPDATE SET attempts = operational_dead_letters.attempts + 1, last_failed_at = now(),
                   error_code = EXCLUDED.error_code, safe_payload = EXCLUDED.safe_payload
     RETURNING *`,
    [jobName, entityType, entityId, errorCode, JSON.stringify(safePayload || {})]
  );
  return r.rows[0];
}

async function list({ status = null, limit = 100 } = {}) {
  const r = await db.query(
    `SELECT * FROM operational_dead_letters WHERE ($1::text IS NULL OR status=$1)
       ORDER BY created_at DESC LIMIT $2`,
    [status, limit]
  );
  return r.rows;
}

async function setStatus(id, status, note = null) {
  const resolved = (status === 'resolved' || status === 'ignored');
  const r = await db.query(
    `UPDATE operational_dead_letters
       SET status=$2, resolution_note = COALESCE($3, resolution_note),
           resolved_at = CASE WHEN $4 THEN now() ELSE resolved_at END
     WHERE id=$1 RETURNING *`,
    [id, status, note, resolved]
  );
  return r.rows[0] || null;
}

async function counts() {
  const r = await db.query(`SELECT status, count(*)::int AS n FROM operational_dead_letters GROUP BY status`);
  return r.rows.reduce((a, x) => (a[x.status] = x.n, a), {});
}

module.exports = { record, list, setStatus, counts };
