// signal-registry/signalAdmin.js — Fase G.1 §3-9,§15. Acciones administrativas POR SEÑAL.
// NUNCA edita la fila `signals` ni su hash (es INSERT-only). Cada acción: valida la máquina de estados (§4),
// escribe un audit encadenado append-only (§12), actualiza la proyección mutable signal_admin_state, y para
// `correct` añade una fila append-only en signal_corrections (vista efectiva derivada, original intacto §7).
// Serializa por señal (advisory lock) + idempotencia por idempotency_key (§15).
'use strict';
const db = require('../database/client');
const sm = require('./stateMachine');
const { writeAudit, verifyChain } = require('./auditChain');

const SIGNAL_LOCK_NS = 0x51A1; // namespace del advisory lock por señal

function err(code, details) { const e = new Error(code); e.code = code; if (details) e.details = details; return e; }
function lockKey(signalId) { let h = 0; const s = String(signalId); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function getState(signalId, client = db) {
  const r = await client.query(`SELECT * FROM signal_admin_state WHERE signal_id=$1`, [signalId]);
  return r.rows[0] || null;
}
async function currentStatus(signalId, client = db) {
  const st = await getState(signalId, client);
  return st ? st.admin_status : sm.INITIAL_STATE;
}

// applyAction — núcleo común a las 6 acciones. La AUTORIZACIÓN (scopes/rol) la resuelve el caller (authz) antes.
//  input: { adminId, reasonCode, reasonText, confirmedSignalId, confirmationPhrase, correctedFields,
//           isSuperAdmin, postEvent?, quarantineRef?, idempotencyKey?, requestId?, sessionMetadata?,
//           policyVersion?, schemaVersion? }
async function evaluate(action, signalId, input = {}, client = db) {
  const sig = (await client.query(`SELECT id, published_at, event_start_at FROM signals WHERE id=$1`, [signalId])).rows[0];
  if (!sig) throw err('signal_not_found');
  const prev = await getState(signalId, client);
  const fromStatus = prev ? prev.admin_status : sm.INITIAL_STATE;
  // postEvent: ¿ya inició el evento? (retract/void post-evento exigen confirmación reforzada / superadmin)
  const postEvent = input.postEvent != null ? !!input.postEvent
    : (sig.event_start_at ? Date.now() >= +new Date(sig.event_start_at) : false);
  const v = sm.validate({
    action, fromState: fromStatus, reasonCode: input.reasonCode, reasonText: input.reasonText,
    confirmedSignalId: input.confirmedSignalId, signalId, confirmationPhrase: input.confirmationPhrase,
    correctedFields: input.correctedFields, postEvent,
    quarantineRef: input.quarantineRef || (prev && prev.quarantine_ref) || null,
    isSuperAdmin: !!input.isSuperAdmin,
  });
  return { sig, prev, fromStatus, postEvent, v };
}

async function applyAction(action, signalId, input = {}, opts = {}) {
  if (!sm.isAction(action)) throw err('unknown_action');
  const client0 = opts.client || db;
  // idempotencia primero: si la clave ya se procesó, devolver el resultado previo SIN re-validar (§15) —
  // así un reintento sobre un estado ya terminal no falla por transición inválida.
  if (input.idempotencyKey) {
    const dup = (await client0.query(`SELECT * FROM signal_admin_actions WHERE idempotency_key=$1`, [input.idempotencyKey])).rows[0];
    if (dup) return { idempotent: true, audit: dup, state: await getState(signalId, client0) };
  }
  const pre = await evaluate(action, signalId, input, client0);
  // PRE-VALIDACIÓN fuera de la transacción → el error estructurado (details) llega intacto al caller.
  if (!pre.v.ok) throw err('validation_failed', pre.v.errors);

  const run = async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1,$2)', [SIGNAL_LOCK_NS, lockKey(signalId)]);

    // idempotencia por clave: si ya se procesó, devolver el resultado previo sin re-aplicar (§15)
    if (input.idempotencyKey) {
      const dup = (await c.query(`SELECT * FROM signal_admin_actions WHERE idempotency_key=$1`, [input.idempotencyKey])).rows[0];
      if (dup) return { idempotent: true, audit: dup, state: await getState(signalId, c) };
    }

    // RE-VALIDACIÓN bajo lock (red de seguridad ante carreras: el estado pudo cambiar entre pre-check y lock)
    const re = await evaluate(action, signalId, input, c);
    if (!re.v.ok) throw err('validation_failed', re.v.errors);
    const prev = re.prev;
    const v = re.v;

    const newStatus = v.target, newVisibility = v.visibility;

    const audit = await writeAudit(c, {
      adminId: input.adminId, action, targetType: 'signal', targetId: String(signalId),
      reasonCode: input.reasonCode || null, reasonText: input.reasonText,
      previousState: { admin_status: re.fromStatus, visibility: prev ? prev.visibility : 'visible' },
      newState: { admin_status: newStatus, visibility: newVisibility },
      changedFields: action === 'correct' ? (input.correctedFields || null) : null,
      sessionMetadata: input.sessionMetadata || null, requestId: input.requestId || null, idempotencyKey: input.idempotencyKey || null,
    });

    let correction = null;
    if (action === 'correct') {
      const corr = sm.classifyCorrection(input.correctedFields);
      correction = (await c.query(
        `INSERT INTO signal_corrections (signal_id, audit_event_id, corrected_fields, is_material, reason_code, reason_text, policy_version, schema_version, admin_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [signalId, audit.audit_event_id, JSON.stringify(input.correctedFields || {}), corr.material,
         input.reasonCode || null, input.reasonText || null, input.policyVersion || 'registry-policy-1', input.schemaVersion || 'signal-v1', input.adminId || null])).rows[0];
    }

    // proyección de estado (mutable). quarantine_ref: se setea al poner en quarantine; se limpia al restaurar.
    const quarantineRef = action === 'quarantine' ? audit.audit_event_id
      : action === 'restore' ? null
      : (prev ? prev.quarantine_ref : null);
    await c.query(
      `INSERT INTO signal_admin_state (signal_id, admin_status, visibility, last_action, last_action_id, last_reason_code, quarantine_ref, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (signal_id) DO UPDATE SET admin_status=EXCLUDED.admin_status, visibility=EXCLUDED.visibility,
         last_action=EXCLUDED.last_action, last_action_id=EXCLUDED.last_action_id, last_reason_code=EXCLUDED.last_reason_code,
         quarantine_ref=EXCLUDED.quarantine_ref, updated_by=EXCLUDED.updated_by`,
      [signalId, newStatus, newVisibility, action, audit.audit_event_id, input.reasonCode || null, quarantineRef, input.adminId || null]);

    return { idempotent: false, audit, state: await getState(signalId, c), correction, validation: v };
  };
  return opts.client ? run(opts.client) : db.withTransaction(run);
}

const quarantine = (id, i, o) => applyAction('quarantine', id, i, o);
const restore = (id, i, o) => applyAction('restore', id, i, o);
const retract = (id, i, o) => applyAction('retract', id, i, o);
const correct = (id, i, o) => applyAction('correct', id, i, o);
const dataError = (id, i, o) => applyAction('data_error', id, i, o);
const administrativeVoid = (id, i, o) => applyAction('administrative_void', id, i, o);

// ---------- lecturas para la UI admin (§14) — sanitizadas, sin notas privadas ----------
function sanitizeAudit(r) {
  return {
    audit_event_id: r.audit_event_id, action: r.action, target_type: r.target_type, target_id: r.target_id,
    reason_code: r.reason_code, reason_text: r.reason_text, previous_state: r.previous_state, new_state: r.new_state,
    changed_fields: r.changed_fields, admin_id: r.admin_id, request_id: r.request_id, created_at_utc: r.created_at_utc,
    audit_hash_short: r.audit_hash ? String(r.audit_hash).slice(0, 12) : null,
  };
}

async function listAudit({ limit = 100, signalId = null } = {}, client = db) {
  const p = []; let where = '';
  if (signalId) { p.push(String(signalId)); where = `WHERE target_type='signal' AND target_id=$1`; }
  p.push(Math.min(limit, 500));
  const r = await client.query(`SELECT * FROM signal_admin_actions ${where} ORDER BY created_at_utc DESC LIMIT $${p.length}`, p);
  return r.rows.map(sanitizeAudit);
}

// listSignals — lista para la futura tabla de señales. Vacía mientras signals=0 (empty state §14).
async function listSignals({ limit = 50, offset = 0 } = {}, client = db) {
  const r = await client.query(
    `SELECT s.id, s.public_id, s.signal_type, s.canonical_event_id, s.published_at, s.chain_position, s.registry_hash,
            COALESCE(st.admin_status,'ACTIVE') admin_status, COALESCE(st.visibility,'visible') visibility,
            st.last_action, st.last_action_id
       FROM signals s LEFT JOIN signal_admin_state st ON st.signal_id = s.id
      ORDER BY s.chain_position DESC NULLS LAST LIMIT $1 OFFSET $2`,
    [Math.min(limit, 200), Math.max(offset, 0)]);
  return r.rows.map(x => ({
    signal_id: x.id, public_id: x.public_id, signal_type: x.signal_type, event: x.canonical_event_id,
    published_at: x.published_at, chain_sequence: x.chain_position == null ? null : Number(x.chain_position),
    registry_hash_short: x.registry_hash ? String(x.registry_hash).slice(0, 12) : null,
    status: x.admin_status, visibility: x.visibility, last_admin_action: x.last_action,
  }));
}

// effectiveView — aplica las correcciones sobre una COPIA (no toca el original §7).
function effectiveView(signal, corrections = []) {
  const effective = { ...signal };
  for (const c of corrections) {
    const fields = c.corrected_fields || {};
    for (const [k, delta] of Object.entries(fields)) effective[k] = (delta && 'new' in delta) ? delta.new : delta;
  }
  return effective;
}

// getSignalDetail — original + vista efectiva + estado + timeline de acciones admin + correcciones (§14).
async function getSignalDetail(signalId, client = db) {
  const sig = (await client.query(`SELECT * FROM signals WHERE id=$1`, [signalId])).rows[0];
  if (!sig) return null;
  const state = await getState(signalId, client);
  const corrections = (await client.query(`SELECT * FROM signal_corrections WHERE signal_id=$1 ORDER BY created_at ASC`, [signalId])).rows;
  const timeline = await listAudit({ signalId, limit: 200 }, client);
  return {
    original: { signal_id: sig.id, public_id: sig.public_id, signal_type: sig.signal_type, published_at: sig.published_at,
      chain_sequence: sig.chain_position == null ? null : Number(sig.chain_position),
      registry_hash_short: sig.registry_hash ? String(sig.registry_hash).slice(0, 12) : null,
      content_hash_short: sig.content_hash ? String(sig.content_hash).slice(0, 12) : null },
    effective: { status: state ? state.admin_status : 'ACTIVE', visibility: state ? state.visibility : 'visible' },
    corrections: corrections.map(c => ({ correction_id: c.correction_id, corrected_fields: c.corrected_fields, is_material: c.is_material, reason_code: c.reason_code, created_at: c.created_at })),
    downstream: sm.downstreamPolicy(state ? state.admin_status : 'ACTIVE'),
    audit_timeline: timeline,
  };
}

module.exports = {
  applyAction, quarantine, restore, retract, correct, dataError, administrativeVoid,
  getState, currentStatus, listAudit, listSignals, getSignalDetail, effectiveView, verifyChain,
};
