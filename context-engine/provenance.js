// context-engine/provenance.js — Fase M.2. Provenance + ANTI-LEAKAGE point-in-time para GP Intelligence V2.
// PURO (sin DB). Clasifica cada observación de contexto (FACT/INFERENCE/RUMOR/UNKNOWN), aplica la política de
// impacto y, sobre todo, GARANTIZA que ninguna información posterior al cutoff (kickoff) pueda afectar al modelo.
// Reglas duras (§5/§6 del spec M):
//   - Sin timestamp verificable (published_at u observed_at) → NO puede mover la probabilidad (impacto 0).
//   - Timestamp posterior al cutoff → RECHAZADO (leakage), impacto 0.
//   - RUMOR/UNKNOWN → impacto 0 (registrar, no aplicar).
//   - FACT verificable → puede aplicar; INFERENCE fundada → aplica con menor peso y más uncertainty.
'use strict';
const crypto = require('crypto');

const CLASSES = ['FACT', 'INFERENCE', 'RUMOR', 'UNKNOWN'];

// multiplicador de impacto por clase (peso máximo permitido antes de confidence/caps)
const CLASS_IMPACT_WEIGHT = { FACT: 1, INFERENCE: 0.5, RUMOR: 0, UNKNOWN: 0 };
// penalización de incertidumbre por clase (mayor = más uncertainty inyectada)
const CLASS_UNCERTAINTY = { FACT: 0, INFERENCE: 0.5, RUMOR: 1, UNKNOWN: 1 };

const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };

function classify(raw) {
  const c = String(raw || 'UNKNOWN').toUpperCase();
  return CLASSES.includes(c) ? c : 'UNKNOWN';
}

// La marca de tiempo "efectiva" de una observación: la más temprana disponible entre published_at/observed_at.
// Sin ninguna → null (no verificable en el tiempo).
function effectiveTimestamp(obs) {
  const p = ms(obs.published_at), o = ms(obs.observed_at);
  if (p == null && o == null) return null;
  if (p == null) return o;
  if (o == null) return p;
  return Math.max(p, o); // la más tardía: si CUALQUIERA es posterior al cutoff hay riesgo de leakage
}

// ANTI-LEAKAGE: ¿esta observación puede usarse para una evaluación con este cutoff?
// Devuelve { eligible, reason }. NUNCA elegible si: falta timestamp, o el timestamp es posterior al cutoff.
function pointInTimeEligible(obs, cutoff) {
  const cut = ms(cutoff);
  if (cut == null) return { eligible: false, reason: 'no_cutoff' };
  const ts = effectiveTimestamp(obs);
  if (ts == null) return { eligible: false, reason: 'no_timestamp' };
  if (ts > cut) return { eligible: false, reason: 'after_cutoff' };
  return { eligible: true, reason: 'ok' };
}

// Impacto efectivo (en log-odds) tras aplicar: elegibilidad point-in-time + clase + confianza + caps de policy.
// policy: { max_logit_delta, confidence_weight, fact_required }. proposed: impacto propuesto (log-odds) y dirección.
function effectiveImpact(obs, cutoff, policy = {}) {
  const klass = classify(obs.fact_or_inference);
  const pit = pointInTimeEligible(obs, cutoff);
  if (!pit.eligible) return { applied_impact: 0, blocked: true, reason: pit.reason, klass };
  if (policy.fact_required && klass !== 'FACT') return { applied_impact: 0, blocked: true, reason: 'fact_required', klass };
  const classW = CLASS_IMPACT_WEIGHT[klass];
  if (classW === 0) return { applied_impact: 0, blocked: true, reason: 'class_zero_impact', klass };
  const conf = Math.max(0, Math.min(1, Number(obs.confidence) || 0));
  const confW = policy.confidence_weight != null ? Math.max(0, Math.min(1, Number(policy.confidence_weight))) : 1;
  const proposed = Number(obs.proposed_impact) || 0;
  const cap = policy.max_logit_delta != null ? Math.abs(Number(policy.max_logit_delta)) : Infinity;
  let impact = proposed * classW * conf * confW;
  if (Math.abs(impact) > cap) impact = Math.sign(impact) * cap;
  return { applied_impact: +impact.toFixed(6), blocked: false, reason: 'applied', klass, uncertainty: CLASS_UNCERTAINTY[klass] };
}

// hash de evidencia reproducible (no incluye timestamps de ingesta para que la misma evidencia → mismo hash).
function evidenceHash(obs) {
  const core = {
    factor_code: obs.factor_code, subject_type: obs.subject_type, subject_id: obs.subject_id,
    canonical_event_id: obs.canonical_event_id, source_name: obs.source_name, source_reference: obs.source_reference,
    published_at: obs.published_at || null, observed_at: obs.observed_at || null, raw_value: obs.raw_value ?? null,
    fact_or_inference: classify(obs.fact_or_inference),
  };
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

module.exports = {
  CLASSES, CLASS_IMPACT_WEIGHT, CLASS_UNCERTAINTY,
  classify, effectiveTimestamp, pointInTimeEligible, effectiveImpact, evidenceHash,
};
