// signal-registry/schemas.js — Sprint 5 §11. Validación de payload por signal_type. Puro, sin deps.
'use strict';
const cfg = require('./config');

const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
function probOk(p) { const x = num(p); return x !== null && x >= 0 && x <= 1; }

// validate(signalType, payload) → { ok, errors[], schemaVersion }
function validate(signalType, payload = {}) {
  const errors = [];
  const schemaVersion = cfg.SCHEMA_VERSIONS[signalType] || null;

  if (signalType === 'model_prediction_v1') {
    // model_version se valida a nivel señal (eligibility), no en el payload.
    const probs = payload.probabilities || {};
    // 1X2: home+draw+away ≈ 1
    if (payload.market_type === '1x2' || ('home' in probs && 'draw' in probs && 'away' in probs)) {
      for (const k of ['home', 'draw', 'away']) if (!probOk(probs[k])) errors.push('invalid_probability:' + k);
      const sum = (num(probs.home) || 0) + (num(probs.draw) || 0) + (num(probs.away) || 0);
      if (Math.abs(sum - 1) > 0.01) errors.push('probabilities_do_not_sum_to_1:' + sum.toFixed(4));
    } else {
      // mercado binario u otro: cada probabilidad listada debe ser válida
      for (const [k, v] of Object.entries(probs)) if (!probOk(v)) errors.push('invalid_probability:' + k);
      if (!Object.keys(probs).length) errors.push('probabilities_required');
    }
  } else if (signalType === 'arb_publication') {
    for (const f of ['arb_publication_id', 'arb_evaluation_id', 'classification', 'net_roi']) {
      if (payload[f] == null) errors.push('field_required:' + f);
    }
    if (!Array.isArray(payload.legs) || payload.legs.length < 2) errors.push('legs_required');
    // realized_roi NUNCA debe venir poblado en publicación (GP no ejecuta)
    if (payload.realized_roi != null) errors.push('realized_roi_must_be_null');
  } else if (signalType === 'gp_intelligence_experiment') {
    if (payload.model_analysis_run_id == null) errors.push('field_required:model_analysis_run_id');
    // se fuerza experimental + no elegible aguas arriba (eligibility); aquí solo validamos forma
    if (payload.control_output == null || payload.challenger_output == null) errors.push('control_and_challenger_required');
  } else if (cfg.SIGNAL_TYPES.includes(signalType)) {
    // contratos futuros: aceptados como forma pero sin motor (no se construyen en Sprint 5)
    errors.push('signal_type_not_implemented_yet:' + signalType);
  } else {
    errors.push('unknown_signal_type:' + signalType);
  }

  return { ok: errors.length === 0, errors, schemaVersion };
}

module.exports = { validate };
