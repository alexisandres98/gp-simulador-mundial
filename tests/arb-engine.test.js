// tests/arb-engine.test.js — tests del motor de arbitraje (Sprint 3, sin DB).
// Ejecutar: node tests/arb-engine.test.js
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const D = require(R + '/arb-engine/decimal');
const { walk } = require(R + '/arb-engine/bookWalker');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

console.log('Arb Engine — tests Sprint 3\n');

// ---- Decimal ----
console.log('Decimal (sin float)');
{
  ok('0.1 + 0.2 = 0.3 exacto', D.toStr(D.add(D.fromStr('0.1'), D.fromStr('0.2'))) === '0.3');
  ok('0.07 × 100 = 7', D.toStr(D.mul(D.fromStr('0.07'), D.fromStr('100'))) === '7');
  ok('1 / 3 redondeado 8 dec', D.toStr(D.div(D.fromStr('1'), D.fromStr('3')), 8) === '0.33333333');
  ok('precio×size: 0.21 × 1500 = 315', D.toStr(D.mul(D.fromStr('0.21'), D.fromStr('1500'))) === '315');
  ok('resta negativa', D.toStr(D.sub(D.fromStr('0.3'), D.fromStr('0.5'))) === '-0.2');
  ok('toStr con places redondea half-up', D.toStr(D.fromStr('0.123456789'), 4) === '0.1235');
  ok('suma de costes grande exacta', D.toStr(D.add(D.mul(D.fromStr('0.21'), D.fromStr('1500')), D.mul(D.fromStr('0.79'), D.fromStr('1500')))) === '1500');
}

// ---- Book walking ----
console.log('Book walking');
{
  const book = [{ price: '0.23', size: '1200' }, { price: '0.24', size: '2600' }, { price: '0.25', size: '4100' }];
  const one = walk({ levels: book, requestedQuantity: '1000', side: 'buy' });
  ok('1 nivel suficiente: fill completo', one.fullyFillable && one.filledQuantity === '1000');
  ok('1 nivel: vwap = best price', one.vwap === '0.23' && one.levelsConsumed === 1);
  const multi = walk({ levels: book, requestedQuantity: '2000', side: 'buy' });
  ok('varios niveles consumidos', multi.levelsConsumed === 2 && multi.filledQuantity === '2000');
  // vwap = (1200*0.23 + 800*0.24)/2000 = (276+192)/2000 = 0.234
  ok('vwap multinivel correcto', multi.vwap === '0.234', multi.vwap);
  ok('worst price = último nivel', multi.worstPrice === '0.24');
  const partial = walk({ levels: book, requestedQuantity: '10000', side: 'buy' });
  ok('fill parcial: no fully fillable', !partial.fullyFillable && partial.filledQuantity === '7900' && partial.unfilledQuantity === '2100');
  const empty = walk({ levels: [], requestedQuantity: '100', side: 'buy' });
  ok('book vacío: filled 0', empty.filledQuantity === '0' && !empty.fullyFillable);
  // orden: book desordenado se ordena best-first
  const unsorted = walk({ levels: [{ price: '0.25', size: '100' }, { price: '0.23', size: '100' }], requestedQuantity: '100', side: 'buy' });
  ok('book desordenado se ordena (consume 0.23 primero)', unsorted.vwap === '0.23');
  // mínimo de orden
  const minord = walk({ levels: book, requestedQuantity: '50', side: 'buy', minimumOrderSize: '100' });
  ok('por debajo del mínimo de orden → meetsMinimumOrder false', minord.meetsMinimumOrder === false);
  // no muta el book original
  const orig = [{ price: '0.23', size: '1200' }];
  walk({ levels: orig, requestedQuantity: '500', side: 'buy' });
  ok('no muta el book original', orig[0].size === '1200');
  // precisión: niveles repetidos
  const rep = walk({ levels: [{ price: '0.10', size: '100' }, { price: '0.10', size: '100' }], requestedQuantity: '150', side: 'buy' });
  ok('niveles repetidos se consumen', rep.filledQuantity === '150' && rep.vwap === '0.1');
}

