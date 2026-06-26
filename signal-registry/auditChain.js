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

// contentHash de una fila de audit (sin prevHash) — para anclar filas pre-cadena (§2.1).
function contentHashOf(row) { return sha256(canonicalString(JSON.parse(JSON.stringify(core(row))))); }

// chainTip(client) → el hash en la punta de la cadena administrativa: último audit_hash encadenado, o si no
// hay ninguno aún, el último anchor (bridge pre-026), o null (→ GENESIS_ADMIN).
async function chainTip(client) {
  const last = await client.query(`SELECT audit_hash FROM signal_admin_actions WHERE audit_hash IS NOT NULL ORDER BY created_at_utc DESC, audit_event_id DESC LIMIT 1`);
  if (last.rows[0]) return last.rows[0].audit_hash;
  const anc = await client.query(`SELECT anchor_hash FROM signal_admin_chain_anchors ORDER BY created_at DESC, anchor_id DESC LIMIT 1`).catch(() => ({ rows: [] }));
  return anc.rows[0] ? anc.rows[0].anchor_hash : null;
}

// bridgePreChainAnchors(client) — §2.1. Crea un anchor append-only por cada fila de audit pre-cadena
// (audit_hash IS NULL, p.ej. el epoch_activation histórico) que aún no esté anclada. NO modifica la fila
// histórica. El anchor referencia su audit_event_id, guarda el hash determinístico de su contenido y un
// anchor_hash que se convierte en el genesis efectivo de la cadena. Idempotente.
async function bridgePreChainAnchors(client = db) {
  const run = async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_AUDIT_LOCK]);
    const pending = (await c.query(
      `SELECT a.* FROM signal_admin_actions a
        WHERE a.audit_hash IS NULL
          AND NOT EXISTS (SELECT 1 FROM signal_admin_chain_anchors x WHERE x.anchored_audit_event_id = a.audit_event_id)
        ORDER BY a.created_at_utc ASC, a.audit_event_id ASC`)).rows;
    if (!pending.length) return { created: 0 };
    let prev = (await c.query(`SELECT anchor_hash FROM signal_admin_chain_anchors ORDER BY created_at DESC, anchor_id DESC LIMIT 1`)).rows[0];
    let prevHash = prev ? prev.anchor_hash : null;
    let created = 0;
    for (const row of pending) {
      const ch = contentHashOf(row);
      const ah = sha256(`${prevHash || GENESIS_ADMIN}|anchor|${ch}`);
      await c.query(
        `INSERT INTO signal_admin_chain_anchors (anchored_audit_event_id, bridge_kind, content_hash, anchor_hash, note)
         VALUES ($1,'pre_chain_genesis',$2,$3,$4) ON CONFLICT (anchored_audit_event_id) DO NOTHING`,
        [row.audit_event_id, ch, ah, `bridge de ${row.action} pre-migración 026`]);
      prevHash = ah; created += 1;
    }
    return { created };
  };
  return client === db ? db.withTransaction(run) : run(client);
}

// writeAudit(client, fields) — INSERT encadenado. DEBE correr dentro de una transacción (toma advisory lock).
async function writeAudit(client, f = {}) {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_AUDIT_LOCK]);
  const prev = await chainTip(client);
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

// verifyChain() — recomputa la cadena completa: primero los anchors pre-026 (verificando que la fila histórica
// no fue alterada), luego los registros encadenados. Detecta cualquier alteración.
async function verifyChain(client = db) {
  let prev = null, ok = true, brokenAt = null, anchored = 0;
  // 1) anchors (bridge de filas pre-cadena §2.1)
  const anchors = (await client.query(`SELECT * FROM signal_admin_chain_anchors ORDER BY created_at ASC, anchor_id ASC`).catch(() => ({ rows: [] }))).rows;
  for (const a of anchors) {
    const hist = (await client.query(`SELECT * FROM signal_admin_actions WHERE audit_event_id=$1`, [a.anchored_audit_event_id])).rows[0];
    if (!hist) { ok = false; brokenAt = a.anchor_id; break; }
    const ch = contentHashOf(hist);
    const ah = sha256(`${prev || GENESIS_ADMIN}|anchor|${ch}`);
    if (ch !== a.content_hash || ah !== a.anchor_hash) { ok = false; brokenAt = a.anchor_id; break; }
    prev = a.anchor_hash; anchored += 1;
  }
  // 2) registros encadenados
  const rows = ok ? (await client.query(
    `SELECT * FROM signal_admin_actions WHERE audit_hash IS NOT NULL ORDER BY created_at_utc ASC, audit_event_id ASC`)).rows : [];
  for (const r of rows) {
    const expected = auditHash(prev, core(r));
    if (expected !== r.audit_hash || (r.previous_audit_hash || null) !== (prev || null)) { ok = false; brokenAt = r.audit_event_id; break; }
    prev = r.audit_hash;
  }
  return { ok, count: rows.length, anchored, broken_at: brokenAt };
}

module.exports = { writeAudit, verifyChain, bridgePreChainAnchors, contentHashOf, chainTip, auditHash, GENESIS_ADMIN };
