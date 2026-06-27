// model-registry/promotion.js — Fase M.8. Cutover readiness: config del modelo oficial + máquina de promoción
// V1→V2 versionada y REVERSIBLE + kill switch + fallback gating. INERTE: por defecto el modelo oficial es V1
// (gp-core-1.4.0, comportamiento actual exacto). NADA promueve V2 automáticamente; el cutover exige llamada
// explícita + flag, y queda auditado en model_promotion_policies/model_cutover_events (data layer M.2). No
// rewirea el pipeline (no toca server.js): es la maquinaria lista para el GO/NO-GO de ChatGPT.
'use strict';
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// Config del modelo oficial desde env. Defaults = V1 actual (sin cambio de comportamiento).
function officialModelConfig() {
  return {
    official_model: (process.env.GP_OFFICIAL_MODEL || 'v1').toLowerCase(),   // 'v1' | 'v2'  (default v1)
    v1_model_version: process.env.GP_V1_MODEL_VERSION || 'gp-core-1.4.0',
    v2_model_version: process.env.GP_V2_MODEL_VERSION || 'gp-intelligence-v2-0.1.0',
    v2_shadow_enabled: bool(process.env.GP_V2_SHADOW_ENABLED, false),         // calcular V2 en shadow
    v2_kill_switch: bool(process.env.GP_V2_KILL_SWITCH, false),               // matar V2 (fuerza V1)
    context_engine_enabled: bool(process.env.CONTEXT_ENGINE_ENABLED, false),
  };
}

// ¿Cuál es el modelo oficial EFECTIVO ahora? Respeta el kill switch (si está ON → V1 sí o sí).
function effectiveOfficialModel(cfg = officialModelConfig()) {
  if (cfg.v2_kill_switch) return 'v1';
  return cfg.official_model === 'v2' ? 'v2' : 'v1';
}

// Estados de cobertura de contexto (§14): gating para elegibilidad de candidates V2.
const CONTEXT_STATES = ['FULL_CONTEXT', 'PARTIAL_CONTEXT', 'BASE_ONLY_FALLBACK', 'BLOCKED'];
// Policy inicial recomendada: FULL elegible; PARTIAL elegible solo si no falta input crítico; BASE_ONLY no crea
// STRONG hasta policy; BLOCKED no evalúa. Devuelve { eligibleForCandidate, reason }.
function fallbackGate({ contextState, missingCritical }) {
  if (contextState === 'BLOCKED') return { eligibleForCandidate: false, reason: 'blocked' };
  if (contextState === 'BASE_ONLY_FALLBACK') return { eligibleForCandidate: false, reason: 'base_only_no_strong' };
  if (contextState === 'PARTIAL_CONTEXT') return { eligibleForCandidate: !missingCritical, reason: missingCritical ? 'missing_critical_input' : 'partial_ok' };
  if (contextState === 'FULL_CONTEXT') return { eligibleForCandidate: true, reason: 'full' };
  return { eligibleForCandidate: false, reason: 'unknown_state' };
}

// ---------- máquina de promoción (todo auditado; NUNCA activa sola) ----------
async function propose(policy, { repo = require('./repository') } = {}) {
  return repo.proposePromotion(policy);
}
async function approve(policyId, { actorId, reason, repo = require('./repository') } = {}) {
  return repo.transition(policyId, 'approved', { actorId, reason });
}
// activate exige flag explícito GP_ALLOW_CUTOVER=true (doble seguro) + no estar en kill switch.
async function activate(policyId, { actorId, reason, repo = require('./repository') } = {}) {
  if (!bool(process.env.GP_ALLOW_CUTOVER, false)) return { ok: false, reason: 'cutover_disabled' };
  if (officialModelConfig().v2_kill_switch) return { ok: false, reason: 'kill_switch_on' };
  return repo.transition(policyId, 'activated', { actorId, reason });
}
async function rollback(policyId, { actorId, reason, repo = require('./repository') } = {}) {
  return repo.transition(policyId, 'rolled_back', { actorId, reason });
}

module.exports = { officialModelConfig, effectiveOfficialModel, CONTEXT_STATES, fallbackGate, propose, approve, activate, rollback };
