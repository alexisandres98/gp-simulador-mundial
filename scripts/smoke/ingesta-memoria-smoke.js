#!/usr/bin/env node
'use strict';
// scripts/smoke/ingesta-memoria-smoke.js — humo del freno de memoria de la ingesta.
//
// POR QUÉ EXISTE. El 4-sep-2026 a las 18:11 el contenedor murió por falta de memoria (límite 4 GiB) y
// Render lo reinició. El vigía instrumentado el 28-ago ya señalaba al dueño —`ingesta: ciclo con salto de
// memoria · provider: polymarket`— y la curva fue de 714 MB a 3.382 MB en tres minutos. Tres muertes en 36
// horas. La plataforma tenía guardia de memoria, pero SOLO para los trabajos que se lanzan como proceso
// hijo; las ingestas en línea no pasaban por ningún control, y son justo las que reventaron.
//
// Este humo comprueba que el freno hace lo único que se le pide: convertir una MUERTE en una PASADA
// SALTADA, sin tocar el funcionamiento sano y sin quedarse frenado para siempre cuando la memoria baja.
//
//   node scripts/smoke/ingesta-memoria-smoke.js
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// el RSS se finge: es la única forma de recorrer el escenario sin reservar gigas de verdad
const realMem = process.memoryUsage;
let RSS_MB = 900;
const fingirRss = () => { process.memoryUsage = Object.assign(() => ({ ...realMem(), rss: RSS_MB * 1048576 }), realMem); };
fingirRss();

process.env.GP_INGESTA_TECHO_MB = '1700';
// el pipeline no debe salir a la red: se sustituye por uno que solo cuenta cuántas veces se le llama
const pipePath = require.resolve(path.join(ROOT, 'market-data', 'pipeline.js'));
let CICLOS = 0;
require.cache[pipePath] = { id: pipePath, filename: pipePath, loaded: true,
  exports: { runProviderCycle: async () => { CICLOS++; return { status: 'ok' }; } } };

const S = require(path.join(ROOT, 'market-data', 'scheduler'));

(async () => {
  console.log('\n── memoria sana: la ingesta corre ─────────────────────────────────');
  RSS_MB = 900;
  const r1 = await S.runOnce('polymarket');
  t('con 900 MB el ciclo se ejecuta', CICLOS === 1 && !r1.skipped, { ciclos: CICLOS, r: r1 });

  RSS_MB = 1699;
  await S.runOnce('polymarket');
  t('justo por debajo del techo, también', CICLOS === 2);

  console.log('\n── memoria alta: se salta en vez de morir ─────────────────────────');
  RSS_MB = 2400;
  const r2 = await S.runOnce('polymarket');
  t('por encima del techo NO se ejecuta', CICLOS === 2, { ciclos: CICLOS });
  t('y lo dice con sus cifras', r2.skipped === 'memoria' && r2.rss_mb === 2400 && r2.techo_mb === 1700, r2);
  const r3 = await S.runOnce('polymarket');
  t('cuenta los saltos seguidos', r3.seguidos === 2, r3);
  t('sigue sin ejecutar nada', CICLOS === 2);

  console.log('\n── el freno es por proveedor, no global ───────────────────────────');
  const st1 = S.status();
  const poly = st1.providers.find((x) => x.provider === 'polymarket');
  const otro = st1.providers.find((x) => x.provider !== 'polymarket');
  t('el proveedor culpable acumula sus saltos', poly && poly.memSkips === 2, poly && poly.memSkips);
  t('los demás siguen a cero', !otro || otro.memSkips === 0, otro && otro.memSkips);
  t('el estado publica techo y último RSS', st1.memoria.techo_mb === 1700 && st1.memoria.ultimo_rss_mb === 2400, st1.memoria);

  console.log('\n── la memoria baja: se reanuda sola ───────────────────────────────');
  RSS_MB = 1000;
  await S.runOnce('polymarket');
  t('vuelve a ejecutar en cuanto hay sitio', CICLOS === 3, { ciclos: CICLOS });
  const st2 = S.status().providers.find((x) => x.provider === 'polymarket');
  t('el contador de seguidos se reinicia', st2.memSkipsSeguidos === 0, st2.memSkipsSeguidos);
  t('pero el total histórico se conserva', st2.memSkips === 2, st2.memSkips);

  console.log('\n── el freno no roba el hueco al siguiente ciclo ───────────────────');
  RSS_MB = 3000;
  await S.runOnce('polymarket');
  t('un ciclo saltado no queda marcado como en curso', S.status().providers.find((x) => x.provider === 'polymarket').running === false);
  RSS_MB = 900;
  await S.runOnce('polymarket');
  t('así que el siguiente entra sin esperar', CICLOS === 4, { ciclos: CICLOS });

  process.memoryUsage = realMem;
  console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
  process.exit(ko ? 1 : 0);
})();
