// market-data/locks.js — advisory locks de PostgreSQL por (provider + job_type) (Sprint 1).
// Evita ejecuciones duplicadas si en el futuro hay varias instancias. El lock se toma en una conexión
// dedicada y se libera al terminar, ante error, y (automáticamente por Postgres) si la sesión muere.

'use strict';
const crypto = require('crypto');
const dbClient = require('../database/client');

// Dos claves int4 determinísticas desde el nombre del lock (pg_try_advisory_lock(int4,int4)).
function keyFor(name) {
  const h = crypto.createHash('sha256').update(String(name)).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

// withLock(provider, jobType, fn) → { acquired, skipped?, result? }. Nunca lanza por el lock en sí.
async function withLock(provider, jobType, fn) {
  const pool = dbClient.getPool();
  if (!pool) return { acquired: false, skipped: 'no_db', result: null };
  const name = `${provider}-${jobType}`;
  const [k1, k2] = keyFor(name);
  let c;
  try {
    c = await pool.connect();
  } catch (e) {
    return { acquired: false, skipped: 'connect_failed', result: null };
  }
  try {
    const r = await c.query('SELECT pg_try_advisory_lock($1,$2) AS ok', [k1, k2]);
    if (!r.rows[0].ok) return { acquired: false, skipped: 'skipped_due_to_lock', result: null };
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      try { await c.query('SELECT pg_advisory_unlock($1,$2)', [k1, k2]); } catch { /* la sesión liberará */ }
    }
  } finally {
    try { c.release(); } catch { /* noop */ }
  }
}

module.exports = { withLock, keyFor };
