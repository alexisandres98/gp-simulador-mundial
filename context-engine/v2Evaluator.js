// context-engine/v2Evaluator.js — Fase M.6 (shadow). Compone GP Intelligence V2 de extremo a extremo:
//   base 1X2 (V1 calibrada) → Context Engine (logit+softmax) → [Goal Engine] → [Knockout] → snapshot V2.
// PURO para el cómputo; la persistencia usa la data layer M.2 (append-only, idempotente). NO se cablea al
// pipeline oficial (Value/Candidate/Picks/Registry siguen 100% V1). Produce una probabilidad V2 REPRODUCIBLE
// (input_hash determinístico) que puede compararse con V1 en shadow/replay sin promover nada.
'use strict';
const crypto = require('crypto');
const contextEngine = require('./contextEngine');
const knockout = require('./knockout');
let goalEngine = null;
try { goalEngine = require('../goal-engine/distribution'); } catch { /* opcional */ }

const MODEL_FAMILY = 'GP_INTELLIGENCE_V2';

// evaluate(input) → estructura §11. input:
//  { canonicalEventId, base1x2:{home,draw,away}, factors:[...logit deltas...], contextUncertainty, missingCritical,
//    lambdas:{home,away}?, knockout:bool, etParams?, cutoffAt, modelVersion, calibrationVersion, contextPolicyVersion,
//    sourceCount?, missingCriticalInputs?, contextState? }
function evaluate(input = {}) {
  const ctx = contextEngine.applyContext({
    base: input.base1x2, factors: input.factors || [], contextUncertainty: input.contextUncertainty,
    missingCritical: input.missingCritical, state: input.contextState,
  });
  const out = {
    model_family: MODEL_FAMILY,
    model_version: input.modelVersion || 'gp-intelligence-v2-0.1.0',
    calibration_version: input.calibrationVersion || null,
    context_policy_version: input.contextPolicyVersion || 'context-policy-1',
    canonical_event_id: input.canonicalEventId || null,
    market_code: input.knockout ? 'QUALIFY' : '1X2',
    period_code: input.knockout ? 'FULL_MATCH' : 'REGULATION',
    base_probability_vector: ctx.base_vector,
    context_adjustments: ctx.context_adjustments,
    pre_uncertainty_vector: ctx.pre_uncertainty_vector,
    final_probability_vector: ctx.final_vector,           // 1X2 V2 (90')
    confidence: ctx.confidence,
    uncertainty: ctx.uncertainty,
    context_state: ctx.context_state,
    factor_count: ctx.factor_count,
    applied_factor_count: ctx.applied_factor_count,
    source_count: input.sourceCount || 0,
    missing_critical_inputs: input.missingCriticalInputs || [],
    cutoff_at: input.cutoffAt || null,
  };
  // Mercado de clasificación (eliminatoria): derivado del 1X2 reglamentario V2, mercado SEPARADO.
  if (input.knockout) out.qualify = knockout.qualifyProbabilities(ctx.final_vector, input.etParams || {});
  // Distribución de goles (si hay lambdas) — usa el Goal Engine; mercado de goles SEPARADO del 1X2.
  if (input.lambdas && goalEngine) {
    const g = goalEngine.goalModelOutput(input.lambdas.home, input.lambdas.away, { modelVersion: out.model_version });
    out.goals = { expected_total: g.expected_total_goals, over_under: g.over_under, btts: g.btts, top_scorelines: g.top_scorelines, uncertainty: g.uncertainty, markets: g.markets };
  }
  out.input_hash = inputHash(input, ctx);
  return out;
}

// hash determinístico de los inputs que definen la evaluación (mismo input → mismo snapshot, §11 idempotencia).
function inputHash(input, ctx) {
  const core = {
    event: input.canonicalEventId || null, base: ctx.base_vector, adj: ctx.context_adjustments,
    knockout: !!input.knockout, lambdas: input.lambdas || null, mv: input.modelVersion || 'gp-intelligence-v2-0.1.0',
    cpv: input.contextPolicyVersion || 'context-policy-1', cutoff: input.cutoffAt || null,
  };
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

// Persiste la evaluación V2 en la data layer M.2 (context_evaluation_runs + v2_probability_snapshots).
// Idempotente por input_hash. INERTE salvo que se invoque explícitamente (no hay scheduler cableado).
async function persist(evaluation, { repo } = {}) {
  const repository = repo || require('./repository');
  const run = await repository.recordEvaluationRun({
    canonical_event_id: evaluation.canonical_event_id, context_policy_version: evaluation.context_policy_version,
    cutoff_at: evaluation.cutoff_at, observation_count: evaluation.source_count, applied_factor_count: evaluation.applied_factor_count,
    context_state: evaluation.context_state, missing_critical_inputs: evaluation.missing_critical_inputs,
  });
  const snap = await repository.recordV2Snapshot({
    context_evaluation_run_id: run.run_id, canonical_event_id: evaluation.canonical_event_id,
    market_code: evaluation.market_code, period_code: evaluation.period_code, model_family: evaluation.model_family,
    model_version: evaluation.model_version, context_policy_version: evaluation.context_policy_version,
    calibration_version: evaluation.calibration_version, base_probability_vector: evaluation.base_probability_vector,
    context_adjustments: evaluation.context_adjustments, pre_uncertainty_vector: evaluation.pre_uncertainty_vector,
    final_probability_vector: evaluation.final_probability_vector, confidence: evaluation.confidence,
    uncertainty: evaluation.uncertainty, source_count: evaluation.source_count, factor_count: evaluation.factor_count,
    missing_critical_inputs: evaluation.missing_critical_inputs, context_state: evaluation.context_state,
    cutoff_at: evaluation.cutoff_at, input_hash: evaluation.input_hash,
  });
  return { run, snapshot: snap.row, idempotent: snap.idempotent };
}

module.exports = { MODEL_FAMILY, evaluate, inputHash, persist };
