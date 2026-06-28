// tests/premium-confidence.test.js — Corte 2.1 A.1. La confianza tiene UNA fuente de verdad:
// el módulo gp-product/confidence.js calcula LOW/MEDIUM/HIGH determinístico, y la narrativa de riesgo
// del cliente NUNCA debe afirmar un nivel de confianza (eso lo controla SOLO el badge).
'use strict';
const path = require('path');
const fs = require('fs');
const R = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const C = require(R + '/gp-product/confidence');

console.log('\n== confidence: enum canónico ==');
ok('LEVELS = LOW/MEDIUM/HIGH', JSON.stringify(C.LEVELS) === JSON.stringify(['LOW', 'MEDIUM', 'HIGH']));
ok('isValidLevel acepta los 3', C.LEVELS.every(C.isValidLevel) && !C.isValidLevel('moderada') && !C.isValidLevel(null));

console.log('\n== confidence: siempre devuelve un nivel reconocido ==');
const cases = [
  {}, { uncertaintyScore: 0 }, { uncertaintyScore: 100 }, { contextCompleteness: 1 }, { contextCompleteness: 0 },
  { dataFreshness: 'STALE' }, { dataFreshness: 'FRESH' }, { risks: ['MODEL_UNCERTAINTY', 'LINEUP_NOT_CONFIRMED'] },
  { uncertaintyScore: 60, contextCompleteness: 0.2, dataFreshness: 'STALE', risks: ['LARGE_MARKET_DISAGREEMENT'] },
  { uncertaintyScore: 5, contextCompleteness: 0.95, dataFreshness: 'FRESH', risks: [] },
];
let allValid = true;
cases.forEach((c) => { if (!C.isValidLevel(C.computeConfidence(c))) allValid = false; });
ok('todo input produce un nivel válido del enum', allValid);

console.log('\n== confidence: determinismo ==');
const inp = { uncertaintyScore: 35, contextCompleteness: 0.5, dataFreshness: 'AGING', risks: ['MODEL_DISAGREEMENT'] };
ok('mismo input → mismo output', C.computeConfidence(inp) === C.computeConfidence(inp));

console.log('\n== confidence: monotonía esperada en extremos ==');
ok('alta incertidumbre + contexto pobre + stale → LOW', C.computeConfidence({ uncertaintyScore: 70, contextCompleteness: 0.2, dataFreshness: 'STALE', risks: ['MODEL_UNCERTAINTY'] }) === 'LOW');
ok('baja incertidumbre + contexto pleno + fresh → HIGH', C.computeConfidence({ uncertaintyScore: 5, contextCompleteness: 0.9, dataFreshness: 'FRESH', risks: [] }) === 'HIGH');
ok('sin señales → MEDIUM', C.computeConfidence({}) === 'MEDIUM');

console.log('\n== narrativa de riesgo NO afirma un nivel de confianza (anti-contradicción) ==');
const premium = fs.readFileSync(R + '/public/premium.js', 'utf8');
// extrae el bloque var RISK = {...};
const m = premium.match(/var RISK = \{[\s\S]*?\};/);
ok('bloque RISK presente', !!m);
const riskBlock = m ? m[0] : '';
const banned = ['confianza se mantiene', 'confidence stays', 'la confianza moderada', 'confianza moderada', 'moderate confidence'];
const offenders = banned.filter((w) => riskBlock.toLowerCase().includes(w.toLowerCase()));
ok('el copy de riesgo no menciona un nivel de confianza', offenders.length === 0, offenders.join(','));
// el badge debe leer confidence_code del DTO (no un heurístico de edge)
ok('el memo usa confidence_code del DTO', /confInfo\(ma && ma\.confidence_code\)/.test(premium));

console.log(`\n${fail === 0 ? '✅' : '❌'} premium-confidence: ${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
