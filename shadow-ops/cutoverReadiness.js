// shadow-ops/cutoverReadiness.js — Fase N.1 (N.14). Matriz binaria de readiness por dimensión.
// READ-ONLY. NO recomienda ni ejecuta cutover; calcula PASS/CONDITIONAL/FAIL + evidencia + blockers desde el
// estado real de prod. El cutover sigue prohibido (espera GO de ChatGPT).
'use strict';
const db = require('../database/client');
const n = async s => Number((await db.query(s)).rows[0].n);

async function matrix() {
  const ctxObs = await n("SELECT count(*)::int n FROM context_observations");
  const v2snap = await n("SELECT count(*)::int n FROM v2_probability_snapshots");
  const goalSnap = await n("SELECT count(*)::int n FROM goal_model_snapshots");
  const goalQuotes = await n("SELECT count(*)::int n FROM sportsbook_goal_quote_current");
  const goalValue = await n("SELECT count(*)::int n FROM goal_value_shadow");
  const srcPublished = await n("SELECT count(*)::int n FROM context_observations WHERE timestamp_quality='SOURCE_PUBLISHED'");
  const unknownApplied = await n("SELECT count(*)::int n FROM context_observations WHERE timestamp_quality='UNKNOWN' AND applied_impact<>0");
  const shadowSettlements = await n("SELECT count(*)::int n FROM shadow_settlements").catch(() => 0);
  const shadowMetrics = await n("SELECT count(*)::int n FROM shadow_metric_facts").catch(() => 0);
  const jobRuns = await n("SELECT count(*)::int n FROM shadow_job_runs").catch(() => 0);
  const sources = await n("SELECT count(*)::int n FROM context_source_catalog WHERE enabled=true").catch(() => 0);
  const documents = await n("SELECT count(*)::int n FROM context_source_documents").catch(() => 0);
  const claims = await n("SELECT count(*)::int n FROM context_claims").catch(() => 0);
  const weather = await n("SELECT count(*)::int n FROM weather_snapshots").catch(() => 0);
  const settlements = await n("SELECT count(*)::int n FROM shadow_settlements").catch(() => 0);
  const sig = await n("SELECT count(*)::int n FROM signals");
  const picks = await n("SELECT count(*)::int n FROM internal_picks");

  const dim = (name, status, evidence, blockers, risk, remediation) => ({ dimension: name, status, evidence, blockers, risk, owner: 'GP/Alexis + ChatGPT', remediation });
  const dims = [
    dim('DATA_READY', (ctxObs > 0 && v2snap > 0 && goalSnap > 0 && goalQuotes > 0) ? 'PASS' : 'FAIL',
      { context_observations: ctxObs, v2_snapshots: v2snap, goal_snapshots: goalSnap, goal_quotes: goalQuotes }, [], 'bajo', 'n/a'),
    dim('CONTEXT_READY', srcPublished > 0 ? 'PASS' : 'CONDITIONAL',
      { source_published_obs: srcPublished, total_obs: ctxObs, all_ingestion_observed: srcPublished === 0 },
      srcPublished === 0 ? ['sin timestamps SOURCE_PUBLISHED reales (todo INGESTION_OBSERVED forward-only)'] : [],
      'medio', 'integrar fuente de contexto con published_at real (prensa/feeds con timestamp)'),
    dim('MODEL_READY', 'CONDITIONAL',
      { calibration_validated: true, sample_size: 41, recommended_lambda: 0.20, draw_bias: true },
      ['muestra <60 para recalibración agresiva', 'sesgo de empates/BTTS sin corregir oficialmente'],
      'medio', 'acumular muestra + recalibrar base + corregir sesgo empate/BTTS'),
    dim('PIPELINE_READY', (v2snap > 0 && goalValue > 0) ? 'PASS' : 'CONDITIONAL',
      { v2_snapshots: v2snap, goal_value_shadow: goalValue, scheduler_job_runs: jobRuns },
      jobRuns === 0 ? ['scheduler continuo aún sin corridas registradas'] : [],
      'medio', 'habilitar GP_V2_SHADOW_ENABLED y observar ciclos'),
    dim('GOAL_READY', goalValue > 0 ? 'CONDITIONAL' : 'FAIL',
      { goal_value_evals: goalValue, policy: 'goal-value-policy-shadow-1', thresholds: 'provisionales' },
      ['thresholds provisionales con muestra mínima', 'overdispersion (var real>predicha) a evaluar'],
      'medio', 'evaluar NB vs Poisson+DC + acumular muestra antes de promover thresholds'),
    dim('COLLECTOR_READY', (sources > 0 && (weather > 0 || documents > 0)) ? 'CONDITIONAL' : 'FAIL',
      { enabled_sources: sources, documents, claims, weather_snapshots: weather, security: 'ssrf+allowlist+sanitize' },
      sources === 0 ? ['catálogo de fuentes sin habilitar'] : ['news/RSS allowlist por curar (weather activo)'],
      'medio', 'curar allowlist de fuentes Tier1/Tier2 + observar fetches'),
    dim('RESULT_READY', settlements > 0 ? 'PASS' : 'CONDITIONAL',
      { result_resolver_wired: true, shadow_settlements: settlements, source: 'ESPN regulation' },
      settlements === 0 ? ['sin eventos eliminatorios finalizados aún (kickoffs futuros)'] : [],
      'bajo', 'esperar finalización de eliminatorias (settlement automático)'),
    dim('ROLLBACK_READY', 'PASS',
      { promotion_machinery: true, kill_switch: true, rollback_tested: true, GP_ALLOW_CUTOVER: false },
      [], 'bajo', 'n/a'),
    dim('OBSERVABILITY_READY', jobRuns >= 0 ? 'CONDITIONAL' : 'FAIL',
      { shadow_job_runs_table: true, admin_endpoint: true, admin_ui_es_en: 'parcial' },
      ['Admin Observatory UI ES/EN mínima (endpoint listo; card en progreso)'],
      'bajo', 'completar UI ES/EN del observatorio'),
  ];
  // gate global: cutover NO recomendado salvo que todas PASS y haya settled evidence + no UNKNOWN aplicado
  const allPass = dims.every(d => d.status === 'PASS');
  const noLeakage = unknownApplied === 0;
  const settledEvidence = shadowSettlements > 0 && shadowMetrics > 0;
  const recommendation = (allPass && noLeakage && settledEvidence) ? 'CONSIDER_CUTOVER' : 'NO_GO';
  return {
    matrix: dims, recommendation,
    gates: { all_dimensions_pass: allPass, no_unknown_applied: noLeakage, settled_evidence: settledEvidence,
      v1_official_intact: sig === 2 && picks === 2 },
    invariants: { signals: sig, internal_picks: picks },
    note: 'Cutover PROHIBIDO en esta fase. La recomendación es informativa para el GO/NO-GO de ChatGPT.',
  };
}