// ---- Fee engine ----
console.log('Fee engine');
{
  const fees = require(R + '/arb-engine/feeEngine');
  const pm = fees.computeFee({ provider: 'polymarket', quantity: '1000', price: '0.45' });
  ok('Polymarket fee 0 (flat 0%)', pm.fee === '0' && pm.feeStatus === 'known');
  const ks = fees.computeFee({ provider: 'kalshi', quantity: '100', price: '0.5' });
  ok('Kalshi fee = ceil_cents(0.07·100·0.25) = 1.75', ks.fee === '1.75', ks.fee);
  const unk = fees.computeFee({ provider: 'kalshi', quantity: '100', price: '0.5', override: { schedule: { status: 'unknown', version: 'x' } } });
  ok('fee desconocida → feeStatus unknown, fee null', unk.feeStatus === 'unknown' && unk.fee === null);
}

// ---- Binary arb ----
console.log('Binary arb');
{
  const binary = require(R + '/arb-engine/binaryArb');
  const legYes = { provider: 'polymarket', side: 'yes', priceSource: 'direct_ask', levels: [{ price: '0.45', size: '1000' }] };
  const legNo = { provider: 'polymarket', side: 'no', priceSource: 'direct_ask', levels: [{ price: '0.50', size: '1000' }] };
  const r = binary.evaluate([legYes, legNo], { minNetRoi: '0', executionBufferBps: 0, referenceQuantity: '1000' });
  ok('arb sin fees: net profit positivo', r.evaluation.netProfit === '50' && r.evaluation.fullyFillable);
  ok('net ROI = 50/950', r.evaluation.netRoi === '0.05263158', r.evaluation.netRoi);
  ok('grossProfit separado de net', r.evaluation.grossProfit === '50');
  // fees eliminan el arb (Kalshi)
  const kYes = { provider: 'kalshi', side: 'yes', levels: [{ price: '0.48', size: '1000' }] };
  const kNo = { provider: 'kalshi', side: 'no', levels: [{ price: '0.50', size: '1000' }] };
  const rf = binary.evaluate([kYes, kNo], { minNetRoi: '0', executionBufferBps: 0, referenceQuantity: '1000' });
  ok('fees eliminan el arb (net negativo)', rf.evaluation.netProfit.startsWith('-'), rf.evaluation.netProfit);
  // profundidad insuficiente
  const shallow = binary.evaluate([{ provider: 'polymarket', side: 'yes', levels: [{ price: '0.45', size: '10' }] }, legNo], { minNetRoi: '0', referenceQuantity: '1000' });
  ok('profundidad insuficiente → no fully fillable', shallow.evaluation.fullyFillable === false);
  // buffer elimina el arb
  const rb = binary.evaluate([legYes, legNo], { minNetRoi: '0', executionBufferBps: 1000, referenceQuantity: '1000' }); // 10%
  ok('execution buffer reduce el margen (separado de fee)', Number(rb.evaluation.netProfit) < 50 && rb.evaluation.executionBuffer !== '0');
  // payout incompatible (estructura no complementaria)
  const bad = binary.evaluate([legYes, { provider: 'polymarket', side: 'yes', levels: [{ price: '0.5', size: '100' }] }], {});
  ok('estructura no complementaria → rechazada', bad.structureOk === false);
  // max size
  ok('max executable size encontrado', r.maxSize.maxQuantity === '1000', r.maxSize.maxQuantity);
}

