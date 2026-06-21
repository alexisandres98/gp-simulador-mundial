// arb-engine/fixtures/golden.js — golden EXECUTION dataset (Sprint 3). ≥10 por categoría.
// Condición crítica: 0 falsos Pure Arb materiales. Un caso dudoso se DEGRADA, no se aprueba.
'use strict';
const T0 = '2026-06-21T16:00:00.000Z'; // tiempo base de snapshots (mismo → skew 0)

// pata por defecto: matched, fresh, open, fee conocida, currency USD, direct ask
function leg(provider, side, asks, x = {}) {
  return {
    provider, side, asks,
    priceSource: x.priceSource || 'direct_ask',
    mappingStatus: x.mappingStatus || 'matched',
    outcomeMappingStatus: x.outcomeMappingStatus || 'matched',
    hardConflicts: x.hardConflicts || 0,
    rulesFingerprint: x.rulesFingerprint !== undefined ? x.rulesFingerprint : 'fp1',
    marketStatus: x.marketStatus || 'open',
    freshness: x.freshness || 'fresh',
    currency: x.currency || 'USD',
    payoutKnown: x.payoutKnown !== false,
    equivalenceScore: x.equivalenceScore != null ? x.equivalenceScore : 1,
    snapshotReceivedAt: x.snapshotReceivedAt || T0,
    snapshotId: x.snapshotId || (provider + '-' + side),
    isLive: x.isLive || false,
    externalMarketId: x.externalMarketId || (provider + '-mkt'),
    canonicalOutcomeId: x.canonicalOutcomeId || side,
    period: x.period || 'regulation_90m',
    tickSize: '0.01', minimumOrderSize: x.minimumOrderSize,
    feeOverride: x.feeOverride,
  };
}
function deep(price, size) { return [{ price, size }]; }
function binary(id, category, legs, expect, candX = {}) {
  return { id, category, expect, candidate: { strategy: 'binary', canonicalMarketId: id, mappingStatus: candX.mappingStatus || 'matched', mappingVersion: 'v1', rulesFingerprint: 'fp1', legs, ...candX } };
}

const cases = [];

// ---- 10 PURE ARB (binarios y 1x2 limpios, full depth, fee conocida) ----
const PURE = [['0.44', '0.50'], ['0.45', '0.50'], ['0.40', '0.55'], ['0.46', '0.49'], ['0.43', '0.52'], ['0.45', '0.49'], ['0.42', '0.53'], ['0.47', '0.48'], ['0.41', '0.54'], ['0.44', '0.51']];
PURE.forEach(([y, n], i) => cases.push(binary('PA_' + i, 'pure_arb', [leg('polymarket', 'yes', deep(y, '5000')), leg('polymarket', 'no', deep(n, '5000'))], 'pure_arb')));

// ---- 10 FEE-KILLED (gap bruto pequeño que las fees de Kalshi eliminan) → price_discrepancy ----
for (let i = 0; i < 10; i++) {
  const y = (0.49).toFixed(2), n = (0.50).toFixed(2); // suma 0.99 → gap bruto 0.01; fee Kalshi ~0.035 lo elimina
  cases.push(binary('FK_' + i, 'fee_killed', [leg('kalshi', 'yes', deep(y, '5000')), leg('kalshi', 'no', deep(n, '5000'))], 'price_discrepancy'));
}

// ---- 10 DEPTH/SLIPPAGE-KILLED (arb solo en 1 nivel diminuto) → execution_sensitive ----
for (let i = 0; i < 10; i++) {
  const yes = [{ price: '0.44', size: '1' }, { price: '0.60', size: '5000' }];
  const no = [{ price: '0.50', size: '1' }, { price: '0.60', size: '5000' }];
  cases.push(binary('DK_' + i, 'depth_killed', [leg('polymarket', 'yes', yes), leg('polymarket', 'no', no)], 'execution_sensitive'));
}

// ---- 10 CONDITIONAL (mapping conditional → nunca Pure Arb) ----
for (let i = 0; i < 10; i++) {
  cases.push(binary('CD_' + i, 'conditional', [leg('polymarket', 'yes', deep('0.44', '5000')), leg('polymarket', 'no', deep('0.50', '5000'))], 'conditional', { mappingStatus: 'conditional' }));
}

// ---- 10 PRICE DISCREPANCY (gap bruto pero no ejecutable: profundidad nula en una pata pero gap visible) ----
for (let i = 0; i < 10; i++) {
  // gap bruto (0.44+0.50<1) pero una pata no llena a ningún tamaño útil (depth 0.0001) → no fully fillable a min
  const yes = [{ price: '0.44', size: '0.5' }]; // por debajo de cualquier tamaño ejecutable razonable
  cases.push(binary('PD_' + i, 'price_discrepancy', [leg('polymarket', 'yes', yes, { minimumOrderSize: '5' }), leg('polymarket', 'no', deep('0.50', '5000'))], 'price_discrepancy'));
}

// ---- 10 REJECTED (motivos varios) ----
const reject = [
  ['RJ_mapping', leg('polymarket', 'yes', deep('0.44', '5000'), { mappingStatus: 'needs_review' }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_hardconf', leg('polymarket', 'yes', deep('0.44', '5000'), { hardConflicts: 1 }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_fee_unknown', leg('polymarket', 'yes', deep('0.44', '5000'), { feeOverride: { schedule: { status: 'unknown', version: 'x' } } }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_stale', leg('polymarket', 'yes', deep('0.44', '5000'), { freshness: 'stale' }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_closed', leg('polymarket', 'yes', deep('0.44', '5000'), { marketStatus: 'closed' }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_currency', leg('polymarket', 'yes', deep('0.44', '5000'), { currency: 'EUR' }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_no_rules', leg('polymarket', 'yes', deep('0.44', '5000'), { rulesFingerprint: null }), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_no_gap', leg('polymarket', 'yes', deep('0.55', '5000')), leg('polymarket', 'no', deep('0.55', '5000'))], // suma 1.10 → sin gap
  ['RJ_invalid_book', leg('polymarket', 'yes', [{ price: '0.44', size: '-5' }]), leg('polymarket', 'no', deep('0.50', '5000'))],
  ['RJ_equiv_low', leg('polymarket', 'yes', deep('0.44', '5000'), { equivalenceScore: 0.5 }), leg('polymarket', 'no', deep('0.50', '5000'))],
];
reject.forEach(([id, a, b]) => cases.push(binary(id, 'rejected', [a, b], 'rejected')));

// time skew (rechazo)
cases.push(binary('RJ_skew', 'rejected', [leg('polymarket', 'yes', deep('0.44', '5000'), { snapshotReceivedAt: '2026-06-21T16:00:00.000Z' }), leg('polymarket', 'no', deep('0.50', '5000'), { snapshotReceivedAt: '2026-06-21T16:00:10.000Z' })], 'rejected'));

module.exports = { cases, leg, deep, binary, T0 };
