// signal-registry/sweeps.js — Fase H (evoluciona Sprint 8A §112). Barridos de closing/settlement/commitment
// cableados como jobs del orquestador. HONESTOS: con signals=0 devuelven { processed: 0, eligible: 0 } sin
// errores ni datos sintéticos. La captura/liquidación efectiva exige fuente real enlazada (closing source /
// resultado de proveedor); aquí se IDENTIFICAN elegibles y se corre el commitment idempotente.
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const elig = require('./lifecycleEligibility');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// señales publicadas (vista mínima) para evaluar elegibilidad de lifecycle. Con signals=0 → [].
async function publishedSignals(limit = 500) {
  const r = await db.query(
    `SELECT s.*, COALESCE(st.admin_status,'ACTIVE') admin_status, p.closing_captured, p.settlement_status proj_settlement
       FROM signals s
       LEFT JOIN signal_admin_state st ON st.signal_id = s.id
       LEFT JOIN signal_state_projection p ON p.signal_id = s.id
      WHERE s.chain_position IS NOT NULL
      ORDER BY s.chain_position ASC LIMIT $1`, [limit]).catch(() => ({ rows: [] }));
  return r.rows;
}

// candidatos a closing: elegibles (§4) y aún sin cierre capturado. No fabrica precios (sin fuente automática
// enlazada → processed 0; captura efectiva manual/CLI hasta tener fuente).
async function closingSweep() {
  if (!bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false) || !db.isConfigured()) return { processed: 0, reason: 'disabled' };
  try {
    const rows = await publishedSignals();
    const ctx = { verifiedEpoch: cfg.params.verifiedEpoch };
    const eligible = rows.filter(s => !s.closing_captured && elig.closingEligible(s, ctx).eligible);
    return { processed: 0, eligible: eligible.length, scanned: rows.length, reason: eligible.length ? 'awaiting_closing_source' : 'no_eligible' };
  } catch (e) { return { processed: 0, error: 'sweep_error' }; }
}

// candidatos a settlement: elegibles, evento pasado, sin settlement final, excluyendo DATA_ERROR (§12).
async function settlementSweep() {
  if (!bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false) || !db.isConfigured()) return { processed: 0, reason: 'disabled' };
  try {
    const rows = await publishedSignals();
    const ctx = { verifiedEpoch: cfg.params.verifiedEpoch };
    const eligible = rows.filter(s => s.admin_status !== 'DATA_ERROR'
      && !['final', 'won', 'lost', 'void', 'cancelled'].includes(s.proj_settlement)
      && elig.closingEligible(s, ctx).eligible);
    return { processed: 0, eligible: eligible.length, scanned: rows.length, reason: eligible.length ? 'awaiting_result_source' : 'no_eligible' };
  } catch (e) { return { processed: 0, error: 'sweep_error' }; }
}

// commitment diario: real e idempotente (merkle root del día, solo señales elegibles). Seguro con 0 señales.
async function commitmentSweep() {
  const writeOn = bool(process.env.SIGNAL_REGISTRY_ENABLED, false) && bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false);
  if (!writeOn || !db.isConfigured()) return { committed: false, reason: 'disabled' };
  try { const c = await require('./index').commitDay(); return { committed: !c.skipped, ...c }; }
  catch (e) { return { committed: false, error: 'commit_error' }; }
}

// lifecycleStatus() — para el health admin (§17). Sin secrets ni payloads privados.
async function lifecycleStatus() {
  const out = {
    closing_scheduler_enabled: bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false),
    settlement_scheduler_enabled: bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false),
    commitment_scheduler_enabled: bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false) && bool(process.env.SIGNAL_REGISTRY_ENABLED, false),
    closing_eligible: 0, closing_captured: 0, closing_unavailable: 0,
    settlement_pending: 0, settlement_finalized: 0, settlement_unresolved: 0,
    commitment_count: 0, last_commitment_root: null,
  };
  if (!db.isConfigured()) return out;
  try {
    const c = (await db.query(`SELECT
      (SELECT count(*)::int FROM signal_closing_snapshots) captured,
      (SELECT count(*)::int FROM signal_closing_snapshots WHERE closing_status='UNAVAILABLE' OR capture_status='unavailable') unavailable,
      (SELECT count(*)::int FROM signal_state_projection WHERE settlement_status IS NULL OR settlement_status='pending') pending,
      (SELECT count(*)::int FROM signal_settlements WHERE settlement_status IN ('final','won','lost','void')) finalized,
      (SELECT count(*)::int FROM signal_settlements WHERE settlement_status='unresolved') unresolved,
      (SELECT count(*)::int FROM signal_registry_commitments) commitments,
      (SELECT root_hash FROM signal_registry_commitments ORDER BY commitment_date DESC LIMIT 1) last_root`).catch(() => ({ rows: [{}] }))).rows[0];
    const rows = await publishedSignals();
    out.closing_eligible = rows.filter(s => !s.closing_captured && elig.closingEligible(s, { verifiedEpoch: cfg.params.verifiedEpoch }).eligible).length;
    out.closing_captured = c.captured || 0; out.closing_unavailable = c.unavailable || 0;
    out.settlement_pending = c.pending || 0; out.settlement_finalized = c.finalized || 0; out.settlement_unresolved = c.unresolved || 0;
    out.commitment_count = c.commitments || 0; out.last_commitment_root = c.last_root ? String(c.last_root).slice(0, 16) : null;
  } catch { /* noop */ }
  return out;
}

module.exports = { closingSweep, settlementSweep, commitmentSweep, lifecycleStatus };
