// signal-registry/sweeps.js — Fase H.1 (evoluciona H). Barridos AUTOMÁTICOS de closing/settlement/commitment
// cableados al orquestador. Sin CLI: closing resuelve consenso no-vig pre-kickoff y captura; settlement resuelve
// fixture ESPN persistente y liquida. Con signals=0 → no-op sano (0 eligible). Métricas detalladas §9.
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const elig = require('./lifecycleEligibility');
const closingResolver = require('./closingResolver');
const resultResolver = require('./resultResolver');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// result provider inyectable (prod: lo registra server.js con un accesor a db.results; tests: lo pasan directo).
let _resultProvider = null;
function setResultProvider(fn) { _resultProvider = fn; }

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

async function loadCatalog(provider) {
  try { return await require('../sportsbook-providers/sourceCatalog').load(provider); } catch { return {}; }
}

// closingSweep — captura automática del closing por cada señal elegible (§3-4). Métricas §9.
async function closingSweep(opts = {}) {
  if (!bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false) || !db.isConfigured()) return { processed: 0, reason: 'disabled' };
  const provider = process.env.SPORTSBOOK_PROVIDER_KEY || 'the_odds_api';
  const m = { eligible: 0, not_due: 0, captured_automatic: 0, captured_manual: 0, unavailable: 0, retryable: 0, look_ahead_rejected: 0, missing_mapping: 0, stale: 0, provider_error: 0, blocked: 0, final_no_data: 0 };
  try {
    const rows = await publishedSignals();
    const ctx = { verifiedEpoch: cfg.params.verifiedEpoch };
    const catalog = await loadCatalog(provider);
    const now = opts.now || Date.now();
    for (const s of rows) {
      if (s.closing_captured) continue;
      if (!elig.closingEligible(s, ctx).eligible) continue;
      m.eligible++;
      try {
        const r = await closingResolver.resolveClosing(s, { now, catalog, provider, adminStatus: s.admin_status, captureSource: 'automatic', quoteLoader: opts.quoteLoader });
        if (r.state === 'NOT_DUE') m.not_due++;
        else if (r.state === 'RETRYABLE') m.retryable++;
        else if (r.state === 'BLOCKED') m.blocked++;
        else if (r.state === 'FINAL_NO_DATA') m.final_no_data++;
        else if (r.state === 'UNAVAILABLE') m.unavailable++;
        else if (r.state === 'CAPTURED') { if (r.closingStatus === 'STALE') m.stale++; m.captured_automatic++; }
      } catch (e) {
        if (e.code === 'look_ahead_rejected') m.look_ahead_rejected++; else m.provider_error++;
      }
    }
    return { processed: m.captured_automatic, scanned: rows.length, ...m };
  } catch (e) { return { processed: 0, error: 'sweep_error', ...m }; }
}

// settlementSweep — liquidación automática por resultado ESPN reglamentario (§5-6). Métricas §9.
async function settlementSweep(opts = {}) {
  if (!bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false) || !db.isConfigured()) return { processed: 0, reason: 'disabled' };
  const m = { eligible: 0, provisional: 0, finalized_automatic: 0, finalized_manual: 0, unresolved: 0, missing_mapping: 0, provider_error: 0, corrected: 0, blocked_data_error: 0, pending: 0, skipped: 0 };
  const resultProvider = opts.resultProvider || _resultProvider;
  try {
    const rows = await publishedSignals();
    const ctx = { verifiedEpoch: cfg.params.verifiedEpoch };
    const now = opts.now || Date.now();
    for (const s of rows) {
      if (['final', 'won', 'lost', 'void', 'cancelled'].includes(s.proj_settlement)) continue;
      if (!s.event_start_at || +new Date(s.event_start_at) > now) continue; // aún no inició
      if (!elig.closingEligible(s, ctx).eligible) continue;
      m.eligible++;
      if (s.admin_status === 'DATA_ERROR') { m.blocked_data_error++; continue; }
      try {
        const r = await resultResolver.resolveAndSettle(s, { resultProvider, now, adminStatus: s.admin_status, captureSource: 'automatic' });
        if (r.state === 'MISSING_MAPPING') m.missing_mapping++;
        else if (r.state === 'PENDING') m.pending++;
        else if (r.state === 'PROVISIONAL') m.provisional++;
        else if (r.state === 'FINALIZED') m.finalized_automatic++;
        else if (r.state === 'UNRESOLVED') m.unresolved++;
        else if (r.state === 'SKIPPED') m.skipped++;
      } catch (e) { m.provider_error++; }
    }
    return { processed: m.finalized_automatic + m.provisional, scanned: rows.length, ...m };
  } catch (e) { return { processed: 0, error: 'sweep_error', ...m }; }
}

