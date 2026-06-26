// signal-registry/registryAdmin.js — Fase G. Epoch persistente + controles administrativos de emergencia +
// audit append-only + health. NO crea señales. El epoch se genera en el momento real (sin backdating).
'use strict';
const db = require('../database/client');
const { writeAudit, verifyChain } = require('./auditChain');

// audit() — delega en la cadena administrativa append-only (auditChain). Mantiene la firma previa.
async function audit(action, opts = {}, client = db) {
  return writeAudit(client, { action, ...opts });
}

// activeEpoch() → la era verificable activa (o null).
async function activeEpoch() {
  const r = await db.query(`SELECT * FROM signal_registry_epochs WHERE status='active' ORDER BY epoch_started_at_utc DESC LIMIT 1`);
  return r.rows[0] || null;
}

// createEpoch — registra el Verified Epoch en el MOMENTO REAL (now() del servidor). Sin backdating. Una sola
// era activa a la vez. Idempotente: si ya hay una activa, la devuelve (no crea otra ni la mueve).
async function createEpoch({ policyVersion = 'registry-policy-1', schemaVersion = 'signal-v1', adminId = null, reason = 'fase G activación interna' } = {}) {
  return db.withTransaction(async (c) => {
    const existing = (await c.query(`SELECT * FROM signal_registry_epochs WHERE status='active' LIMIT 1`)).rows[0];
    if (existing) return { epoch: existing, already: true };
    const prev = (await c.query(`SELECT epoch_id FROM signal_registry_epochs ORDER BY epoch_started_at_utc DESC LIMIT 1`)).rows[0];
    const r = await c.query(
      `INSERT INTO signal_registry_epochs (epoch_started_at_utc, registry_policy_version, signal_schema_version, created_by_admin_id, activation_reason, previous_epoch_id, status)
       VALUES (now(), $1, $2, $3, $4, $5, 'active') RETURNING *`,
      [policyVersion, schemaVersion, adminId, reason, prev ? prev.epoch_id : null]);
    await audit('epoch_activation', { adminId, targetType: 'epoch', targetId: r.rows[0].epoch_id, reasonText: reason, newState: { started_at: r.rows[0].epoch_started_at_utc } }, c);
    return { epoch: r.rows[0], already: false };
  });
}

async function controls() {
  const r = await db.query(`SELECT control_key, enabled FROM registry_controls`);
  return r.rows.reduce((a, x) => (a[x.control_key] = x.enabled, a), {});
}
// nombre de acción de audit por control (on/off)
const CONTROL_ACTION = {
  registry_writes_paused: { on: 'pause_writes', off: 'resume_writes' },
  registry_public_hidden: { on: 'hide_public', off: 'show_public' },
  product_kill_switch: { on: 'kill_switch_on', off: 'kill_switch_off' },
};
async function setControl(key, enabled, { adminId = null, reasonText = null, requestId = null } = {}) {
  return db.withTransaction(async (c) => {
    const before = (await c.query(`SELECT enabled FROM registry_controls WHERE control_key=$1`, [key])).rows[0];
    if (!before) { const e = new Error('unknown_control'); e.code = 'unknown_control'; throw e; }
    const r = await c.query(`UPDATE registry_controls SET enabled=$2, updated_by=$3, updated_at=now() WHERE control_key=$1 RETURNING *`, [key, !!enabled, adminId]);
    const map = CONTROL_ACTION[key] || { on: 'control_on', off: 'control_off' };
    await audit(enabled ? map.on : map.off,
      { adminId, targetType: 'control', targetId: key, reasonText, requestId, previousState: before, newState: { enabled: !!enabled } }, c);
    return r.rows[0];
  });
}
async function writesPaused() { return (await controls()).registry_writes_paused === true; }

// health() interno — sin secrets.
async function health() {
  const cfg = require('./config');
  const ep = await activeEpoch().catch(() => null);
  const ctl = await controls().catch(() => ({}));
  const chain = (await db.query(`SELECT (SELECT count(*)::int FROM signals) signals, (SELECT max(chain_position) FROM signals) last_sequence, (SELECT max(published_at) FROM signals) last_signal_at`).catch(() => ({ rows: [{}] }))).rows[0];
  return {
    registry_enabled: cfg.flags.enabled, registry_write_enabled: cfg.flags.writeEnabled, registry_public_enabled: cfg.flags.publicEnabled,
    verified_epoch_configured: !!ep, verified_epoch_started_at: ep ? ep.epoch_started_at_utc : null, epoch_id: ep ? ep.epoch_id : null,
    chain_status: (chain.signals || 0) === 0 ? 'valid_empty' : 'has_entries', last_sequence: chain.last_sequence || null, last_signal_at: chain.last_signal_at || null,
    writes_paused: ctl.registry_writes_paused === true, registry_public_hidden: ctl.registry_public_hidden === true,
    product_kill_switch: ctl.product_kill_switch === true, admin_controls_available: true,
    audit_chain: await verifyChain().catch(() => ({ ok: null })),
  };
}

async function killSwitchOn() { return (await controls()).product_kill_switch === true; }

module.exports = { audit, activeEpoch, createEpoch, controls, setControl, writesPaused, killSwitchOn, health, verifyChain };
