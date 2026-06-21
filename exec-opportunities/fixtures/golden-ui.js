// exec-opportunities/fixtures/golden-ui.js — Sprint 4 §41. Golden UI dataset (10 casos).
// No depende de APIs reales ni de DB. Cada caso se evalúa con el MOTOR real (evaluateCandidate) para que
// la capa de producto se pruebe contra evaluaciones realistas.
'use strict';

const engine = require('../../arb-engine');
const { leg, deep } = require('../../arb-engine/fixtures/golden');

const NOW = Date.parse('2026-06-21T16:00:01.000Z'); // 1s después de T0 → fresh, skew 0

// candidato binario cross/same venue
function bin(id, legs, candX = {}) {
  return { strategy: 'binary', canonicalEventId: candX.canonicalEventId || null, canonicalMarketId: id,
    mappingStatus: candX.mappingStatus || 'matched', mappingVersion: candX.mappingVersion || 'v1',
    rulesFingerprint: candX.rulesFingerprint !== undefined ? candX.rulesFingerprint : 'fp1', legs };
}
function tri(id, legs, candX = {}) {
  return { strategy: '1x2', canonicalMarketId: id, mappingStatus: candX.mappingStatus || 'matched',
    mappingVersion: 'v1', rulesFingerprint: 'fp1', legs };
}

// contexto base de producto para una oportunidad publicable
function ctx(x = {}) {
  return {
    event: x.event || 'España vs. Uruguay',
    market: x.market || 'Ganador del partido — 90 minutos',
    mappingStatus: x.mappingStatus || 'matched',
    outcomeMappingStatus: x.outcomeMappingStatus || 'matched',
    hardConflicts: x.hardConflicts || 0,
    marketStatus: x.marketStatus || 'open',
    freshness: x.freshness || 'fresh',
    evaluationAgeMs: x.evaluationAgeMs != null ? x.evaluationAgeMs : 2000,
    detectedAt: x.detectedAt || '2026-06-21T15:59:53.000Z',
    lastValidatedAt: x.lastValidatedAt || '2026-06-21T16:00:00.000Z',
    deepLinksValid: x.deepLinksValid !== false,
    jurisdictionMetadataAvailable: x.jurisdictionMetadataAvailable !== false,
    currentMappingVersion: x.currentMappingVersion || 'v1',
    currentRulesFingerprint: x.currentRulesFingerprint || 'fp1',
    country: x.country || null,
    now: NOW,
    legMeta: x.legMeta || [],
    evaluationId: x.evaluationId || null,
  };
}

