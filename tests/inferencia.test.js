// tests/inferencia.test.js — la incertidumbre común (A30 / T1.5).
//
// Lo que se prueba aquí no es que las funciones corran: es que el módulo DETECTE el error que existe para
// impedir. La comprobación que de verdad importa es la 2 — con diez racimos de veinte filas idénticas, el
// error estándar por racimos tiene que salir MUCHO mayor que el ingenuo por filas. Si algún día esa prueba
// pasa por los pelos, es que alguien ha vuelto a remuestrear filas en vez de racimos.
'use strict';
const assert = require('assert');
const I = require('../lib/inferencia');

let ok = 0, fallos = 0, detalle = null;
const nota = (s) => { detalle = s; };          // apunte que se imprime DESPUÉS de la línea de la comprobación
function t(nombre, fn) {
  detalle = null;
  try { fn(); ok++; console.log('  ✓ ' + nombre); }
  catch (e) { fallos++; console.log('  ✗ ' + nombre + ' → ' + e.message); }
  if (detalle) console.log('      ' + detalle);
}
const cerca = (a, b, tol, msg) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

console.log('lib/inferencia.js');

// ── 0. Piezas base ─────────────────────────────────────────────────────────────────────────────────────
t('la normal y su inversa están bien (Φ(1,96) = 0,975, z(0,975) = 1,959964)', () => {
  cerca(I.normalCdf(0), 0.5, 1e-7, 'Φ(0)');   // la aproximación de erfc declara error < 1,2e−7
  cerca(I.normalCdf(1.959963985), 0.975, 1e-6, 'Φ(1,96)');
  cerca(I.normalInv(0.975), 1.959963985, 1e-6, 'z(0,975)');
  cerca(I.normalInv(0.80), 0.8416212, 1e-5, 'z(0,80)');
  cerca(I.zBilateral(0.05), 1.959963985, 1e-6, 'z bilateral 5 %');
});

t('mediaIC devuelve n, media, sd, se, t e intervalo coherentes', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const r = I.mediaIC(v);
  assert.strictEqual(r.n, 10);
  cerca(r.media, 5.5, 1e-9, 'media');
  cerca(r.sd, 3.0276504, 1e-6, 'sd muestral');
  cerca(r.se, 3.0276504 / Math.sqrt(10), 1e-6, 'se');
  cerca(r.t, r.media / r.se, 1e-6, 't');
  cerca(r.ic[0], r.media - 1.959963985 * r.se, 1e-6, 'ic bajo');
  cerca(r.ic[1], r.media + 1.959963985 * r.se, 1e-6, 'ic alto');
});

// ── 1. Con racimos de tamaño 1, el bootstrap por clusters ≈ el error estándar clásico ──────────────────
t('1) clusters de tamaño 1: el se por bootstrap y el normal coinciden (±15 %)', () => {
  // 240 valores deterministas y bien repartidos, cada uno en su propio racimo
  const items = [];
  for (let i = 0; i < 240; i++) items.push({ id: i, v: Math.sin(i * 1.7) * 3 + Math.cos(i * 0.31) * 2 + 0.4 });
  const clasico = I.mediaIC(items.map((x) => x.v));
  const boot = I.bootstrapClusters(items, { valor: (x) => x.v, cluster: (x) => x.id, replicas: 2000, semilla: 7 });
  assert.strictEqual(boot.n_items, 240, 'n_items');
  assert.strictEqual(boot.n_clusters, 240, 'n_clusters: cada fila su racimo');
  cerca(boot.media, clasico.media, 1e-6, 'la media no cambia');
  const razon = boot.se / clasico.se;
  assert.ok(razon > 0.85 && razon < 1.15, `se bootstrap/se clásico = ${razon.toFixed(4)}, fuera de ±15 %`);
  // y el intervalo también se parece
  assert.ok(Math.abs(boot.ic[0] - clasico.ic[0]) < 0.25 * Math.abs(clasico.se) * 1.96 + 0.05, 'ic bajo parecido');
});