// commitmentSweep — §10 cadencia diaria: commitea el día UTC CERRADO (ayer) una vez, idempotente por fecha,
// con retry (interval del job). No fabrica root vacío. one-shot admin disponible vía commitDay(date).
async function commitmentSweep(opts = {}) {
  const writeOn = bool(process.env.SIGNAL_REGISTRY_ENABLED, false) && bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false);
  if (!writeOn || !db.isConfigured()) return { committed: false, reason: 'disabled' };
  const now = opts.now ? new Date(opts.now) : new Date();
  // gate 00:10 UTC: no commitear en los primeros 10 min del día (deja cerrar el día anterior con holgura)
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 10) return { committed: false, reason: 'before_daily_cutoff' };
  const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const targetDate = opts.targetDate || y.toISOString().slice(0, 10);
  try { const c = await require('./index').commitDay(targetDate); return { committed: !c.skipped, target_date: targetDate, ...c }; }
  catch (e) { return { committed: false, target_date: targetDate, error: 'commit_error' }; }
}

// lifecycleStatus() — health admin §17/§9 (automatic vs manual). Sin secrets.
async function lifecycleStatus() {
  const out = {
    closing_scheduler_enabled: bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false),
    settlement_scheduler_enabled: bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false),
    commitment_scheduler_enabled: bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false) && bool(process.env.SIGNAL_REGISTRY_ENABLED, false),
    result_provider_wired: !!_resultProvider,
    closing_eligible: 0, closing_captured_automatic: 0, closing_captured_manual: 0, closing_unavailable: 0,
    settlement_pending: 0, settlement_finalized_automatic: 0, settlement_finalized_manual: 0, settlement_unresolved: 0,
    fixture_mappings: 0, commitment_count: 0, last_commitment_root: null,
  };
  if (!db.isConfigured()) return out;
  try {
    const c = (await db.query(`SELECT
      (SELECT count(*)::int FROM signal_closing_snapshots WHERE capture_source='automatic') cauto,
      (SELECT count(*)::int FROM signal_closing_snapshots WHERE capture_source IN ('manual_recovery','admin_override')) cman,
      (SELECT count(*)::int FROM signal_closing_snapshots WHERE closing_status='UNAVAILABLE' OR capture_status='unavailable') cunav,
      (SELECT count(*)::int FROM signal_state_projection WHERE settlement_status IS NULL OR settlement_status='pending') spend,
      (SELECT count(*)::int FROM signal_settlements WHERE settlement_status IN ('final','won','lost','void') AND capture_source='automatic') sfauto,
      (SELECT count(*)::int FROM signal_settlements WHERE settlement_status IN ('final','won','lost','void') AND capture_source IN ('manual_recovery','admin_override')) sfman,
      (SELECT count(*)::int FROM signal_settlements WHERE settlement_status='unresolved') sunres,
      (SELECT count(*)::int FROM signal_event_fixture_mappings) fmap,
      (SELECT count(*)::int FROM signal_registry_commitments) commitments,
      (SELECT root_hash FROM signal_registry_commitments ORDER BY commitment_date DESC LIMIT 1) last_root`).catch(() => ({ rows: [{}] }))).rows[0];
    const rows = await publishedSignals();
    out.closing_eligible = rows.filter(s => !s.closing_captured && elig.closingEligible(s, { verifiedEpoch: cfg.params.verifiedEpoch }).eligible).length;
    out.closing_captured_automatic = c.cauto || 0; out.closing_captured_manual = c.cman || 0; out.closing_unavailable = c.cunav || 0;
    out.settlement_pending = c.spend || 0; out.settlement_finalized_automatic = c.sfauto || 0; out.settlement_finalized_manual = c.sfman || 0; out.settlement_unresolved = c.sunres || 0;
    out.fixture_mappings = c.fmap || 0; out.commitment_count = c.commitments || 0; out.last_commitment_root = c.last_root ? String(c.last_root).slice(0, 16) : null;
  } catch { /* noop */ }
  return out;
}

module.exports = { closingSweep, settlementSweep, commitmentSweep, lifecycleStatus, setResultProvider };
