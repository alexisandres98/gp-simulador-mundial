// freshness/index.js — Sprint 8A §21. CONTRATO DE FRESCURA centralizado y versionado. Única fuente de
// verdad de los umbrales (backend y frontend usan ESTOS, no valores distintos). Clasifica cada dato como
// fresh | aging | stale | unknown. PURO (sin DB).
'use strict';

const CONTRACT_VERSION = 'freshness-1';
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// umbrales por tipo de dato (aging, stale) en ms. Conservadores; sobre-escribibles por env.
function thresholds() {
  return {
    sportsbook_quote:       { aging: int(process.env.FRESH_SPORTSBOOK_AGING_MS, 3 * 60 * 1000), stale: int(process.env.FRESH_SPORTSBOOK_STALE_MS, 10 * 60 * 1000) },
    prediction_market_book: { aging: int(process.env.FRESH_PM_AGING_MS, 2 * 60 * 1000), stale: int(process.env.FRESH_PM_STALE_MS, 8 * 60 * 1000) },
    canonical_mapping:      { aging: int(process.env.FRESH_MAPPING_AGING_MS, 30 * 60 * 1000), stale: int(process.env.FRESH_MAPPING_STALE_MS, 6 * 60 * 60 * 1000) },
    model_output:           { aging: int(process.env.FRESH_MODEL_AGING_MS, 30 * 60 * 1000), stale: int(process.env.FRESH_MODEL_STALE_MS, 3 * 60 * 60 * 1000) },
    context:                { aging: int(process.env.FRESH_CONTEXT_AGING_MS, 60 * 60 * 1000), stale: int(process.env.FRESH_CONTEXT_STALE_MS, 6 * 60 * 60 * 1000) },
    value_evaluation:       { aging: int(process.env.FRESH_VALUE_AGING_MS, 3 * 60 * 1000), stale: int(process.env.FRESH_VALUE_STALE_MS, 10 * 60 * 1000) },
    arb_evaluation:         { aging: int(process.env.FRESH_ARB_AGING_MS, 60 * 1000), stale: int(process.env.FRESH_ARB_STALE_MS, 5 * 60 * 1000) },
    pick_gp:                { aging: int(process.env.FRESH_PICK_AGING_MS, 5 * 60 * 1000), stale: int(process.env.FRESH_PICK_STALE_MS, 30 * 60 * 1000) },
    closing_candidate:      { aging: int(process.env.FRESH_CLOSING_AGING_MS, 10 * 60 * 1000), stale: int(process.env.FRESH_CLOSING_STALE_MS, 60 * 60 * 1000) },
  };
}

// classify(ageMs, type) → 'fresh'|'aging'|'stale'|'unknown'
function classify(ageMs, type) {
  if (ageMs == null || !Number.isFinite(ageMs)) return 'unknown';
  const t = thresholds()[type];
  if (!t) return 'unknown';
  if (ageMs <= t.aging) return 'fresh';
  if (ageMs <= t.stale) return 'aging';
  return 'stale';
}

// evaluate(timestamp, type, now) → { status, ageMs, type, contract_version }. timestamp null → unknown.
function evaluate(timestamp, type, now = null) {
  const nowMs = now != null ? +new Date(now) : Date.now();
  if (timestamp == null) return { status: 'unknown', ageMs: null, type, contract_version: CONTRACT_VERSION };
  const ts = +new Date(timestamp);
  const ageMs = Number.isFinite(ts) ? nowMs - ts : null;
  return { status: classify(ageMs, type), ageMs, type, contract_version: CONTRACT_VERSION };
}

// ¿el dato sirve para producir una señal? fresh/aging sí (aging con aviso); stale/unknown NO.
function isUsable(status) { return status === 'fresh' || status === 'aging'; }

module.exports = { CONTRACT_VERSION, thresholds, classify, evaluate, isUsable };
