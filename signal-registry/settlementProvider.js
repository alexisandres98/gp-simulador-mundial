// signal-registry/settlementProvider.js — Fase H §9-11. Resuelve el resultado FACTUAL de tiempo reglamentario
// (1X2 regulation) a partir de un resultado de proveedor, distinguiendo provisional vs final y eventos
// especiales. CAPA PURA. NO infiere WON/LOST por marcador mostrado sin validar reglas; si no es verificable →
// UNRESOLVED. Nunca incluye prórroga ni penales (§1).
'use strict';

// Fuente real que alimentará settlement (auditoría §9):
//   provider: ESPN scoreboard (site.api.espn.com/.../fifa.world/scoreboard) — el mismo poller de resultados
//             del producto (server.js syncFromESPN), que ya distingue 'final' (post) de 'live'.
//   event mapping: canonical_event_id → fixture ESPN (data/fixtures-real.json + db.results[fixtureId]).
//   status mapping: ESPN state 'post' → final; 'in'/'live' → provisional; 'pre' → pending.
//   regulation score: para 1X2 regulation se usa el marcador de 90' reglamentarios. En fase de grupos final=regulation;
//             en eliminatorias hay que excluir prórroga/penales → si no se dispone del marcador reglamentario
//             separado de forma verificable, el settlement es UNRESOLVED (no se infiere).
//   finality: provider 'final' + finalized → settlement final; de lo contrario provisional/pending.
//   correcciones del proveedor: si el proveedor corrige el marcador → nueva versión (no se sobrescribe).
//   latencia esperada: poller cada ~2 min.
//   fallback policy: sin resultado verificable → UNRESOLVED; resolución manual = acción admin auditada.
const PROVIDER = 'espn_scoreboard';
const SETTLEMENT_POLICY_VERSION = 'settlement-policy-1';

const FINAL_PROVIDER_STATES = ['final', 'post', 'complete', 'ft'];
const PROVISIONAL_PROVIDER_STATES = ['in', 'live', 'in_progress', 'provisional'];

// resolveRegulation1x2(input) → settlement struct factual (sin won/lost del pick: eso es Metrics).
//   input: { providerStatus, regulationHomeGoals, regulationAwayGoals, postponed, cancelled, abandoned,
//            hasExtraTimeOrPens, observedAt, finalizedAt }
function resolveRegulation1x2(input = {}) {
  const status = String(input.providerStatus || '').toLowerCase();
  const base = { provider: PROVIDER, settlement_policy_version: SETTLEMENT_POLICY_VERSION, provider_result_status: status || 'unknown', result_observed_at: input.observedAt || null, result_finalized_at: null };

  // eventos especiales (§11)
  if (input.postponed) return { ...base, settlement_status: 'postponed', result_outcome: 'none', is_final: false, finality: 'none' };
  if (input.cancelled) return { ...base, settlement_status: 'cancelled', result_outcome: 'void', is_final: true, finality: 'final', result_finalized_at: input.finalizedAt || null };
  if (input.abandoned) return { ...base, settlement_status: 'unresolved', result_outcome: 'none', is_final: false, finality: 'none' }; // seguir reglas de la casa; si no hay → unresolved

  const hg = num(input.regulationHomeGoals), ag = num(input.regulationAwayGoals);
  // sin marcador reglamentario verificable → UNRESOLVED (no se infiere)
  if (hg == null || ag == null) return { ...base, settlement_status: 'unresolved', result_outcome: 'unresolved', is_final: false, finality: 'none' };

  const outcome = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
  const regulation_score = { home_goals: hg, away_goals: ag };
  const isFinal = FINAL_PROVIDER_STATES.includes(status);
  if (isFinal) {
    return { ...base, settlement_status: 'final', result_outcome: outcome, regulation_score, is_final: true, finality: 'final', result_finalized_at: input.finalizedAt || input.observedAt || null };
  }
  if (PROVISIONAL_PROVIDER_STATES.includes(status)) {
    return { ...base, settlement_status: 'provisional', result_outcome: outcome, regulation_score, is_final: false, finality: 'provisional' };
  }
  // estado desconocido con marcador → pendiente (no se finaliza)
  return { ...base, settlement_status: 'pending', result_outcome: 'unresolved', regulation_score, is_final: false, finality: 'pending' };
}

function num(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

module.exports = { PROVIDER, SETTLEMENT_POLICY_VERSION, resolveRegulation1x2 };