// arma cada caso: evalúa el candidato y adjunta contexto + expectativa.
function build() {
  const C = [];
  const push = (id, label, candidate, context, expect, evalOpts = {}) => {
    const ev = engine.evaluateCandidate(candidate, { now: NOW, ...evalOpts });
    // exponer mappingStatus para presentation (que lo lee de ctx; aquí lo dejamos disponible también)
    ev.mappingStatusForDisplay = context.mappingStatus;
    C.push({ id, label, candidate, ev, context, expect });
  };

  // 1) PURE ARB PROFUNDO
  push('UI_pure_deep', 'Pure arb profundo',
    bin('UI_pure_deep', [leg('polymarket', 'yes', deep('0.44', '5000')), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx({ legMeta: [{ provider: 'polymarket', outcomeName: 'España (Sí)' }, { provider: 'kalshi', outcomeName: 'Uruguay/No' }] }),
    { classification: 'pure_arb', eligible: true });

  // 2) PURE ARB PEQUEÑO (cerca del mínimo de capital de publicación)
  push('UI_pure_small', 'Pure arb pequeño',
    bin('UI_pure_small', [leg('polymarket', 'yes', deep('0.45', '70')), leg('kalshi', 'no', deep('0.50', '70'))]),
    ctx(), { classification: 'pure_arb', eligible: true });

  // 3) EXECUTION-SENSITIVE (profundidad y capital suficientes, pero volatilidad alta → sensible a ejecución)
  push('UI_exec_sensitive', 'Execution-sensitive',
    bin('UI_exec_sensitive', [leg('polymarket', 'yes', deep('0.44', '5000')), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx(), { classification: 'execution_sensitive', eligibleWithOptIn: true, eligibleDefault: false },
    { volatility: { label: 'high' } });

  // 4) EXPIRED (evaluación demasiado vieja para publicar)
  push('UI_expired', 'Expired',
    bin('UI_expired', [leg('polymarket', 'yes', deep('0.44', '5000')), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx({ evaluationAgeMs: 600000 }), { classification: 'pure_arb', eligible: false, reason: 'evaluation_too_old' });

  // 5) STALE (snapshot stale → el motor lo rechaza; nunca publicable)
  push('UI_stale', 'Stale',
    bin('UI_stale', [leg('polymarket', 'yes', deep('0.44', '5000'), { freshness: 'stale' }), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx({ freshness: 'stale' }), { classification: 'rejected', eligible: false });

  // 6) RULES CHANGED (drift de rules fingerprint → revalidación invalida)
  push('UI_rules_changed', 'Rules changed',
    bin('UI_rules_changed', [leg('polymarket', 'yes', deep('0.44', '5000')), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx({ currentRulesFingerprint: 'fp2' }), { classification: 'pure_arb', eligible: true, revalidation: 'expired' });

  // 7) JURISDICTION RESTRICTED (cross-venue; país con una plataforma restringida)
  push('UI_juris_restricted', 'Jurisdiction restricted',
    bin('UI_juris_restricted', [leg('polymarket', 'yes', deep('0.44', '5000')), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx({ country: 'US', legMeta: [{ provider: 'polymarket' }, { provider: 'kalshi' }] }),
    { classification: 'pure_arb', eligible: true, jurisdiction: 'restricted', country: 'US' });

  // 8) DERIVED ASK (precio derivado del complemento → warning → execution_sensitive)
  push('UI_derived_ask', 'Derived ask',
    bin('UI_derived_ask', [
      leg('polymarket', 'yes', deep('0.44', '5000')),
      leg('kalshi', 'no', deep('0.50', '5000'), { priceSource: 'derived_from_complement_bid' })]),
    ctx(), { classification: 'execution_sensitive', eligibleWithOptIn: true, eligibleDefault: false });

  // 9) 1X2 (tres patas home/draw/away)
  push('UI_1x2', '1X2',
    tri('UI_1x2', [
      leg('polymarket', 'home', deep('0.30', '5000'), { canonicalOutcomeId: 'home' }),
      leg('kalshi', 'draw', deep('0.30', '5000'), { canonicalOutcomeId: 'draw' }),
      leg('polymarket', 'away', deep('0.30', '5000'), { canonicalOutcomeId: 'away' })]),
    ctx({ market: 'Ganador del partido (1X2)', legMeta: [{ provider: 'polymarket', outcomeName: 'España' }, { provider: 'kalshi', outcomeName: 'Empate' }, { provider: 'polymarket', outcomeName: 'Uruguay' }] }),
    { classification: 'pure_arb', eligible: true });

  // 10) FEE-HEAVY (Kalshi en ambas patas: fees grandes pero neto positivo, ROI cerca del mínimo)
  push('UI_fee_heavy', 'Fee-heavy',
    bin('UI_fee_heavy', [leg('kalshi', 'yes', deep('0.45', '5000')), leg('kalshi', 'no', deep('0.50', '5000'))]),
    ctx({ event: 'Brasil vs. Catar', legMeta: [{ provider: 'kalshi', outcomeName: 'Brasil (Sí)' }, { provider: 'kalshi', outcomeName: 'No' }] }),
    { feeHeavy: true });

  return C;
}

module.exports = { build, NOW };
