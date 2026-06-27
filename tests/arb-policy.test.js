// tests/arb-policy.test.js — Fase R.3 §12/§13. Policy versionada + síntesis del estado de la oportunidad.
// Una EXECUTABLE debe pasar TODOS los gates; ante duda → THEORETICAL_ONLY/PARTIAL/BLOCKED. Tests PUROS.
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'arb-engine', 'policy'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const pol = P.policy({});

// evaluación base EXECUTABLE (todos los gates en verde)
function ev(over = {}) {
  return Object.assign({
    classification: 'pure_arb',
    semantic: { ok: true, fatal: false, sub_reason: null, blockers: [] },
    temporal: { ok: true, reasons: [] },
    capacity: { capacity_status: 'CONFIRMED' },
    warnings: [],
    reasons: [],
    evaluation: { grossProfit: '0.05', netProfit: '0.03', netRoi: '0.02', feeStatus: 'known', fullyFillable: true, legs: [{ provider: 'a' }, { provider: 'b' }] },
  }, over);
}
const st = (o) => P.classifyOpportunity(o, pol).state;

console.log('\n== §12 estados ==');
ok('todos los gates verdes → EXECUTABLE', st(ev()) === 'EXECUTABLE', st(ev()));
ok('EXECUTABLE marca executable=true', P.classifyOpportunity(ev(), pol).executable === true);

ok('semantic.fatal → BLOCKED', st(ev({ semantic: { ok: false, fatal: true, sub_reason: 'SETTLEMENT_RULES_MISMATCH', blockers: [] } })) === 'BLOCKED');
ok('temporal EVENT_STARTED → EXPIRED', st(ev({ temporal: { ok: false, reasons: ['EVENT_STARTED'] } })) === 'EXPIRED');
ok('temporal LEG_SUSPENDED → SUSPENDED', st(ev({ temporal: { ok: false, reasons: ['LEG_SUSPENDED'] } })) === 'SUSPENDED');
ok('temporal CROSS_LEG_SPREAD → STALE', st(ev({ temporal: { ok: false, reasons: ['CROSS_LEG_SPREAD_EXCEEDED'] } })) === 'STALE');
ok('temporal DERIVED_LEG_STALE → STALE', st(ev({ temporal: { ok: false, reasons: ['DERIVED_LEG_STALE'] } })) === 'STALE');

ok('capacidad UNKNOWN → THEORETICAL_ONLY (no ejecutable garantizada)', st(ev({ capacity: { capacity_status: 'UNKNOWN' } })) === 'THEORETICAL_ONLY');
ok('capacidad CONSERVATIVE + warnings → PARTIAL_EXECUTION_RISK', st(ev({ capacity: { capacity_status: 'CONSERVATIVE' }, warnings: ['derived_ask'] })) === 'PARTIAL_EXECUTION_RISK');
ok('semántica ambigua (ok=false no fatal) → THEORETICAL_ONLY', st(ev({ semantic: { ok: false, fatal: false, sub_reason: 'AMBIGUOUS_RULES', blockers: [] } })) === 'THEORETICAL_ONLY');

ok('classification rejected → BLOCKED', st(ev({ classification: 'rejected', reasons: ['no_price_gap'] })) === 'BLOCKED');
ok('sin edge bruto → BLOCKED', st(ev({ evaluation: { grossProfit: '0', netProfit: '0', netRoi: '0', feeStatus: 'known', fullyFillable: true, legs: [{ provider: 'a' }, { provider: 'b' }] } })) === 'BLOCKED');

console.log('\n== §27 Arbitrage: márgenes/fees/capacidad ==');
ok('margen desaparece tras fees (net negativo) → no EXECUTABLE', st(ev({ evaluation: { grossProfit: '0.05', netProfit: '-0.01', netRoi: '-0.005', feeStatus: 'known', fullyFillable: true, legs: [{ provider: 'a' }, { provider: 'b' }] } })) !== 'EXECUTABLE');
ok('fees desconocidas → no EXECUTABLE', st(ev({ evaluation: { grossProfit: '0.05', netProfit: '0.03', netRoi: '0.02', feeStatus: 'unknown', fullyFillable: true, legs: [{ provider: 'a' }, { provider: 'b' }] } })) !== 'EXECUTABLE');
ok('una sola venue (no independientes) → no EXECUTABLE', st(ev({ evaluation: { grossProfit: '0.05', netProfit: '0.03', netRoi: '0.02', feeStatus: 'known', fullyFillable: true, legs: [{ provider: 'a' }, { provider: 'a' }] } })) !== 'EXECUTABLE');
ok('net ROI bajo el mínimo → no EXECUTABLE', st(ev({ evaluation: { grossProfit: '0.05', netProfit: '0.001', netRoi: '0.001', feeStatus: 'known', fullyFillable: true, legs: [{ provider: 'a' }, { provider: 'b' }] } })) !== 'EXECUTABLE');
ok('no fully fillable + capacidad CONFIRMED → PARTIAL', st(ev({ evaluation: { grossProfit: '0.05', netProfit: '0.03', netRoi: '0.02', feeStatus: 'known', fullyFillable: false, legs: [{ provider: 'a' }, { provider: 'b' }] } })) === 'PARTIAL_EXECUTION_RISK');

console.log('\n== gates + invariantes de policy ==');
const r = P.classifyOpportunity(ev(), pol);
ok('expone gates con nombre+ok', r.gates.length >= 6 && r.gates.every(g => 'name' in g && 'ok' in g));
ok('policy_version arbitrage-policy-1', r.policy_version === 'arbitrage-policy-1');
ok('INVARIANTE policy.autoExecution = false', pol.autoExecution === false);
ok('INVARIANTE policy.publicEnabled = false', pol.publicEnabled === false);
ok('thresholds versionados presentes', pol.minNetMargin != null && pol.minExecutableCapital != null && pol.minIndependentVenues === 2);
ok('estados §12 completos', ['BLOCKED','EXPIRED','SUSPENDED','STALE','DEGRADED','THEORETICAL_ONLY','PARTIAL_EXECUTION_RISK','EXECUTABLE','VALIDATING','DETECTED','SETTLED'].every(s => P.STATES.includes(s)));

console.log(`\n${fail === 0 ? '✅' : '❌'} arb-policy: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
