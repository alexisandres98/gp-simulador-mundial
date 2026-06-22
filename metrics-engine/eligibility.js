// metrics-engine/eligibility.js — Sprint 6 §2. Qué señales entran a los agregados OFICIALES. Puro.
// Las excluidas NO se borran: siguen visibles con su razón de exclusión.
'use strict';

// metricEligibility(signal, settlement, closing, { verifiedEpoch }) →
//   { official, clv, experimental, exclusion_reasons[] }
//   official: elegible para métricas probabilísticas oficiales (Brier/log loss/calibración/accuracy).
//   clv: { eligible, reasons } — un closing faltante SOLO excluye CLV, no Brier.
function metricEligibility(signal, settlement = null, closing = null, { verifiedEpoch = null } = {}) {
  const reasons = [];
  const experimental = !!signal.experimental || signal.verification_status === 'experimental';

  // cohorte experimental (V2): nunca en oficial.
  if (experimental) reasons.push('experimental');
  if (signal.legacy || signal.verification_status === 'legacy_unverified') reasons.push('legacy_unverified');
  if (signal.verification_status === 'late') reasons.push('late');
  if (signal.verification_status === 'disputed') reasons.push('disputed');
  if (signal.score_eligible !== true) reasons.push('score_not_eligible');
  if (signal.verification_status !== 'verified') reasons.push('not_verified');

  // epoch
  if (verifiedEpoch && signal.published_at && new Date(signal.published_at).getTime() < new Date(verifiedEpoch).getTime()) reasons.push('before_verified_epoch');
  else if (!verifiedEpoch) reasons.push('verified_epoch_not_configured');

  // settlement final/válido para la métrica (provisional no cuenta para oficial)
  const st = settlement && settlement.settlement_status;
  if (!settlement) reasons.push('missing_settlement');
  else if (st === 'void' || st === 'cancelled') reasons.push('settlement_' + st);
  else if (st === 'pending' || st === 'provisional') reasons.push('settlement_not_final');
  else if (st === 'disputed') reasons.push('settlement_disputed');

  const official = reasons.length === 0;

  // CLV: requiere lo de oficial-de-precio (sin exigir prob settlement) + benchmark disponible.
  const clvReasons = reasons.filter(r => r !== 'missing_settlement'); // CLV puede medirse aun antes del resultado, con closing
  const benchAvailable = closing && closing.capture_status === 'captured';
  if (!benchAvailable) clvReasons.push('missing_benchmark');
  const clv = { eligible: clvReasons.length === 0, reasons: clvReasons };

  return { official, clv, experimental, exclusion_reasons: reasons };
}

module.exports = { metricEligibility };