// ── 2. EL ERROR QUE EL MÓDULO EXISTE PARA EVITAR ───────────────────────────────────────────────────────
t('2) 10 racimos × 20 filas idénticas: el se por racimos es ≥ 3× el ingenuo por filas', () => {
  // cada racimo es un "partido": sus 20 filas (líneas del mismo mercado) se liquidan con el mismo resultado
  const porRacimo = [2.0, -1.0, 3.5, 0.5, -2.5, 1.0, 4.0, -0.5, 2.5, -3.0];
  const items = [];
  porRacimo.forEach((v, c) => { for (let k = 0; k < 20; k++) items.push({ partido: 'P' + c, v }); });
  assert.strictEqual(items.length, 200);

  const ingenuo = I.mediaIC(items.map((x) => x.v));           // el t de siempre: 200 tickets "independientes"
  const honesto = I.bootstrapClusters(items, { valor: (x) => x.v, cluster: (x) => x.partido, replicas: 2000, semilla: 42 });

  assert.strictEqual(honesto.n_items, 200, 'n_items');
  assert.strictEqual(honesto.n_clusters, 10, 'n_clusters');
  cerca(honesto.media, ingenuo.media, 1e-6, 'la media es la misma; lo que cambia es la barra de error');
  const razon = honesto.se / ingenuo.se;
  assert.ok(razon >= 3, `se por racimos / se ingenuo = ${razon.toFixed(2)}, debería ser ≥ 3 (lo esperado ≈ √20 = 4,47)`);
  // y el t se derrumba en la misma proporción: eso es lo que convierte un "t = 3" en un "no sabemos"
  assert.ok(Math.abs(honesto.t) < Math.abs(ingenuo.t) / 3, 't honesto mucho menor que el ingenuo');
  nota(`se ingenuo ${ingenuo.se.toFixed(4)} (t ${ingenuo.t.toFixed(2)}) → se por racimos ${honesto.se.toFixed(4)} (t ${honesto.t.toFixed(2)}); ×${razon.toFixed(2)}`);
});

// ── 3. Los intervalos del §5.2 de la auditoría ─────────────────────────────────────────────────────────
t('3) §5.2: NFL 575 a −110 con +1,55 % → IC [−6,24 %, +9,34 %]', () => {
  const r = I.roiICAnalitico(575, 1.55, 1 + 100 / 110);
  cerca(r.ic_pct[0], -6.24, 0.1, 'IC bajo NFL');
  cerca(r.ic_pct[1], 9.34, 0.1, 'IC alto NFL');
  cerca(r.t, 0.39, 0.02, 't NFL');
  assert.ok(r.ic_pct[0] < 0 && r.ic_pct[1] > 0, 'el intervalo contiene el cero: compatible con no tener ventaja');
});
t('3) §5.2: NCAAF 2.199 a −110 con +1,04 % → IC [−2,94 %, +5,02 %]', () => {
  const r = I.roiICAnalitico(2199, 1.04, 1 + 100 / 110);
  cerca(r.ic_pct[0], -2.94, 0.1, 'IC bajo NCAAF');
  cerca(r.ic_pct[1], 5.02, 0.1, 'IC alto NCAAF');
  cerca(r.t, 0.51, 0.02, 't NCAAF');
});
t('3) §5.2: props CS2 330 a −112 con +2,20 % → IC [−7,98 %, +12,38 %]', () => {
  const r = I.roiICAnalitico(330, 2.20, 1 + 100 / 112);
  cerca(r.ic_pct[0], -7.98, 0.1, 'IC bajo props');
  cerca(r.ic_pct[1], 12.38, 0.1, 'IC alto props');
  cerca(r.t, 0.42, 0.02, 't props');
});

t('3bis) el ROI por remuestreo es un COCIENTE: con stakes desiguales no es la media de los ROI por ticket', () => {
  // dos tickets: uno de 5 que gana 5 (+100 %) y uno de 95 que pierde 95 (−100 %).
  // ROI de cartera = (5 − 95) / 100 = −90 %. La media de los ROI por ticket sería 0 %.
  const items = [{ ev: 'A', pnl: 5, stake: 5 }, { ev: 'B', pnl: -95, stake: 95 }];
  const r = I.roiIC(items, { beneficio: (x) => x.pnl, stake: (x) => x.stake, cluster: (x) => x.ev, replicas: 500, semilla: 3 });
  cerca(r.roi_pct, -90, 1e-6, 'ROI de cartera');
  cerca(r.apostado, 100, 1e-9, 'apostado');
  cerca(r.pnl, -90, 1e-9, 'pnl');
  assert.strictEqual(r.n_clusters, 2);
});

t('3ter) roiIC con racimos grandes ensancha el intervalo frente a tratar las filas como sueltas', () => {
  // 12 partidos; dentro de cada uno, 8 líneas que ganan o pierden TODAS a la vez (under 4,5 y 5,5…)
  const gano = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0];
  const items = [];
  gano.forEach((g, c) => { for (let k = 0; k < 8; k++) items.push({ partido: 'M' + c, pnl: g ? 40 * 0.91 : -40, stake: 40 }); });
  const porRacimo = I.roiIC(items, { beneficio: (x) => x.pnl, stake: (x) => x.stake, cluster: (x) => x.partido, replicas: 2000, semilla: 11 });
  const porFila = I.roiIC(items, { beneficio: (x) => x.pnl, stake: (x) => x.stake, cluster: (x, i) => i, replicas: 2000, semilla: 11 });
  assert.strictEqual(porRacimo.n_clusters, 12);
  assert.strictEqual(porFila.n_clusters, 96);
  cerca(porRacimo.roi_pct, porFila.roi_pct, 1e-6, 'mismo ROI');
  assert.ok(porRacimo.se_pct > 2.5 * porFila.se_pct, `se por racimos ${porRacimo.se_pct} debe ser >> ${porFila.se_pct}`);
});

