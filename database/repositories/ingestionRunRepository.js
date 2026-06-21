// ingestionRunRepository.js — auditoría de ejecuciones de collectors (Sprint 1+). SQL parametrizado.
'use strict';
const db = require('../client');

module.exports = {
  // start({ providerId, jobType, metadata? }) → row (status 'running')
  async start({ providerId, jobType, metadata }) {
    const r = await db.query(
      `INSERT INTO ingestion_runs (provider_id, job_type, status, metadata)
       VALUES ($1,$2,'running',COALESCE($3,'{}'::jsonb)) RETURNING *`,
      [providerId, jobType, metadata ? JSON.stringify(metadata) : null]
    );
    return r.rows[0];
  },
  // finish(id, { status, recordsReceived, recordsWritten, recordsRejected, requestCount, errorCount, errorSummary }) → row
  async finish(id, s = {}) {
    const r = await db.query(
      `UPDATE ingestion_runs SET
         status = COALESCE($2,status), finished_at = now(),
         records_received = COALESCE($3,records_received), records_written = COALESCE($4,records_written),
         records_rejected = COALESCE($5,records_rejected), request_count = COALESCE($6,request_count),
         error_count = COALESCE($7,error_count), error_summary = COALESCE($8,error_summary)
       WHERE id = $1 RETURNING *`,
      [id, s.status || null, s.recordsReceived, s.recordsWritten, s.recordsRejected, s.requestCount, s.errorCount, s.errorSummary || null]
    );
    return r.rows[0] || null;
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM ingestion_runs WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // recent(providerId, limit) → row[]
  async recent(providerId, limit = 20) {
    const r = await db.query(
      'SELECT * FROM ingestion_runs WHERE provider_id = $1 ORDER BY started_at DESC LIMIT $2',
      [providerId, limit]
    );
    return r.rows;
  },
};
