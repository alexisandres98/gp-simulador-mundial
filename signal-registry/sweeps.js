// signal-registry/sweeps.js — Sprint 8A §112. Barridos para cablear closing/settlement/commitment como
// jobs del orquestador SIN tocar la lógica inmutable de Sprint 5. Gated por los flags de Sprint 5. HONESTOS:
// cuando no hay señales que procesar devuelven { processed: 0 } (hoy signals=0). El captureClosing real
// requiere una fuente de cierre enlazada (pendiente de activación real, §110/§111) → aquí solo se
// IDENTIFICAN candidatos; la captura efectiva es manual/CLI hasta que exista la fuente automática.
'use strict';
const { commitDay } = require('./index');
const db = require('../database/client');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// candidatos a closing: señales publicadas, aún sin cierre capturado. (No fabrica precios.)
async function closingSweep() {
  if (!bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false) || !db.isConfigured()) return { processed: 0, reason: 'disabled' };
  try {
    const r = await db.query(`SELECT count(*)::int n FROM signal_state_projection WHERE current_status='published' AND closing_captured=false`);
    const candidates = r.rows[0].n;
    // sin fuente de cierre automática enlazada → solo reportamos candidatos (captura real: manual/CLI)
    return { processed: 0, candidates, reason: candidates ? 'awaiting_closing_source' : 'no_candidates' };
  } catch (e) { return { processed: 0, error: 'sweep_error' }; }
}

// candidatos a settlement: eventos cerrados sin settlement final. (No sobrescribe settlements previos.)
async function settlementSweep() {
  if (!bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false) || !db.isConfigured()) return { processed: 0, reason: 'disabled' };
  try {
    const r = await db.query(`SELECT count(*)::int n FROM signal_state_projection WHERE current_status='published' AND (settlement_status IS NULL OR settlement_status NOT IN ('final','void','cancelled'))`);
    const candidates = r.rows[0].n;
    return { processed: 0, candidates, reason: candidates ? 'awaiting_settlement_source' : 'no_candidates' };
  } catch (e) { return { processed: 0, error: 'sweep_error' }; }
}

// commitment diario: ESTE sí es real e idempotente (merkle root del día). Seguro aunque haya 0 señales.
async function commitmentSweep() {
  const writeOn = bool(process.env.SIGNAL_REGISTRY_ENABLED, false) && bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false);
  if (!writeOn || !db.isConfigured()) return { committed: false, reason: 'disabled' };
  try { const c = await commitDay(); return { committed: true, ...c }; }
  catch (e) { return { committed: false, error: 'commit_error' }; }
}

module.exports = { closingSweep, settlementSweep, commitmentSweep };
