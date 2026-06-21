// exec-opportunities/publicationService.js — Sprint 4 §7,25,26. Publicación CONTROLADA y auditada.
// INVARIANTE: NO hay auto-publicación. Ninguna función publica por clasificación. Toda transición a
// 'published' exige: (1) flag EXEC_OPPORTUNITIES_MANUAL_PUBLICATION_ENABLED, (2) llamada explícita de un
// admin, (3) revalidación de elegibilidad contra la evaluación ACTUAL. Cada transición queda en historial.
'use strict';

const crypto = require('crypto');
const db = require('../database/client');
const cfg = require('./config');
const presentation = require('./presentation');
const { checkEligibility } = require('./eligibility');
const { revalidate } = require('./revalidation');
const pubRepo = require('./repositories/publicationRepository');
const histRepo = require('./repositories/publicationHistoryRepository');

function err(code) { const e = new Error(code); e.code = code; return e; }
function newPublicId() { return 'op_' + crypto.randomBytes(9).toString('hex'); }

// Transición atómica: bloquea la fila, valida el estado origen, actualiza y audita en la misma transacción.
async function transition(id, { from, to, action, actorId, reason, patch = {}, evaluationId, metadata }) {
  return db.withTransaction(async (client) => {
    const cur = (await client.query('SELECT * FROM arb_publications WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw err('publication_not_found');
    if (from && !from.includes(cur.publication_status)) throw err('invalid_transition:' + cur.publication_status + '->' + to);
    const updated = await pubRepo.update(id, { status: to, ...patch }, client);
    await histRepo.insert({ publicationId: id, previousStatus: cur.publication_status, newStatus: to, action, actorId, reason, evaluationId, metadata }, client);
    return updated;
  });
}

// createDraft({ opportunityId, opportunityKey, evaluationId, evaluationView, context, actorId, visibility })
// Crea borrador con el public_payload construido desde la evaluación actual. No publica nada.
async function createDraft({ opportunityId, opportunityKey, evaluationId, evaluationView, context = {}, actorId, visibility = 'internal' } = {}) {
  if (!opportunityKey) throw err('opportunity_key_required');
  const publicId = newPublicId();
  const payload = presentation.buildPublicPayload(evaluationView, { ...context, publicId });
  const created = await pubRepo.create({
    opportunityId, opportunityKey, evaluationId, publicId, status: 'draft', visibility,
    publicationReason: 'draft_created', publicPayload: payload,
    publishedMappingVersion: context.currentMappingVersion || (evaluationView && evaluationView.mappingVersion) || null,
    publishedRulesFingerprint: context.currentRulesFingerprint || (evaluationView && evaluationView.rulesFingerprint) || null,
    riskDisclosureVersion: cfg.RISK_DISCLOSURE_VERSION,
  });
  await histRepo.insert({ publicationId: created.id, previousStatus: null, newStatus: 'draft', action: 'create', actorId, reason: 'draft_created' });
  return created;
}

// approve(id, { actorId, evaluationView, context, allowExecutionSensitive })
// Exige elegibilidad contra la evaluación ACTUAL. draft → approved.
async function approve(id, { actorId, evaluationView, context = {}, allowExecutionSensitive } = {}) {
  if (!cfg.flags.manualPublicationEnabled) throw err('manual_publication_disabled');
  const elig = checkEligibility(evaluationView, context, { allowExecutionSensitive });
  if (!elig.eligible) throw err('not_eligible:' + elig.reasons.join(','));
  return transition(id, { from: ['draft', 'rejected'], to: 'approved', action: 'approve', actorId, reason: 'eligibility_passed',
    patch: { reviewedBy: actorId || null, reviewedAt: new Date().toISOString() },
    evaluationId: context.evaluationId, metadata: { warnings: elig.warnings } });
}

// publish(id, { actorId, evaluationView, context, ttlMs, visibility, allowExecutionSensitive })
// Revalida y publica. NUNCA publica una evaluación que dejó de ser elegible. Congela el snapshot.
async function publish(id, { actorId, evaluationView, context = {}, ttlMs, visibility = 'public', allowExecutionSensitive } = {}) {
  if (!cfg.flags.manualPublicationEnabled) throw err('manual_publication_disabled');
  // Revalidación de elegibilidad contra la evaluación actual (no publicar stale).
  const elig = checkEligibility(evaluationView, context, { allowExecutionSensitive });
  if (!elig.eligible) throw err('revalidation_failed:' + elig.reasons.join(','));

  const publicId = (await pubRepo.findById(id) || {}).public_id || newPublicId();
  const now = Date.now();
  const expiresAt = new Date(now + (ttlMs || cfg.publication.maxRevalidationAgeMs)).toISOString();
  // Snapshot CONGELADO de lo que verá el usuario al publicar.
  const frozen = presentation.buildPublicPayload(evaluationView, { ...context, publicId, now, expiresAt });

  return transition(id, { from: ['approved', 'paused'], to: 'published', action: 'publish', actorId, reason: 'manual_publish',
    patch: {
      publishedAt: new Date(now).toISOString(), expiresAt, visibility, publicPayload: frozen,
      evaluationId: context.evaluationId,
      publishedMappingVersion: context.currentMappingVersion || (evaluationView && evaluationView.mappingVersion) || null,
      publishedRulesFingerprint: context.currentRulesFingerprint || (evaluationView && evaluationView.rulesFingerprint) || null,
      unpublicationReason: null,
    },
    evaluationId: context.evaluationId, metadata: { warnings: elig.warnings, visibility } });
}

async function pause(id, { actorId, reason } = {}) {
  return transition(id, { from: ['published'], to: 'paused', action: 'pause', actorId, reason: reason || 'manual_pause',
    patch: { unpublishedAt: new Date().toISOString(), unpublicationReason: reason || 'manual_pause' } });
}

async function withdraw(id, { actorId, reason } = {}) {
  // terminal: no se revive sin re-aprobación explícita
  return transition(id, { from: ['draft', 'approved', 'published', 'paused', 'expired'], to: 'withdrawn', action: 'withdraw', actorId, reason: reason || 'manual_withdraw',
    patch: { unpublishedAt: new Date().toISOString(), unpublicationReason: reason || 'manual_withdraw' } });
}

async function reject(id, { actorId, reason } = {}) {
  return transition(id, { from: ['draft', 'approved'], to: 'rejected', action: 'reject', actorId, reason: reason || 'manual_reject' });
}

// revalidate(id, { evaluationView, context }) → { publication, decision }
// Aplica revalidación continua. Si la oportunidad expiró/invalidó, pasa a 'expired' (auto, auditado).
// Si está OK, refresca la marca de validación. NUNCA revive estados terminales.
async function revalidatePublication(id, { evaluationView, context = {} } = {}) {
  const pub = await pubRepo.findById(id);
  if (!pub) throw err('publication_not_found');
  const decision = revalidate({
    status: pub.publication_status,
    published_evaluation_id: pub.evaluation_id,
    published_mapping_version: pub.published_mapping_version,
    published_rules_fingerprint: pub.published_rules_fingerprint,
    expires_at: pub.expires_at,
  }, evaluationView, context);

  // Si estaba publicada y la decisión la saca de juego → expirar (auto, auditado).
  if (pub.publication_status === 'published' && !decision.visible && decision.nextStatus === 'expired') {
    const updated = await transition(id, { from: ['published'], to: 'expired', action: 'expire', actorId: 'system',
      reason: 'revalidation:' + decision.reasons.join(','),
      patch: { unpublishedAt: new Date().toISOString(), unpublicationReason: 'revalidation_expired' },
      evaluationId: context.evaluationId, metadata: { reasons: decision.reasons } });
    return { publication: updated, decision };
  }
  // Si sigue válida, registrar la revalidación (no cambia estado).
  if (pub.publication_status === 'published' && decision.visible) {
    await histRepo.insert({ publicationId: id, previousStatus: 'published', newStatus: 'published', action: 'revalidate',
      actorId: 'system', reason: decision.staleValidation ? 'verifying' : 'still_valid', evaluationId: context.evaluationId,
      metadata: { displayStatus: decision.displayStatus } });
  }
  return { publication: pub, decision };
}

// detailDiff(publication, currentEvaluationView) → delta aprobado vs actual (sección 25)
function detailDiff(publication, currentEvaluationView) {
  const frozen = (publication && publication.public_payload) || null;
  if (!frozen || !currentEvaluationView) return null;
  const cur = currentEvaluationView.evaluation || {};
  const f = frozen.economics || {};
  const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const delta = (a, b) => { const x = num(a), y = num(b); return (x == null || y == null) ? null : +(y - x).toFixed(8); };
  return {
    net_roi: { approved: f.net_roi, current: cur.netRoi, delta: delta(f.net_roi, cur.netRoi) },
    classification: { approved: frozen.classification, current: currentEvaluationView.classification,
      changed: frozen.classification !== currentEvaluationView.classification },
    fees_total: { approved: f.fees_total, current: cur.feeTotal, delta: delta(f.fees_total, cur.feeTotal) },
    max_size: { approved: frozen.sizing && frozen.sizing.max_quantity,
      current: currentEvaluationView.maxSize && currentEvaluationView.maxSize.maxQuantity },
  };
}

module.exports = {
  createDraft, approve, publish, pause, withdraw, reject, revalidatePublication, detailDiff,
  // re-export repos para lectura desde la fachada/endpoints
  repo: pubRepo, history: histRepo, newPublicId,
};
