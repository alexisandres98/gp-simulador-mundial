#!/usr/bin/env node
'use strict';
// HUMO DE LAS BANDAS DE EFICIENCIA: la histéresis protege la banda ACTUAL, no la del prior (5-sep).
//   node scripts/smoke/bandas-smoke.js
const B = require('../../lib/bandas');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

console.log('\n── la regla antigua, tal cual era (solo para sembrar) ──────────────');
t('0,2292 con prior intermedia → eficiente (así estaba MLS)', B.bandaLegacy(0.2292, 'intermedia') === 'eficiente');
t('0,2305 con prior intermedia → intermedia (así oscilaba MLS)', B.bandaLegacy(0.2305, 'intermedia') === 'intermedia');
t('0,2330 con prior eficiente → eficiente (la histéresis vieja solo protegía al prior)', B.bandaLegacy(0.2330, 'eficiente') === 'eficiente');
t('0,2570 con prior blanda → blanda', B.bandaLegacy(0.2570, 'blanda') === 'blanda');
t('0,2570 con prior intermedia → intermedia', B.bandaLegacy(0.2570, 'intermedia') === 'intermedia');

console.log('\n── la regla nueva: el margen protege donde ESTÁ la liga ───────────');
t('eficiente con 0,2305 sigue eficiente (antes MLS caía aquí)', B.bandaConMargen(0.2305, 'eficiente') === 'eficiente');
t('eficiente con 0,2349 sigue eficiente', B.bandaConMargen(0.2349, 'eficiente') === 'eficiente');
t('eficiente con 0,2351 cae a intermedia', B.bandaConMargen(0.2351, 'eficiente') === 'intermedia');
t('eficiente con 0,2660 cae directo a blanda', B.bandaConMargen(0.2660, 'eficiente') === 'blanda');
t('intermedia con 0,2292 sigue intermedia (hace falta < 0,225 para subir)', B.bandaConMargen(0.2292, 'intermedia') === 'intermedia');
t('intermedia con 0,2249 sube a eficiente', B.bandaConMargen(0.2249, 'intermedia') === 'eficiente');
t('intermedia con 0,2640 sigue intermedia', B.bandaConMargen(0.2640, 'intermedia') === 'intermedia');
t('intermedia con 0,2651 baja a blanda', B.bandaConMargen(0.2651, 'intermedia') === 'blanda');
t('blanda con 0,2560 sigue blanda', B.bandaConMargen(0.2560, 'blanda') === 'blanda');
t('blanda con 0,2549 sube a intermedia', B.bandaConMargen(0.2549, 'blanda') === 'intermedia');
t('blanda con 0,2240 sube directo a eficiente', B.bandaConMargen(0.2240, 'blanda') === 'eficiente');
t('Brier no numérico → se queda donde está', B.bandaConMargen(NaN, 'eficiente') === 'eficiente');

console.log('\n── ninguna liga oscila: ida y vuelta alrededor del umbral ─────────');
let b = 'eficiente';
const serie = [0.2298, 0.2302, 0.2310, 0.2299, 0.2320, 0.2345, 0.2330];
const vistas = new Set();
for (const br of serie) { b = B.bandaConMargen(br, b); vistas.add(b); }
t('MLS bailando entre 0,2298 y 0,2345 NO cambia de banda ni una vez', vistas.size === 1 && b === 'eficiente', [...vistas]);
b = 'intermedia';
for (const br of [0.2295, 0.2280, 0.2260, 0.2255, 0.2251]) b = B.bandaConMargen(br, b);
t('una intermedia que se acerca sin cruzar 0,225 sigue intermedia', b === 'intermedia');
b = B.bandaConMargen(0.2249, b);
t('…y en cuanto cruza con margen, sube', b === 'eficiente');
b = B.bandaConMargen(0.2330, b);
t('…y ya arriba, un rebote a 0,233 no la baja', b === 'eficiente');

console.log('\n── evaluarBanda: la memoria y la siembra ──────────────────────────');
let r = B.evaluarBanda({ brier: 0.2292, n: 30, prior: 'intermedia', memoria: null });
t('con menos de 40 manda el prior', r.band === 'intermedia' && r.source === 'prior' && r.memoria === null);
r = B.evaluarBanda({ brier: 0.2292, n: 231, prior: 'intermedia', memoria: null });
t('primera evaluación con muestra: se siembra con la regla ANTIGUA (MLS queda eficiente, como hoy)', r.band === 'eficiente' && r.memoria.sembrada === true && r.cambio === false, r);
const m1 = r.memoria;
r = B.evaluarBanda({ brier: 0.2305, n: 240, prior: 'intermedia', memoria: m1 });
t('siguiente pasada con 0,2305: sigue eficiente y NO es cambio', r.band === 'eficiente' && r.cambio === false);
r = B.evaluarBanda({ brier: 0.2360, n: 260, prior: 'intermedia', memoria: r.memoria });
t('con 0,236 cae a intermedia y queda anotado el cambio', r.band === 'intermedia' && r.cambio === true && r.memoria.cambios.length === 1 && r.memoria.cambios[0].de === 'eficiente', r.memoria.cambios);
r = B.evaluarBanda({ brier: 0.2340, n: 270, prior: 'intermedia', memoria: r.memoria });
t('y un rebote a 0,234 no la devuelve a eficiente (hace falta < 0,225)', r.band === 'intermedia' && r.cambio === false);
// las bandas de hoy no cambian al desplegar: siembra = regla antigua sobre las medidas reales del 5-sep
const hoy = [['mls', 0.2292, 'intermedia', 'eficiente'], ['noruega', 0.2281, 'blanda', 'eficiente'], ['laliga', 0.2428, 'eficiente', 'intermedia'],
  ['suecia', 0.2400, 'eficiente', 'intermedia'], ['seriea', 0.2275, 'eficiente', 'eficiente'], ['ligamx', 0.2809, 'intermedia', 'blanda'],
  ['brasileirao', 0.2363, 'intermedia', 'intermedia'], ['championship', 0.1894, 'eficiente', 'eficiente'], ['csl', 0.2172, 'blanda', 'eficiente']];
let iguales = 0;
for (const [lg, br, prior, esperada] of hoy) { const x = B.evaluarBanda({ brier: br, n: 50, prior, memoria: null }); if (x.band === esperada) iguales++; else console.log('     difiere', lg, x.band, 'vs', esperada); }
t('las nueve ligas medidas del 5-sep conservan su banda al sembrar', iguales === hoy.length, iguales);
r = B.evaluarBanda({ brier: NaN, n: 0, prior: 'blanda', memoria: m1 });
t('si la liga pierde la muestra, la memoria no se destruye', r.source === 'prior' && r.memoria === m1);

console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
process.exit(ko ? 1 : 0);