// ── 4. Benjamini-Hochberg ──────────────────────────────────────────────────────────────────────────────
t('4) BH con 30 p-valores (5 de 0,001 y 25 uniformes altos) rechaza exactamente los 5', () => {
  const ps = [];
  for (let i = 0; i < 5; i++) ps.push(0.001);
  for (let i = 0; i < 25; i++) ps.push(0.40 + 0.02 * i);      // de 0,40 a 0,88: ninguno debería pasar
  const r = I.bh(ps, 0.10);
  assert.strictEqual(r.m, 30, 'm');
  assert.deepStrictEqual(r.rechazadas, [0, 1, 2, 3, 4], 'solo los cinco de 0,001');
  cerca(r.umbral, 0.001, 1e-9, 'umbral');
});
t('4bis) BH no rechaza nada cuando no hay señal, y eso es una respuesta legítima', () => {
  const ps = []; for (let i = 0; i < 40; i++) ps.push(0.03 + i * 0.024);   // el menor es 0,03; 1/40·0,10 = 0,0025
  const r = I.bh(ps, 0.10);
  assert.deepStrictEqual(r.rechazadas, [], 'ninguna');
  assert.strictEqual(r.umbral, 0, 'umbral 0');
});
t('4ter) BH es menos estricto que Bonferroni y más que el 0,05 suelto', () => {
  const ps = [0.001, 0.008, 0.02, 0.03, 0.045, 0.6, 0.7, 0.8, 0.9, 0.95];
  const r = I.bh(ps, 0.10);
  const sueltas = ps.filter((p) => p < 0.05).length;            // 5
  const bonf = ps.filter((p) => p < 0.10 / ps.length).length;   // 2
  assert.ok(r.rechazadas.length >= bonf && r.rechazadas.length <= sueltas,
    `BH rechaza ${r.rechazadas.length}, entre Bonferroni (${bonf}) y suelto (${sueltas})`);
});

// ── 5. Reproducibilidad ────────────────────────────────────────────────────────────────────────────────
t('5) la semilla fija reproduce exactamente el mismo resultado en dos llamadas', () => {
  const items = [];
  for (let c = 0; c < 25; c++) for (let k = 0; k < 4; k++) items.push({ g: 'G' + c, v: Math.sin(c * 2.3 + k) * 2 + 0.3, pnl: (k % 2 ? 1 : -1) * (c + 1), stake: 10 + c });
  const a = I.bootstrapClusters(items, { valor: (x) => x.v, cluster: (x) => x.g, replicas: 800, semilla: 42 });
  const b = I.bootstrapClusters(items, { valor: (x) => x.v, cluster: (x) => x.g, replicas: 800, semilla: 42 });
  assert.deepStrictEqual(a, b, 'bootstrapClusters no es reproducible');
  const c1 = I.roiIC(items, { beneficio: (x) => x.pnl, stake: (x) => x.stake, cluster: (x) => x.g, replicas: 800, semilla: 42 });
  const c2 = I.roiIC(items, { beneficio: (x) => x.pnl, stake: (x) => x.stake, cluster: (x) => x.g, replicas: 800, semilla: 42 });
  assert.deepStrictEqual(c1, c2, 'roiIC no es reproducible');
  // y una semilla distinta da un resultado distinto (si no, el generador estaría muerto)
  const d = I.bootstrapClusters(items, { valor: (x) => x.v, cluster: (x) => x.g, replicas: 800, semilla: 43 });
  assert.notStrictEqual(d.se, a.se, 'otra semilla debería dar otro se');
});
t('5bis) el generador sembrado está en [0,1) y no se repite en seguida', () => {
  const rnd = I.generador(42);
  const xs = []; for (let i = 0; i < 1000; i++) xs.push(rnd());
  assert.ok(xs.every((x) => x >= 0 && x < 1), 'rango');
  assert.strictEqual(new Set(xs).size, 1000, 'sin repeticiones en 1.000 tiradas');
  cerca(xs.reduce((a, b) => a + b, 0) / 1000, 0.5, 0.05, 'media ≈ 0,5');
});

