// tests/arb-product.test.js — Fase R.4/R.5 §27 (UI/security). DTOs de arbitraje NEUTRALES: estado §12 correcto,
// sin secretos/identidades de independencia, copy sin "ganancia garantizada". Tests PUROS (mock rows).
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'gp-product', 'arbitrage'));
const d = require(path.join(__dirname, '..', 'i18n', 'dictionary'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// fila mock de arb_opportunities + arb_evaluations (champion, no contemporáneo → STALE)
function row(over = {}) {
  return Object.assign({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', canonical_event_id: null, classification: 'rejected', opp_classification: 'binary',
    status: 'rejected', net_roi: -0.0148, net_profit: -0.015, gross_margin: 0, capital_required: 1.01, confirmed_executable_size: 218034,
    confidence_label: 'low', rejection_reasons: ['no_price_gap'], warning_codes: [],
    semantic_ok: false, semantic_fatal: false, semantic_sub_reason: 'EVENT_MISMATCH', semantic_blockers: [{ code: 'EVENT_MISMATCH' }],
    temporal_ok: false, capacity_status: 'CONFIRMED', temporal_capacity: { temporal: { ok: false, reasons: ['CROSS_LEG_SPREAD_EXCEEDED'], evidence: { cross_leg_time_spread_ms: 101000 } }, capacity: { capacity_status: 'CONFIRMED', limiting_leg_index: 1 } },
    home_participant: null, away_participant: null, scheduled_start: null, last_seen_at: '2026-06-27T22:00:00Z',
  }, over);
}
const legs = [
  { leg_index: 0, side: 'no', best_price: '0.99', vwap: '0.99', quantity: '100', fee: '0', depth_consumed: 1, price_source: 'direct_ask', snapshot_age_ms: 5000, provider_code: 'polymarket', provider_name: 'Polymarket' },
  { leg_index: 1, side: 'yes', best_price: '0.02', vwap: '0.02', quantity: '50', fee: '0.01', depth_consumed: 1, price_source: 'derived_from_complement_bid', snapshot_age_ms: 106000, provider_code: 'kalshi', provider_name: 'Kalshi' },
];

console.log('\n== estado §12 + neutralidad ==');
const card = A.cardDto(row(), legs, () => null);
ok('champion no contemporáneo → STALE', card.state_code === 'STALE', card.state_code);
ok('executable=false (0 ejecutables honesto)', card.executable === false);
ok('venues públicos (Polymarket/Kalshi)', card.venues.includes('Polymarket') && card.venues.includes('Kalshi'));
const cardStr = JSON.stringify(card);
ok('sin identidades de independencia / snapshot ids', cardStr.indexOf('independence_group') === -1 && cardStr.indexOf('snapshot_id') === -1 && cardStr.indexOf('input_hash') === -1);

const det = A.detailDto(row(), legs, () => null);
ok('detalle: legs con casa/precio (venue público, no grupo)', det.legs.length === 2 && det.legs[0].venue === 'Polymarket');
ok('detalle: economics presente (net_margin/limiting_leg)', det.economics.net_margin != null && det.economics.limiting_leg_index === 1);
ok('detalle: settlement_compatibility expone blockers de código', Array.isArray(det.settlement_compatibility.blocker_codes));
ok('detalle: risk_codes incluye NOT_CONTEMPORANEOUS + EXECUTION_RISK', det.risk_codes.includes('NOT_CONTEMPORANEOUS') && det.risk_codes.includes('EXECUTION_RISK'));
const detStr = JSON.stringify(det);
ok('detalle sin secretos (no provider_id crudo/payload)', detStr.indexOf('"provider_id"') === -1 && detStr.indexOf('raw_metadata') === -1);

// estado EXECUTABLE sintetizado correctamente con gates en verde
const execRow = row({ classification: 'pure_arb', net_roi: 0.02, net_profit: 0.03, gross_margin: 0.05, semantic_ok: true, temporal_ok: true,
  temporal_capacity: { temporal: { ok: true, reasons: [] }, capacity: { capacity_status: 'CONFIRMED' } }, warning_codes: [] });
ok('gates en verde → EXECUTABLE', A.cardDto(execRow, legs, () => null).state_code === 'EXECUTABLE');

console.log('\n== copy §20: sin "ganancia garantizada/free money" ==');
const arbKeys = Object.keys(d.DICT.es).filter(k => k.startsWith('arb.'));
ok('keys de arbitraje presentes ES+EN', arbKeys.length >= 30 && arbKeys.every(k => d.DICT.en[k]));
// promesa = frase prohibida que NO está negada ("no es ganancia segura" / "not guaranteed profit" son disclaimers válidos).
const banned = /ganancia segura|ganancia garantizada|dinero gratis|free money|guaranteed (money|profit)|risk-free/i;
const negated = (s) => /\bno es\b|\bnot\b|\bsin\b|\bnunca\b/i.test(s);
const promises = (s) => banned.test(s) && !negated(s);
ok('ningún copy de arbitraje PROMETE ganancia segura (disclaimers negados OK)', !arbKeys.some(k => promises(d.DICT.es[k]) || promises(d.DICT.en[k])));
ok('usa "verificado según precios y capacidad observados"', /verificado seg/i.test(d.DICT.es['arb.verified']) && /verified against observed/i.test(d.DICT.en['arb.verified']));
ok('estados §12 traducidos ES+EN', ['EXECUTABLE','THEORETICAL_ONLY','PARTIAL_EXECUTION_RISK','BLOCKED','STALE','SUSPENDED'].every(s => d.DICT.es['arb.state.' + s] && d.DICT.en['arb.state.' + s]));

console.log(`\n${fail === 0 ? '✅' : '❌'} arb-product: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
