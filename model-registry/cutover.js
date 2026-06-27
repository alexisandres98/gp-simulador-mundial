// model-registry/cutover.js — Fase P.0 §10/§11/§13. Prepara (NO ejecuta) el cutover V1→V2. Valida contrato V2 +
// readiness (sin FAIL) + dry-run + rollback, prepara el promotion record READY_FOR_APPROVAL y produce las dos
// recomendaciones SEPARADAS (V2 1X2 vs Goal Markets). La ejecución real es la Fase P (orden separada).
'use strict';
const dryRun = require('../shadow-ops/cutoverDryRun');
const readiness = require('../shadow-ops/cutoverReadiness');
const prom = require('./promotion');
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// recomendaciones separadas: V2 1X2 puede ir a GO aunque Goal Markets siga NO_GO.
function recommendFrom(matrix, dr, goalEvidence) {
  const byDim = Object.fromEntries(matrix.matrix.map(d => [d.dimension, d.status]));
  const hardFail = matrix.matrix.some(d => d.status === 'FAIL');
  // V2 1X2: depende de DATA/PIPELINE/RESULT/CONTEXT/MODEL/OBSERVABILITY/ROLLBACK + dry-run OK. CONDITIONAL permitido.
  const v2Core = ['DATA_READY', 'PIPELINE_READY', 'ROLLBACK_READY'].every(d => byDim[d] === 'PASS');
  let v2 = 'NO_GO';
  if (dr.verdict === 'DRY_RUN_OK' && v2Core && !hardFail) v2 = goalEvidence.v2_settled_sample >= 1 ? 'GO' : 'CONDITIONAL_GO';
  // Goal markets: requiere settled goal evidence + thresholds maduros + sin cluster ~51%. Hoy NO_GO.
  let goals = 'NO_GO';
  if (goalEvidence.goal_settled_sample >= 8 && goalEvidence.goal_calibrated) goals = 'CONDITIONAL_GO';
  return { V2_1X2_CUTOVER: v2, GOAL_MARKETS_PROMOTION: goals, hard_fail: hardFail };
}

async function prepare() {
  const dr = dryRun.dryRun();
  const matrix = await readiness.matrix();
  // evidencia liquidada (forward): cuántos settlements/metrics shadow V2 hay
  const db = require('../database/client');
  const n = async s => Number((await db.query(s).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  const goalEvidence = {
    v2_settled_sample: await n("SELECT count(*)::int n FROM shadow_metric_facts WHERE model_label='V2'"),
    goal_settled_sample: await n("SELECT count(*)::int n FROM shadow_metric_facts WHERE model_label='GOAL'"),
    goal_calibrated: false,
  };
  const recs = recommendFrom(matrix, dr, goalEvidence);
  // promotion record READY_FOR_APPROVAL (status 'proposed' = no ACTIVE; preparado, no aplicado)
  const promotion_record = {
    previous_model: 'v1', new_model: 'GP_INTELLIGENCE_V2', effective_from: null, approved_by: null, approved_at: null,
    status: 'READY_FOR_APPROVAL', rollback_model: 'v1', model_version: dr.contract.model_version,
    calibrated_base_version: 'gp-base-calibrated-2.0.0-shadow', context_policy_version: 'context-policy-1', goal_model_version: 'goal-engine-1.0.0',
  };
  return {
    dry_run: dr, readiness: matrix, forward_evidence: goalEvidence,
    recommendations: recs, promotion_record,
    execution: 'BLOQUEADA — Fase P. Requiere: superadmin + reason + doble confirmación + GP_ALLOW_CUTOVER=true + revalidación runtime (readiness sin FAIL + dry-run OK + modelo actual=v1) + evento de auditoría/rollback.',
  };
}

// executeCutover — STUB de Fase P (NO se invoca en P.0). Guard estricto; nunca corre sin GP_ALLOW_CUTOVER.
async function executeCutover({ superadmin, reason, confirmationPhrase } = {}) {
  if (!bool(process.env.GP_ALLOW_CUTOVER, false)) return { ok: false, reason: 'cutover_disabled' };
  if (!superadmin) return { ok: false, reason: 'superadmin_required' };
  if (!reason || String(reason).trim().length < 4) return { ok: false, reason: 'reason_required' };
  if (confirmationPhrase !== 'CUTOVER V1->V2') return { ok: false, reason: 'confirmation_required' };
  const dr = dryRun.dryRun(); if (dr.verdict !== 'DRY_RUN_OK') return { ok: false, reason: 'dry_run_failed' };
  const m = await readiness.matrix(); if (m.matrix.some(d => d.status === 'FAIL')) return { ok: false, reason: 'readiness_fail' };
  return { ok: false, reason: 'phase_p_only', note: 'La ejecución real del cutover es la Fase P, con orden explícita.' };
}

module.exports = { prepare, executeCutover, recommendFrom };