// ── 6. p desde t ───────────────────────────────────────────────────────────────────────────────────────
t('6) pDeT reproduce la tabla de Student con error < 0,002', () => {
  cerca(I.pDeT(2.228, 10), 0.05, 0.002, 't 2,228 gl 10');
  cerca(I.pDeT(2.0, 5), 0.1019, 0.002, 't 2,0 gl 5');
  cerca(I.pDeT(1.96, 100000), 0.05, 0.001, 't 1,96 gl enorme ≈ normal');
  cerca(I.pDeT(0, 30), 1, 1e-6, 't 0 → p 1');
  assert.strictEqual(I.pDeT(2, 1), null, 'gl ≤ 2 no devuelve número');
  assert.ok(I.pDeT(3, 50) < I.pDeT(2, 50), 'más t, menos p');
});

// ── 7. Potencia y tamaño necesario ─────────────────────────────────────────────────────────────────────
t('7) potencia y nParaDetectar son consistentes entre sí', () => {
  const n = I.nParaDetectar({ efecto: 0.02, sd: 1, alfa: 0.05, potencia: 0.80 });
  cerca(n, 19623, 5, 'n para efecto 0,02 con sd 1');       // ((1,959964+0,841621)/0,02)² = 19.622,x
  const pot = I.potencia({ n, efecto: 0.02, sd: 1, alfa: 0.05 });
  cerca(pot, 0.80, 0.005, 'la potencia al n calculado vuelve a ser 0,80');
  assert.ok(I.potencia({ n: 100, efecto: 0.02, sd: 1 }) < 0.10, 'con 100 observaciones no se detecta nada así');
});
t('7bis) §5.3: a cuota 1,91 hacen falta ~71.402 apuestas para un ROI del 1 % y ~710 para el 10 %', () => {
  const casos = [[0.01, 71402], [0.02, 17844], [0.03, 7927], [0.05, 2851], [0.10, 710]];
  for (const [roi, esperado] of casos) {
    const r = I.nParaDetectarRoi({ roiPct: roi * 100, cuota: 1.91, alfa: 0.05, potencia: 0.80 });
    cerca(r.n, esperado, Math.max(2, esperado * 0.001), `n para ROI ${(roi * 100).toFixed(0)} %`);
  }
  nota('(100 liquidadas el 20-oct son un control operativo, no una certificación)');
});
t('7ter) la semiamplitud del IC de ROI con 100 apuestas a 1,91 es ≈ 18,7 pp', () => {
  const r = I.roiICAnalitico(100, 0, 1.91);
  cerca((r.ic_pct[1] - r.ic_pct[0]) / 2, 18.7, 0.2, 'semiamplitud');
});

// ── 8. Bordes ──────────────────────────────────────────────────────────────────────────────────────────
t('8) casos límite: vacío, un solo racimo, valores no finitos', () => {
  const v = I.mediaIC([]);
  assert.strictEqual(v.n, 0);
  const b0 = I.bootstrapClusters([], { valor: (x) => x.v });
  assert.strictEqual(b0.n_clusters, 0);
  assert.strictEqual(b0.se, null);
  const b1 = I.bootstrapClusters([{ g: 'A', v: 1 }, { g: 'A', v: 2 }], { valor: (x) => x.v, cluster: (x) => x.g });
  assert.strictEqual(b1.n_clusters, 1);
  assert.strictEqual(b1.se, null, 'un solo racimo no tiene variación entre racimos');
  assert.ok(b1.aviso, 'y lo dice');
  // filas rotas: se descartan, no envenenan la media
  const b2 = I.bootstrapClusters([{ g: 'A', v: 1 }, { g: 'B', v: NaN }, { g: 'C', v: 3 }], { valor: (x) => x.v, cluster: (x) => x.g, replicas: 200 });
  assert.strictEqual(b2.n_items, 2, 'la fila NaN no cuenta');
  assert.strictEqual(b2.n_clusters, 2);
  // stake 0 o negativo no entra al ROI
  const r = I.roiIC([{ g: 'A', pnl: 1, stake: 0 }, { g: 'B', pnl: 2, stake: 10 }, { g: 'C', pnl: -10, stake: 10 }],
    { beneficio: (x) => x.pnl, stake: (x) => x.stake, cluster: (x) => x.g, replicas: 200 });
  assert.strictEqual(r.n_items, 2, 'el stake 0 queda fuera');
  cerca(r.apostado, 20, 1e-9, 'apostado');
  // sin función cluster, cada fila es su racimo Y SE AVISA (es el error que venimos a evitar)
  const b3 = I.bootstrapClusters([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }], { valor: (x) => x.v, replicas: 200 });
  assert.strictEqual(b3.n_clusters, 4);
  assert.ok(b3.aviso && /racimo/.test(b3.aviso), 'debe avisar de que falta la función cluster');
});

console.log(`\ninferencia: ${ok} comprobaciones OK, ${fallos} fallos`);
if (fallos) process.exit(1);