// cutover package §22: propuesta de promoción versionada (NO activa nada).
async function cutoverPackage() {
  const m = await matrix();
  return {
    proposal: {
      official_model_version: 'gp-intelligence-v2-0.1.0',
      calibrated_base_version: 'gp-base-calibrated-2.0.0-shadow (λ≈0.20, shrinkage)',
      context_policy_version: 'context-policy-1',
      goal_model_version: 'goal-engine-1.0.0 (poisson_dc; NB en evaluación)',
      effective_from_proposed: null,
      rollback_version: 'gp-core-1.4.0 (V1)',
      kill_switches: ['GP_V2_KILL_SWITCH', 'GP_ALLOW_CUTOVER', 'GP_V2_SHADOW_ENABLED', 'context_source_catalog.kill_switch'],
      known_limitations: ['muestra <60 para recalibración', 'goal totals clusterizan ~51% (poca separación)', 'contexto INGESTION_OBSERVED sin published_at real', 'evidencia V2 forward pendiente de eliminatorias finalizadas'],
    },
    readiness: m.matrix, recommendation: m.recommendation, gates: m.gates,
    activation: 'BLOQUEADA — requiere GO explícito de ChatGPT + GP_ALLOW_CUTOVER=true.',
  };
}
module.exports = { matrix, cutoverPackage };
