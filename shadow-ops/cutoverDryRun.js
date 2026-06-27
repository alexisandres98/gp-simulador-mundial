// shadow-ops/cutoverDryRun.js — Fase O.1 §16. Simula GP_OFFICIAL_MODEL=v2 SIN activarlo ni escribir nada.
// Verifica: contrato V2 completo, ausencia de hardcodes V1 bloqueantes, rollback disponible, público OFF.
'use strict';
const v2 = require('../context-engine/v2Evaluator');
const prom = require('../model-registry/promotion');
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

function dryRun() {
  // 1) contrato V2: evalúa un caso sintético y verifica los campos requeridos (§11/§16)
  const ev = v2.evaluate({ base1x2: { home: 0.5, draw: 0.27, away: 0.23 }, factors: [{ factor_code: 'X', category: 'team', home_logit_delta: 0.1, confidence: 0.8 }], contextUncertainty: 0.3, lambdas: { home: 1.5, away: 1.0 } });
  const required = ['model_family', 'model_version', 'base_probability_vector', 'context_adjustments', 'final_probability_vector', 'confidence', 'uncertainty', 'context_state', 'input_hash'];
  const missing = required.filter(k => ev[k] == null);
  const sums1 = Math.abs((ev.final_probability_vector.home + ev.final_probability_vector.draw + ev.final_probability_vector.away) - 1) < 1e-3; // vector redondeado a 4 decimales
  const contractOk = missing.length === 0 && sums1 && ev.model_family === 'GP_INTELLIGENCE_V2';

  // 2) hardcodes V1: el resolver es intercambiable (setGpResolver existe); el modelo oficial es parametrizable.
  const cfg = prom.officialModelConfig();
  const resolverSwappable = typeof require('../value-engine/scheduler').setGpResolver === 'function';
  const officialParam = ['v1', 'v2'].includes((process.env.GP_OFFICIAL_MODEL || 'v1').toLowerCase());

  // 3) rollback disponible + cutover bloqueado (doble seguro)
  const rollbackReady = cfg.v1_model_version === 'gp-core-1.4.0' && !bool(process.env.GP_ALLOW_CUTOVER, false);

  // 4) público OFF: ningún flag público activo
  const publicOff = !bool(process.env.VALUE_PUBLIC_ENABLED, false) && !bool(process.env.PICKS_PUBLIC_ENABLED, false);

  // 5) qué pasaría (simulado, SIN escribir): V2 sería el resolver oficial; mismas superficies, payload neutral.
  const wouldHappen = {
    simulator: 'mostraría probabilidad GP = V2', value_engine: 'clasificaría sobre V2', candidate_factory: 'STRONG desde V2',
    pick_conversion: 'congelaría snapshot V2 (sigue manual + gated)', registry_payload: 'model_version=' + ev.model_version + ', payload NEUTRAL',
    metrics: 'congelaría prob V2 publicada', i18n: 'render ES/EN desde códigos neutrales', rollback: 'GP_OFFICIAL_MODEL=v1 restaura V1 al instante',
  };
  return {
    simulated_flag: 'GP_OFFICIAL_MODEL=v2 (NO aplicado)',
    contract: { ok: contractOk, missing_fields: missing, final_sums_to_1: sums1, model_version: ev.model_version },
    hardcodes_removed: resolverSwappable && officialParam,
    rollback_ready: rollbackReady, public_off: publicOff,
    would_happen: wouldHappen,
    writes_performed: 0, official_candidates_created: 0, picks_created: 0, signals_created: 0,
    verdict: (contractOk && resolverSwappable && rollbackReady && publicOff) ? 'DRY_RUN_OK' : 'DRY_RUN_ISSUES',
    note: 'Simulación pura. No se cambió GP_OFFICIAL_MODEL ni se escribió nada oficial.',
  };
}
module.exports = { dryRun };
