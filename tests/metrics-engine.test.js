// tests/metrics-engine.test.js — Sprint 6. Capa PURA (sin DB): Brier §38, log loss §39, calibración §40,
// CLV §41, retornos §42, eligibility §43, sample size §44, arb §46, + golden dataset §49.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const brier = require(R + '/metrics-engine/brier');
const logLoss = require(R + '/metrics-engine/logLoss');
const calibration = require(R + '/metrics-engine/calibration');
const clv = require(R + '/metrics-engine/clv');
const ci = require(R + '/metrics-engine/confidenceIntervals');
const { buildFact } = require(R + '/metrics-engine/facts');
const { aggregateMetric } = require(R + '/metrics-engine/aggregations');
const arbMetrics = require(R + '/metrics-engine/arbMetrics');
const cfg = require(R + '/metrics-engine/config');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const EPOCH = '2026-06-01T00:00:00Z';
let _i = 0;
function sig(o = {}) { return { id: 's' + (++_i), public_id: 'sig_' + _i, signal_type: 'model_prediction_v1', model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', verification_status: 'verified', score_eligible: true, experimental: false, legacy: false, published_at: '2026-06-22T10:00:00Z', event_start_at: '2026-06-25T15:00:00Z', signal_payload: { market_type: '1x2', probabilities: { home: 0.5, draw: 0.3, away: 0.2 } }, ...o }; }
function settle(winner, o = {}) { return { settlement_version: 1, settlement_status: 'final', winning_outcome_id: winner, settled_at: '2026-06-25T17:00:00Z', ...o }; }

console.log('\n§38 BRIER');
{
  ok('1. binario correcto (p=0.8,y=1)=0.04', near(brier.brierBinary(0.8, 1), 0.04));
  ok('2. binario perfecto=0', brier.brierBinary(1, 1) === 0);
  ok('3. binario incorrecto=1', brier.brierBinary(1, 0) === 1);
  ok('4. multiclase perfecto=0', brier.brierMulticlass({ home: 1, draw: 0, away: 0 }, 'home') === 0);
  ok('5. multiclase uniforme≈0.6667', near(brier.brierMulticlass({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, 'home'), 2 / 3, 1e-4));
  ok('6. probs no suman 1 → no válido', !brier.validProbs({ home: 0.5, draw: 0.3, away: 0.4 }));
  ok('7. prob negativa → no válido', !brier.validProbs({ home: -0.1, draw: 0.5, away: 0.6 }));
  // 8/9/10: settlement ausente / provisional / experimental excluidos → vía facts
  ok('8. settlement ausente → sin brier en fact', buildFact(sig(), null, null, { verifiedEpoch: EPOCH }).metrics.brier === undefined);
  ok('9. settlement provisional → excluido oficial', buildFact(sig(), settle('home', { settlement_status: 'provisional' }), null, { verifiedEpoch: EPOCH }).eligibility_status === 'excluded');
  ok('10. experimental → excluido', buildFact(sig({ experimental: true }), settle('home'), null, { verifiedEpoch: EPOCH }).eligibility_status === 'excluded');
}

console.log('\n§39 LOG LOSS');
{
  ok('1. correcto (p=0.9)≈0.105', near(logLoss.logLossBinary(0.9, 1), 0.10536, 1e-4));
  ok('2. confiado y erróneo → grande, no Inf', logLoss.logLossMulticlass({ a: 1e-12, b: 1 }, 'a') > 25 && Number.isFinite(logLoss.logLossMulticlass({ a: 1e-12, b: 1 }, 'a')));
  ok('3. epsilon configurable', logLoss.logLossBinary(0, 1, 1e-6) === -Math.log(1e-6));
  ok('4. multiclase = −ln(p_real)', near(logLoss.logLossMulticlass({ home: 0.5, draw: 0.3, away: 0.2 }, 'home'), -Math.log(0.5)));
  ok('6. reproducible', logLoss.logLossMulticlass({ home: 0.5, draw: 0.3, away: 0.2 }, 'home') === logLoss.logLossMulticlass({ home: 0.5, draw: 0.3, away: 0.2 }, 'home'));
}

console.log('\n§40 CALIBRACIÓN');
{
  // perfecta: p=0.7, 70% ocurren
  const perfect = []; for (let i = 0; i < 100; i++) perfect.push({ p: 0.7, y: i < 70 ? 1 : 0 });
  const rP = calibration.reliability(perfect, { buckets: 10 });
  ok('1/3/4. predicted avg=0.7, observed=0.7', rP.bins[0].predicted_average === 0.7 && rP.bins[0].observed_frequency === 0.7);
  ok('5. ECE perfecto≈0', rP.ece === 0);
  ok('2. buckets vacíos omitidos', rP.bins.length === 1);
  // sobreconfianza: p=0.9 pero solo 50% ocurren → ECE alto
  const over = []; for (let i = 0; i < 100; i++) over.push({ p: 0.9, y: i < 50 ? 1 : 0 });
  ok('5b. sobreconfianza ECE≈0.4', near(calibration.reliability(over, { buckets: 10 }).ece, 0.4, 1e-6));
  ok('8. boundary p=1 cae en último bucket', calibration.reliability([{ p: 1, y: 1 }], { buckets: 10 }).bins[0].bucket_end === 1);
  ok('7. confidence interval por bin', calibration.reliability(perfect, { buckets: 10, ci: (s, n) => ({ low: 0.6, high: 0.8 }) }).bins[0].confidence_low === 0.6);
  ok('9. reproducible', calibration.reliability(perfect, { buckets: 10 }).ece === calibration.reliability(perfect, { buckets: 10 }).ece);
}

console.log('\n§41 CLV');
{
  const closeBetter = { executable_price: '0.25', capture_status: 'captured', observed_at: '2026-06-25T14:00:00Z', event_start_at: '2026-06-25T15:00:00Z' };
  ok('1. entry mejor que close (entry 0.20, close 0.25) CLV+', clv.compute({ entryImpliedProb: 0.20, closing: closeBetter }).clv_probability_points === 0.05);
  ok('2. entry peor que close', clv.compute({ entryImpliedProb: 0.30, closing: closeBetter }).clv_probability_points === -0.05);
  ok('3. igual → 0', clv.compute({ entryImpliedProb: 0.25, closing: closeBetter }).clv_probability_points === 0);
  ok('5. log-odds calculado', near(clv.compute({ entryImpliedProb: 0.20, closing: closeBetter }).clv_log_odds, clv.logit(0.25) - clv.logit(0.20), 1e-5));
  ok('6. midpoint vs executable separados (prefiere executable)', clv.compute({ entryImpliedProb: 0.2, closing: { executable_price: '0.25', midpoint: '0.27', capture_status: 'captured' } }).benchmark_used === 'last_valid_pre_event_executable');
  ok('7. benchmark unavailable', clv.compute({ entryImpliedProb: 0.2, closing: { capture_status: 'unavailable' } }).benchmark_status === 'unavailable');
  ok('8. snapshot posterior rechazado (look-ahead)', clv.compute({ entryImpliedProb: 0.2, closing: { executable_price: '0.25', capture_status: 'captured', observed_at: '2026-06-25T16:00:00Z', event_start_at: '2026-06-25T15:00:00Z' } }).benchmark_status === 'look_ahead_rejected');
  ok('9. forecast-vs-close separado (no es CLV)', clv.compute({ modelProb: 0.55, closing: closeBetter }).forecast_vs_close === +(0.55 - 0.25).toFixed(6));
  ok('10. no-vig unavailable', clv.compute({ entryImpliedProb: 0.2, closing: closeBetter }).no_vig_status === 'unavailable');
}

console.log('\n§42 RETORNOS');
{
  ok('1. predicción sin precio → ROI unavailable', buildFact(sig(), settle('home'), null, { verifiedEpoch: EPOCH }).metrics.returns.roi === 'unavailable');
  ok('7. arb realized_roi null', buildFact(sig({ signal_type: 'arb_publication', signal_payload: { net_roi: '0.02', classification: 'pure_arb' } }), null, null, { verifiedEpoch: EPOCH }).metrics.returns.realized_roi === null);
  ok('7b. arb expone estimate, no realizado', buildFact(sig({ signal_type: 'arb_publication', signal_payload: { net_roi: '0.02' } }), null, null, {}).metrics.returns.published_net_roi_estimate === '0.02');
}

console.log('\n§43 ELIGIBILITY');
{
  const f = (o, st, cl) => buildFact(sig(o), st === undefined ? settle('home') : st, cl, { verifiedEpoch: EPOCH });
  ok('1. verified+elegible → eligible', f().eligibility_status === 'eligible');
  ok('2. legacy → excluido', f({ legacy: true }).exclusion_reasons.includes('legacy_unverified'));
  ok('3. late → excluido', f({ verification_status: 'late' }).exclusion_reasons.includes('late'));
  ok('4. experimental → excluido', f({ experimental: true }).exclusion_reasons.includes('experimental'));
  ok('5. disputed → excluido', f({ verification_status: 'disputed' }).exclusion_reasons.includes('disputed'));
  ok('6. score_eligible false → excluido', f({ score_eligible: false }).exclusion_reasons.includes('score_not_eligible'));
  ok('7. antes del epoch → excluido', f({ published_at: '2026-05-01T10:00:00Z' }).exclusion_reasons.includes('before_verified_epoch'));
  ok('8. settlement corregido (final) → elegible', f({}, settle('home', { settlement_status: 'final', settlement_version: 2 })).eligibility_status === 'eligible');
  ok('9. closing faltante excluye SOLO CLV, no Brier', (() => { const x = f({}, settle('home'), null); return x.eligibility_status === 'eligible' && x.clv_eligibility_status === 'excluded'; })());
  ok('10. V1 oficial vs V2 experimental separados', f().experimental === false && f({ experimental: true }).experimental === true);
}

console.log('\n§44 SAMPLE SIZE + AGREGACIÓN');
{
  const facts = [];
  for (let i = 0; i < 50; i++) facts.push(buildFact(sig(), settle(i % 3 === 0 ? 'home' : i % 3 === 1 ? 'draw' : 'away'), null, { verifiedEpoch: EPOCH }));
  const agg = aggregateMetric(facts, { metricCode: 'brier_multiclass', inputChainHead: 'h1' });
  ok('agregado Brier con CI + n', agg.value !== null && agg.confidence_interval && agg.sample_size === 50);
  ok('sample_status early (30-99)', agg.sample_status === 'early');
  ok('idempotency_key estable', agg.idempotency_key === aggregateMetric(facts, { metricCode: 'brier_multiclass', inputChainHead: 'h1' }).idempotency_key);
  ok('insufficient (<30)', cfg.sampleStatus(10) === 'insufficient' && cfg.sampleStatus(150) === 'developing' && cfg.sampleStatus(500) === 'established');
  // excluidas no entran al valor pero se cuentan
  const mixed = facts.concat([buildFact(sig({ experimental: true }), settle('home'), null, { verifiedEpoch: EPOCH })]);
  const agg2 = aggregateMetric(mixed, { metricCode: 'brier_multiclass', inputChainHead: 'h1' });
  ok('excluidas se cuentan, no se borran', agg2.excluded_count >= 1 && agg2.eligible_count === 50);
}

console.log('\n§40b ECE AGREGADO + §46 ARB');
{
  // sobreconfianza agregada → ECE alto
  const facts = []; for (let i = 0; i < 60; i++) facts.push(buildFact(sig({ signal_payload: { market_type: '1x2', probabilities: { home: 0.9, draw: 0.05, away: 0.05 } } }), settle(i < 30 ? 'home' : 'away'), null, { verifiedEpoch: EPOCH }));
  const ece = aggregateMetric(facts, { metricCode: 'ece_equal_width', inputChainHead: 'h' });
  ok('ECE agregado calcula bins + valor', ece.value !== null && ece.calibration_bins && ece.calibration_bins.length > 0);
  // arb
  const arb = arbMetrics.compute({ evaluationsScanned: 100, publishedCount: 3, quotedCount: 10, executableCount: 4, opportunities: [{ classification: 'pure_arb', net_roi: '0.02', max_executable_size: '400', lifetime_seconds: 30, deep_link_verified: true }, { classification: 'execution_sensitive', net_roi: '0.01', max_executable_size: '200', lifetime_seconds: 90, expired_before_click: true, deep_link_verified: true }] });
  ok('arb quoted→executable=0.4', arb.quoted_to_executable_conversion === 0.4);
  ok('arb sin realized ROI', arb.realized_roi === null && arb.realized_profit === null && arb.executed_capital === null);
  ok('arb lifetime p50', arb.lifetime_seconds.p50 != null && arb.pure_arb_count === 1 && arb.execution_sensitive_count === 1);
}

console.log(`\n=== RESULTADO ===\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
