// metrics-engine/returns.js — Sprint 6 §17-18. Retornos. Honesto: sin precio/ejecución → unavailable.
'use strict';
const cfg = require('./config');

// forSignal(signal, settlement, opts) → bloque de retornos según el tipo de señal.
function forSignal(signal, settlement = null, opts = {}) {
  const type = signal.signal_type;
  if (type === 'arb_publication') {
    const pl = signal.signal_payload || {};
    return {
      realized_roi: null, // INVARIANTE: GP no ejecuta
      published_net_roi_estimate: pl.net_roi != null ? String(pl.net_roi) : null,
      last_valid_net_roi_estimate: pl.net_roi != null ? String(pl.net_roi) : null,
      structural_settlement: settlement ? (settlement.result_type || 'theoretical_structure_settled') : 'not_executed',
      note: 'No representa una operación ejecutada por GP.',
    };
  }
  if (type === 'model_prediction_v1') {
    // solo probabilidades, sin precio/selección/stake → ROI no calculable
    return { roi: 'unavailable', reason: 'prediction_without_price' };
  }
  if (type === 'price_signal') {
    if (!cfg.flags.simulatedReturnsEnabled) return { roi: 'unavailable', reason: 'simulated_returns_disabled' };
    // soporte preparado; requiere selección+precio+dirección+stake+settlement+fees → si falta algo, unavailable
    const pl = signal.signal_payload || {};
    if (pl.entry_price == null || !settlement || settlement.settlement_status !== 'final') return { roi: 'unavailable', reason: 'missing_inputs' };
    // (Política completa de stake en Sprint 7; aquí solo el contrato.)
    return { roi: 'unavailable', reason: 'stake_policy_pending', label: 'SIMULADO' };
  }
  return { roi: 'unavailable', reason: 'unsupported_type' };
}

module.exports = { forSignal };
