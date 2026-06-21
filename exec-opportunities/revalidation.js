// exec-opportunities/revalidation.js — Sprint 4. Revalidación continua. Puro, sin DB.
// Una publicación aprobada NO puede permanecer visible indefinidamente con una evaluación antigua.
// La vista activa usa la evaluación ACTUAL (current_evaluation_id) o una revalidación reciente,
// NUNCA el best_net_roi histórico. No se revive una publicación retirada sin re-aprobación explícita.
'use strict';

const cfg = require('./config');
const { checkEligibility } = require('./eligibility');

// estados de display (sección 28): ACTIVE / VERIFYING / AGING / EXPIRED / PAUSED / WITHDRAWN
const TERMINAL = new Set(['withdrawn', 'rejected', 'expired']);

// revalidate(publication, currentEv, ctx) → { visible, displayStatus, nextStatus, reasons[], staleValidation }
//   publication = { status, published_evaluation_id, published_mapping_version, published_rules_fingerprint, expires_at }
//   currentEv   = última evaluación del motor para esa opportunity (evaluateCandidate output) | null
//   ctx         = { now, opportunityStatus, lastValidatedAt, mappingStatus, outcomeMappingStatus,
//                   hardConflicts, marketStatus, freshness, currentMappingVersion, currentRulesFingerprint,
//                   allowExecutionSensitive }
function revalidate(publication, currentEv, ctx = {}) {
  const now = ctx.now || Date.now();
  const reasons = [];
  const status = publication && publication.status;

  // 1) Estados manuales/terminales mandan. No se revive nada automáticamente.
  if (status === 'paused') return done(false, 'PAUSED', 'paused', ['manually_paused'], false);
  if (status === 'withdrawn') return done(false, 'WITHDRAWN', 'withdrawn', ['manually_withdrawn'], false);
  if (status === 'rejected') return done(false, 'WITHDRAWN', 'rejected', ['rejected'], false);
  if (status === 'expired') return done(false, 'EXPIRED', 'expired', ['already_expired'], false);
  if (status === 'draft' || status === 'approved') {
    // aún no publicada → no visible al público, pero no es terminal
    return done(false, 'VERIFYING', status, ['not_yet_published'], false);
  }
  // a partir de aquí: status === 'published'

  // 2) ¿Expiró por reloj?
  if (publication.expires_at && new Date(publication.expires_at).getTime() <= now) reasons.push('expired_by_clock');

  // 3) Cambios en la base de equivalencia → invalidated (no expired).
  let invalidated = false;
  if (publication.published_mapping_version && ctx.currentMappingVersion &&
      publication.published_mapping_version !== ctx.currentMappingVersion) { reasons.push('mapping_version_changed'); invalidated = true; }
  if (publication.published_rules_fingerprint && ctx.currentRulesFingerprint &&
      publication.published_rules_fingerprint !== ctx.currentRulesFingerprint) { reasons.push('rules_fingerprint_changed'); invalidated = true; }

  // 4) Estado de la oportunidad en el ciclo de vida del motor.
  if (ctx.opportunityStatus && !['active', 'detected', 'aging'].includes(ctx.opportunityStatus)) {
    reasons.push('opportunity_status_' + ctx.opportunityStatus);
  }

  // 5) Re-chequeo de elegibilidad contra la evaluación ACTUAL.
  if (!currentEv) {
    reasons.push('no_current_evaluation');
  } else {
    const elig = checkEligibility(currentEv, {
      mappingStatus: ctx.mappingStatus, outcomeMappingStatus: ctx.outcomeMappingStatus,
      hardConflicts: ctx.hardConflicts, marketStatus: ctx.marketStatus, freshness: ctx.freshness,
      jurisdictionMetadataAvailable: true, deepLinksValid: true,
    }, { allowExecutionSensitive: ctx.allowExecutionSensitive });
    if (!elig.eligible) reasons.push(...elig.reasons.map(r => 'current_' + r));
  }

  // 6) Decisión.
  if (invalidated) return done(false, 'EXPIRED', 'expired', reasons, false); // invalidación → se oculta y se marca expirada
  if (reasons.length) return done(false, 'EXPIRED', 'expired', reasons, false);

  // 7) ¿La validación es reciente? Si no, marcar "verifying" (no ocultar todavía, refrescar).
  const valAgeMs = ctx.lastValidatedAt ? (now - new Date(ctx.lastValidatedAt).getTime()) : Infinity;
  const staleValidation = valAgeMs > cfg.publication.maxRevalidationAgeMs;
  if (staleValidation) return done(true, 'VERIFYING', 'published', [], true);

  // 8) Activa y vigente.
  const aging = ctx.opportunityStatus === 'aging';
  return done(true, aging ? 'AGING' : 'ACTIVE', 'published', [], false);

  function done(visible, displayStatus, nextStatus, rs, sv) {
    return { visible, displayStatus, nextStatus, reasons: rs, staleValidation: sv };
  }
}

module.exports = { revalidate, TERMINAL };
