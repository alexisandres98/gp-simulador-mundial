// alerts/repositories.js — Sprint 8A. Persistencia de user_alerts + alert_delivery_attempts. La creación es
// IDEMPOTENTE por (user_ref, dedup_key): una observación idéntica no crea otra alerta.
'use strict';
const db = require('../database/client');

// create idempotente → { alert, created:boolean }
async function create({ userRef, type, entityType = null, entityId = null, dedupKey, title, body = null, severity = 'info', expiresAt = null, metadata = {} }) {
  const r = await db.query(
    `INSERT INTO user_alerts (user_ref, alert_type, entity_type, entity_id, dedup_key, title, body, severity, expired_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_ref, dedup_key) DO NOTHING RETURNING *`,
    [userRef, type, entityType, entityId, dedupKey, title, body, severity, expiresAt, JSON.stringify(metadata || {})]
  );
  if (r.rows[0]) return { alert: r.rows[0], created: true };
  const ex = await db.query(`SELECT * FROM user_alerts WHERE user_ref=$1 AND dedup_key=$2`, [userRef, dedupKey]);
  return { alert: ex.rows[0] || null, created: false };
}

async function recordDelivery(alertId, { channel, attempt = 1, status, providerMessageId = null, safeError = null }) {
  await db.query(
    `INSERT INTO alert_delivery_attempts (alert_id, channel, attempt, status, provider_message_id, safe_error, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())`,
    [alertId, channel, attempt, status, providerMessageId, safeError]
  );
}

async function setStatus(alertId, status) {
  await db.query(`UPDATE user_alerts SET status=$2 WHERE id=$1`, [alertId, status]);
}

async function listForUser(userRef, { limit = 50, unreadOnly = false } = {}) {
  const r = await db.query(
    `SELECT * FROM user_alerts WHERE user_ref=$1 AND status<>'cancelled' ${unreadOnly ? 'AND read_at IS NULL' : ''}
       ORDER BY created_at DESC LIMIT $2`,
    [userRef, limit]
  );
  return r.rows;
}

async function markRead(userRef, alertId) {
  const r = await db.query(`UPDATE user_alerts SET read_at=now(), status='read' WHERE id=$1 AND user_ref=$2 AND read_at IS NULL RETURNING id`, [alertId, userRef]);
  return r.rowCount > 0;
}
async function markAllRead(userRef) {
  const r = await db.query(`UPDATE user_alerts SET read_at=now(), status='read' WHERE user_ref=$1 AND read_at IS NULL`, [userRef]);
  return r.rowCount;
}
async function unreadCount(userRef) {
  const r = await db.query(`SELECT count(*)::int n FROM user_alerts WHERE user_ref=$1 AND read_at IS NULL AND status<>'cancelled'`, [userRef]);
  return r.rows[0].n;
}

module.exports = { create, recordDelivery, setStatus, listForUser, markRead, markAllRead, unreadCount };