// ---- 1X2 arb ----
console.log('1X2 arb');
{
  const oneXTwo = require(R + '/arb-engine/oneXTwoArb');
  const home = { provider: 'polymarket', side: 'home', period: 'regulation_90m', rulesFingerprint: 'fp1', levels: [{ price: '0.40', size: '1000' }] };
  const draw = { provider: 'polymarket', side: 'draw', period: 'regulation_90m', rulesFingerprint: 'fp1', levels: [{ price: '0.30', size: '1000' }] };
  const away = { provider: 'polymarket', side: 'away', period: 'regulation_90m', rulesFingerprint: 'fp1', levels: [{ price: '0.25', size: '1000' }] };
  const r = oneXTwo.evaluate([home, draw, away], { minNetRoi: '0', executionBufferBps: 0, referenceQuantity: '1000' });
  ok('1X2 completo: arb (suma 0.95)', r.structureOk && r.evaluation.netProfit === '50', r.evaluation && r.evaluation.netProfit);
  const missingDraw = oneXTwo.evaluate([home, away], {});
  ok('falta empate → no es 1X2', missingDraw.structureOk === false && missingDraw.reason.includes('3_legs'));
  const periodMismatch = oneXTwo.evaluate([home, { ...draw, period: 'full_match_including_extra_time' }, away], {});
  ok('periodo distinto entre patas → rechazado', periodMismatch.structureOk === false && periodMismatch.reason === 'period_mismatch');
}

// ---- Eligibility + clasificación (pipeline) ----
console.log('Eligibility + pipeline');
{
  const engine = require(R + '/arb-engine');
  const { leg, deep } = require(R + '/arb-engine/fixtures/golden');
  const cand = { strategy: 'binary', canonicalMarketId: 'm1', mappingStatus: 'matched', mappingVersion: 'v1', rulesFingerprint: 'fp1',
    legs: [leg('polymarket', 'yes', deep('0.44', '5000')), leg('polymarket', 'no', deep('0.50', '5000'))] };
  const ev = engine.evaluateCandidate(cand, { now: Date.parse('2026-06-21T16:00:01Z'), params: { executionBufferBps: 0 } });
  ok('pure arb clasificado', ev.classification === 'pure_arb', ev.classification + ' ' + JSON.stringify(ev.reasons));
  ok('net profit y ROI presentes', ev.evaluation.netProfit && ev.evaluation.netRoi);
  ok('opportunity key determinística (no depende de precio)', ev.opportunityKey === engine.evaluateCandidate(cand, { now: Date.now() }).opportunityKey);
  ok('confidence separada del profit', ev.confidence.score > 0 && ev.confidence.label && ev.confidence.factors.length > 0);
  ok('conditional nunca pure arb', engine.evaluateCandidate({ ...cand, mappingStatus: 'conditional' }, {}).classification === 'conditional');
}

// ---- Golden execution dataset (60 casos, 0 falsos Pure Arb) ----
console.log('\nGolden execution dataset (60 casos)');
{
  const engine = require(R + '/arb-engine');
  const { cases } = require(R + '/arb-engine/fixtures/golden');
  const NOW = Date.parse('2026-06-21T16:00:01Z');
  let correct = 0, falsePureArb = 0; const byCat = {};
  for (const c of cases) {
    const ev = engine.evaluateCandidate(c.candidate, { now: NOW, params: { executionBufferBps: 0, minNetRoi: '0.005' } });
    byCat[c.category] = byCat[c.category] || { n: 0, ok: 0 };
    byCat[c.category].n++;
    if (ev.classification === c.expect) { correct++; byCat[c.category].ok++; }
    // FALSO PURE ARB material: el sistema dice pure_arb donde el golden NO es pure_arb
    if (ev.classification === 'pure_arb' && c.category !== 'pure_arb') { falsePureArb++; console.log(`    ⚠️ FALSO PURE ARB: ${c.id} (${c.category})`); }
  }
  for (const [cat, v] of Object.entries(byCat)) console.log(`  ${cat}: ${v.ok}/${v.n}`);
  const pureN = cases.filter(c => c.category === 'pure_arb').length;
  const pureDetected = cases.filter(c => c.category === 'pure_arb').filter(c => engine.evaluateCandidate(c.candidate, { now: NOW, params: { executionBufferBps: 0, minNetRoi: '0.005' } }).classification === 'pure_arb').length;
  console.log(`  pure arb detectados: ${pureDetected}/${pureN} · falsos pure arb: ${falsePureArb} · clasificación correcta: ${correct}/${cases.length}`);
  ok('CERO falsos Pure Arb materiales', falsePureArb === 0);
  ok('todos los pure_arb reales detectados', pureDetected === pureN);
  ok('clasificación correcta en todo el golden', correct === cases.length, `${correct}/${cases.length}`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} Arb Engine: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
