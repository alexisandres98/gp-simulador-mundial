// signal-registry/auditChain.js — Fase G.1 §12. Audit administrativo append-only con cadena de hashes
// (evidencia de no-alteración). Cada acción admin (global o por señal) encadena con la anterior. La tabla
// signal_admin_actions ya bloquea UPDATE/DELETE por trigger; la cadena añade detección de manipulación.
'use strict';
const crypto = require('crypto');
const db = require('../database/client');
const { canonicalString } = require('./canonicalize');

const GENESIS_ADMIN = 'genesis:gpsimulador:admin-audit:v1';
const ADMIN_AUDIT_LOCK = 521988; // advisory lock para serializar la cadena administrativa

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const jsonOr = (v) => (v == null ? null : JSON.stringify(v));

// núcleo canónico que entra al hash (incluye id y timestamp para reproducibilidad determinística)
function core(row) {
  return {
    audit_event_id: row.audit_event_id, action: row.action,
    target_type: row.target_type || null, target_id: row.target_id || null,
    reason_code: row.reason_code || null, reason_text: row.reason_text || null,
    previous_state: row.previous_state ?? null, new_state: row.new_state ?? null,
    changed_fields: row.changed_fields ?? null, admin_id: row.admin_id || null,
    idempotency_key: row.idempotency_key || null,
    created_at_utc: (row.created_at_utc instanceof Date) ? row.created_at_utc.toISOString() : row.created_at_utc,
  };
}
// Normaliza vía JSON (Date→ISO string, undefined→drop) para que el hash de escritura reproduzca exactamente
// lo que se relee desde JSONB (canonical() trata un Date como objeto vacío → habría mismatch sin esto).
function auditHash(prevHash, rowCore) {
  const norm = JSON.parse(JSON.stringify(rowCore ?? null));
  return sha256(`${prevHash || GENESIS_ADMIN}|${canonicalString(norm)}`);
}

// writeAudit(client, fields) — INSERT encadenado. DEBE correr dentro de una transacción (toma advisory lock).
async function writeAudit(client, f = {}) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_AUDIT_LOCK]);
  const last = await client.query(
    `SELECT audit_hash FROM signal_admin_actions WHERE audit_hash IS NOT NULL ORDER BY created_at_utc DESC, audit_event_id DESC LIMIT 1`);
  const prev = last.rows[0] ? last.rows[0].audit_hash : null;
  const auditEventId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const rowCore = core({
    audit_event_id: auditEventId, action: f.action, target_type: f.targetType, target_id: f.targetId,
    reason_code: f.reasonCode, reason_text: f.reasonText, previous_state: f.previousState ?? null,
    new_state: f.newState ?? null, changed_fields: f.changedFields ?? null, admin_id: f.adminId,
    idempotency_key: f.idempotencyKey, created_at_utc: createdAt,
  });
  const h = auditHash(prev, rowCore);
  const r = await client.query(
    `INSERT INTO signal_admin_actions
       (audit_event_id, admin_id, action, target_type, target_id, reason_code, reason_text,
        previous_state, new_state, changed_fields, session_metadata, request_id, idempotency_key,
        previous_audit_hash, audit_hash, created_at_utc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [auditEventId, f.adminId || null, f.action, f.targetType || null, f.targetId || null, f.reasonCode || null, f.reasonText || null,
     jsonOr(f.previousState), jsonOr(f.newState), jsonOr(f.changedFields), jsonOr(f.sessionMetadata),
     f.requestId || null, f.idempotencyKey || null, prev, h, createdAt]);
  return r.rows[0];
}

// verifyChain() — recomputa la cadena de los registros con audit_hash y detecta cualquier alteración.
async function verifyChain(client = db) {
  const rows = (await client.query(
    `SELECT * FROM signal_admin_actions WHERE audit_hash IS NOT NULL ORDER BY created_at_utc ASC, audit_event_id ASC`)).rows;
  let prev = null, ok = true, brokenAt = null;
  for (const r of rows) {
    const expected = auditHash(prev, core(r));
    if (expected !== r.audit_hash || (r.previous_audit_hash || null) !== (prev || null)) { ok = false; brokenAt = r.audit_event_id; break; }
    prev = r.audit_hash;
  }
  return { ok, count: rows.length, broken_at: brokenAt };
}

module.exports = { writeAudit, verifyChain, auditHash, GENESIS_ADMIN };
