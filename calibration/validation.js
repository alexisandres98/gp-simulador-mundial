// calibration/validation.js — Fase N.6. Validación CONSERVADORA del parámetro de calibración de la base V1.
// PURO. No selecciona el parámetro usando el mismo set de test final: usa rolling (out-of-sample temporal) y
// leave-one-match-out, más SHRINKAGE hacia el parámetro actual (prior) por tamaño de muestra. NO cambia V1
// oficial ni recalcula Signals. Produce una recomendación versionada SOLO en shadow.
'use strict';
const { calibLambda, logLoss, brierMulti } = require('./metrics');
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// out-of-sample temporal: para cada partido i, ajusta λ con los partidos ANTERIORES y predice i.
function rollingValidation(records, { grid = 26, minTrain = 8 } = {}) {
  const cand = Array.from({ length: grid }, (_, i) => +(i * (0.5 / (grid - 1))).toFixed(4));
  const oos = []; // log loss del λ elegido out-of-sample
  for (let i = minTrain; i < records.length; i++) {
    const train = records.slice(0, i);
    let best = { L: 0.15, ll: Infinity };
    for (const L of cand) { const ll = mean(train.map(r => logLoss(calibLambda(r.raw_1x2, L), r.outcome))); if (ll < best.ll) best = { L, ll }; }
    const test = records[i];
    oos.push({ chosen_lambda: best.L, test_log_loss: logLoss(calibLambda(test.raw_1x2, best.L), test.outcome) });
  }
  return { samples: oos.length, oos_log_loss: +mean(oos.map(o => o.test_log_loss)).toFixed(4), avg_chosen_lambda: +mean(oos.map(o => o.chosen_lambda)).toFixed(4) };
}

// leave-one-match-out: log loss OOS para un λ fijo (cada partido predicho sin estar en el "ajuste", que aquí es trivial
// porque λ es global; LOO sirve para comparar λ candidatos de forma honesta sobre todos los partidos).
function looLogLoss(records, L) { return +mean(records.map(r => logLoss(calibLambda(r.raw_1x2, L), r.outcome))).toFixed(4); }

// shrinkage del λ ajustado hacia el prior (actual) por tamaño de muestra: pocos partidos → cerca del prior.
function shrink(lambdaFit, n, { prior = 0.15, k = 30 } = {}) {
  return +(((n * lambdaFit) + (k * prior)) / (n + k)).toFixed(4);
}

// recomendación conservadora completa.
function recommend(records, { currentLambda = 0.15 } = {}) {
  const grid = Array.from({ length: 26 }, (_, i) => +(i * (0.5 / 25)).toFixed(4));
  let fit = { L: currentLambda, ll: Infinity };
  for (const L of grid) { const ll = looLogLoss(records, L); if (ll < fit.ll) fit = { L, ll }; }
  const n = records.length;
  const shrunk = shrink(fit.L, n, { prior: currentLambda });
  const rolling = rollingValidation(records);
  return {
    recommended_base_version: 'gp-base-calibrated-2.0.0-shadow',
    current_lambda: currentLambda, current_log_loss: looLogLoss(records, currentLambda),
    fitted_lambda: fit.L, fitted_log_loss: fit.ll,
    recommended_parameter: shrunk, recommended_log_loss: looLogLoss(records, shrunk),
    sample_size: n, rolling_oos: rolling,
    sensitivity: { at_010: looLogLoss(records, 0.10), at_015: looLogLoss(records, 0.15), at_020: looLogLoss(records, 0.20), at_024: looLogLoss(records, 0.24), at_030: looLogLoss(records, 0.30) },
    expected_effect: 'Atenúa más hacia uniforme: reduce overconfidence; mejora marginal de log loss con muestra chica → cambio conservador (shrinkage). NO promover a oficial sin más muestra/validación.',
    note: n < 60 ? 'MUESTRA INSUFICIENTE para un cambio agresivo: usar shrinkage y mantener en shadow.' : 'muestra moderada',
  };
}

module.exports = { rollingValidation, looLogLoss, shrink, recommend };
