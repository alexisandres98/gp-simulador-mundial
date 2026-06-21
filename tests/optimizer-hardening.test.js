// tests/optimizer-hardening.test.js — Sprint 4 §40. Verifica la suposición de monotonicidad del
// size optimizer del motor (búsqueda binaria) frente a una búsqueda exhaustiva en breakpoints y a un
// ORÁCULO por scan denso. Condición: la binaria nunca devuelve un tamaño NO elegible ni pierde un
// tamaño elegible materialmente superior. Casos golden + aleatorios reproducibles (LCG con semilla fija).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const { compareOptimizers } = require(R + '/exec-opportunities/breakpoints');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// LCG determinístico (no usa Math.random → reproducible).
function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

// arma patas de cálculo (con niveles de book) para una compra binaria complementaria.
function calcLegs(provA, levelsA, provB, levelsB) {
  return [
    { provider: provA, side: 'yes', levels: levelsA, tickSize: '0.01' },
    { provider: provB, side: 'no', levels: levelsB, tickSize: '0.01' },
  ];
}
function lvl(price, size) { return { price: String(price), size: String(size) }; }

const OPTS = { minNetRoi: '0.005', executionBufferBps: 50 };

console.log('Casos golden (multi-nivel, fees Kalshi con ceil)');
const golden = [
  // arb limpio profundo (polymarket sin fee)
  calcLegs('polymarket', [lvl('0.44', 300)], 'polymarket', [lvl('0.50', 300)]),
  // multi-nivel con slippage progresivo
  calcLegs('polymarket', [lvl('0.44', 50), lvl('0.46', 100), lvl('0.49', 200)], 'polymarket', [lvl('0.50', 50), lvl('0.51', 100), lvl('0.54', 200)]),
  // Kalshi en ambas (fee ceil por centavos → posibles saltos discretos)
  calcLegs('kalshi', [lvl('0.45', 80), lvl('0.47', 120), lvl('0.49', 150)], 'kalshi', [lvl('0.50', 80), lvl('0.51', 120), lvl('0.53', 150)]),
  // cross-venue con un nivel diminuto de arb y luego profundidad cara
  calcLegs('polymarket', [lvl('0.44', 8), lvl('0.60', 400)], 'kalshi', [lvl('0.50', 8), lvl('0.55', 400)]),
];
let goldFail = 0;
golden.forEach((legs, i) => {
  const cmp = compareOptimizers(legs, OPTS, { oracleSteps: 3000 });
  if (!cmp.ok) goldFail++;
  ok(`golden#${i} binaria elegible y sin pérdida material (bin=${cmp.binary} oracle=${cmp.oracle})`, cmp.ok, JSON.stringify(cmp));
});

console.log('Casos aleatorios reproducibles (200)');
const rnd = lcg(20260621);
let randFail = 0, binaryInfeasible = 0, missMaterial = 0, total = 0;
for (let i = 0; i < 200; i++) {
  // construye dos libros complementarios con gap bruto plausible y profundidades variadas
  const provA = rnd() < 0.5 ? 'polymarket' : 'kalshi';
  const provB = rnd() < 0.5 ? 'polymarket' : 'kalshi';
  const baseY = 0.40 + rnd() * 0.08;     // 0.40–0.48
  const baseN = 0.49 + rnd() * 0.05;     // 0.49–0.54
  const nLevels = 1 + Math.floor(rnd() * 3);
  const levelsA = [], levelsB = [];
  let py = baseY, pn = baseN;
  for (let k = 0; k < nLevels; k++) {
    const sz = 10 + Math.floor(rnd() * 200);
    levelsA.push(lvl(py.toFixed(2), sz));
    levelsB.push(lvl(pn.toFixed(2), sz));
    py = Math.min(0.95, py + rnd() * 0.06);
    pn = Math.min(0.95, pn + rnd() * 0.06);
  }
  const opts = { minNetRoi: (0.003 + rnd() * 0.01).toFixed(4), executionBufferBps: 50, maxCapital: rnd() < 0.3 ? String(50 + Math.floor(rnd() * 400)) : undefined };
  const cmp = compareOptimizers(calcLegs(provA, levelsA, provB, levelsB), opts, { oracleSteps: 1500 });
  total++;
  if (!cmp.binaryFeasible) binaryInfeasible++;
  if (cmp.missesMaterial) missMaterial++;
  if (!cmp.ok) randFail++;
}
ok(`200 aleatorios: binaria SIEMPRE elegible (infeasible=${binaryInfeasible})`, binaryInfeasible === 0);
ok(`200 aleatorios: binaria sin pérdida material (miss=${missMaterial})`, missMaterial === 0);

console.log('\n=== RESULTADO HARDENING ===');
console.log(`golden fail=${goldFail}, random fail=${randFail}, binaryInfeasible=${binaryInfeasible}, missMaterial=${missMaterial}`);
console.log(`PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
