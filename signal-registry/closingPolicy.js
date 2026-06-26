// signal-registry/closingPolicy.js — Fase H §5-7. Política de closing oficial + estado de captura
// (anti-look-ahead) + componentes de CLV. CAPA PURA. NO selecciona cuotas posteriores al kickoff.
'use strict';

const CLOSING_POLICY_VERSION = 'closing-policy-1';
// Valor OFICIAL para CLV (§6): consenso no-vig de grupos independientes verificados, del último set completo y
// válido ANTES del kickoff. best_sportsbook y por-sportsbook se conservan como referencia, no como oficial.
const OFFICIAL_CLOSING_SOURCE = 'consensus_no_vig';

const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// tolerancias técnicas (solo latencia de persistencia; nunca para elegir una cuota post-kickoff)
function tolerances() {
  return {
    observedToleranceMs: int(process.env.SIGNAL_CLOSING_OBSERVED_TOLERANCE_MS, 0), // observed_at <= kickoff + tol
    staleMs: int(process.env.SIGNAL_CLOSING_STALE_MS, 30 * 60 * 1000),             // quote más vieja que esto antes del kickoff → STALE
  };
}

// classifyCapture(input, kickoff) → { status, reason, usable }
//   status ∈ AVAILABLE|UNAVAILABLE|STALE|MARKET_SUSPENDED|EVENT_STARTED|MAPPING_ERROR|NO_EQUIVALENT_MARKET|PROVIDER_ERROR
//   Regla anti-look-ahead (§5): provider_updated_at <= kickoff (estricto) y observed_at <= kickoff + tolerancia.
function classifyCapture(input = {}, kickoffAt) {
  const t = tolerances();
  const kickoff = ms(kickoffAt);
  const observed = ms(input.observedAt);
  const providerUpdated = ms(input.providerUpdatedAt);
  const hasPrice = [input.closingOdds, input.midpoint, input.executablePrice, input.bestBid, input.bestAsk].some(x => x != null);

  if (input.mappingError) return { status: 'MAPPING_ERROR', reason: 'MAPPING_ERROR', usable: false };
  if (input.noEquivalentMarket) return { status: 'NO_EQUIVALENT_MARKET', reason: 'NO_EQUIVALENT_MARKET', usable: false };
  if (input.providerError) return { status: 'PROVIDER_ERROR', reason: 'PROVIDER_ERROR', usable: false };
  if (input.suspended) return { status: 'MARKET_SUSPENDED', reason: 'MARKET_SUSPENDED', usable: false };
  if (!hasPrice || observed == null) return { status: 'UNAVAILABLE', reason: 'NO_PRECLOSE_DATA', usable: false };

  // anti-look-ahead: quote actualizada por el proveedor DESPUÉS del kickoff → no se usa.
  if (kickoff != null && providerUpdated != null && providerUpdated > kickoff) return { status: 'EVENT_STARTED', reason: 'PROVIDER_UPDATE_AFTER_KICKOFF', usable: false };
  // observación posterior al kickoff más allá de la tolerancia técnica → no se usa.
  if (kickoff != null && observed > kickoff + t.observedToleranceMs) return { status: 'EVENT_STARTED', reason: 'OBSERVED_AFTER_KICKOFF', usable: false };
  // quote demasiado vieja antes del kickoff → válida pero marcada STALE.
  if (kickoff != null && providerUpdated != null && (kickoff - providerUpdated) > t.staleMs) return { status: 'STALE', reason: 'QUOTE_TOO_OLD', usable: true };

  return { status: 'AVAILABLE', reason: 'OK', usable: true };
}

// legacy capture_status (enum de mig 013) derivado del closing_status detallado.
function legacyCaptureStatus(closingStatus) {
  if (closingStatus === 'AVAILABLE' || closingStatus === 'STALE') return 'captured';
  if (closingStatus === 'MARKET_SUSPENDED') return 'suspended';
  return 'unavailable';
}

// clvComponents — persistir lo suficiente para reproducir el CLV (§7). NO mezcla fuentes sin etiquetar.
function clvComponents({ publishedOdds, closingOdds, closingSource, closingProbability } = {}) {
  const entryImplied = publishedOdds ? 1 / Number(publishedOdds) : null;
  const closeImplied = closingOdds ? 1 / Number(closingOdds) : (closingProbability != null ? Number(closingProbability) : null);
  return {
    closing_policy_version: CLOSING_POLICY_VERSION,
    official_source: OFFICIAL_CLOSING_SOURCE,
    published_odds: publishedOdds != null ? String(publishedOdds) : null,
    closing_odds: closingOdds != null ? String(closingOdds) : null,
    closing_source: closingSource || OFFICIAL_CLOSING_SOURCE,
    entry_implied_probability: entryImplied,
    closing_implied_probability: closeImplied,
    // CLV oficial NO se calcula/expone aquí (Metrics off); solo se guardan componentes reproducibles.
    note: 'componentes para CLV; metric oficial via Sprint 6 con su policy; no mezclar best-price con consensus sin etiquetar',
  };
}

module.exports = { CLOSING_POLICY_VERSION, OFFICIAL_CLOSING_SOURCE, classifyCapture, legacyCaptureStatus, clvComponents, tolerances };
