#!/usr/bin/env node
// scripts/mitades-condicional.js — ¿LA SEGUNDA MITAD DEPENDE DEL MARCADOR DE LA PRIMERA? (16-sep-2026, A22)
//
// LA PREGUNTA, Y POR QUÉ NO ES RETÓRICA. `goal-engine/mitades.js` convoluciona las dos mitades como
// INDEPENDIENTES, y lo justifica con una correlación 1T↔2T de 0,05 medida sobre 33 mil partidos. Ese 0,05
// es la correlación entre los GOLES de una mitad y los de la otra, y es de verdad pequeña.
//
// Pero A22 señala otra cosa, y no es la misma: lo que puede depender del descanso no es el NÚMERO de goles
// de la primera parte sino el MARCADOR — ir ganando 2-0 o ir perdiendo 0-2 cambia cómo se juega la segunda
// mitad de formas que se cancelan en una correlación lineal de totales. El que gana se echa atrás; el que
// pierde se abre. El total puede quedar igual y el REPARTO cambiar mucho.
//
// Y eso sí toca dos familias que publicamos: `h2_1x2`, `h2_ah` y sobre todo `htft` —descanso/final—, cuyo
// error declarado (0,047) ya dice que «el modelo no ve las remontadas».
//
// CÓMO SE MIDE. Se comparan tres cosas para cada estado al descanso:
//   · la tasa de gol de cada equipo en la segunda mitad, OBSERVADA, condicionada a ese estado;
//   · la que predice el modelo independiente: λ_2T = λ_partido × (1 − 0,446), la misma para todos los
//     estados por construcción;
//   · y el desvío entre las dos, con su intervalo por bootstrap sobre partidos.
// Para que la comparación sea justa, λ del partido se resuelve del CIERRE (igual que hizo la validación
// original), no del modelo: así lo que se mide es la condicionalidad y no el error del modelo encima.
//
// NO CAMBIA NADA. Si sale que la condicionalidad es material, la decisión de modelar la segunda mitad
// condicionada —y de qué manera— es de Alexis.
//
// Uso: node scripts/mitades-condicional.js [--desde 2122] [--json <salida>] [--div E0,SP1,...]
'use strict';
const fs = require('fs');
const path = require('path');
const INF = require('../lib/inferencia');
const M = require('../goal-engine/mitades');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SALIDA = arg('--json', null);
const TEMPS = (arg('--temporadas', '2122,2223,2324,2425,2526')).split(',');
const DIVS = (arg('--div', 'E0,E1,SP1,SP2,I1,I2,D1,D2,F1,F2,N1,B1,P1,T1,G1,SC0')).split(',');

const UA = 'Mozilla/5.0 (compatible; GPSimulador/1.0; +https://gpsimulador.com)';

async function bajaCsv(temp, div) {
  const url = `https://www.football-data.co.uk/mmz4281/${temp}/${div}.csv`;
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function parseCsv(txt) {
  const lineas = String(txt || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const cab = lineas[0].split(',');
  const out = [];
  for (let i = 1; i < lineas.length; i++) {
    const c = lineas[i].split(',');
    const o = {};
    for (let j = 0; j < cab.length; j++) o[cab[j]] = c[j];
    out.push(o);
  }
  return out;
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

// ── λ DEL CIERRE ────────────────────────────────────────────────────────────────────────────────────────
// Mismo método que la validación original: el 1X2 sin vig da el reparto, el over/under 2,5 sin vig da el
// ritmo, y de ahí salen λ_local y λ_visita por búsqueda. Se usa el cierre de Pinnacle (PSCH/PSCD/PSCA) y,
// cuando no está, la media del mercado (AvgCH…). Sin las dos cosas, el partido no entra.
function sinVig(qs) { const s = qs.reduce((a, b) => a + b, 0); return s > 0 ? qs.map((q) => q / s) : null; }

function poisson(l, k) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }
function probs(lh, la, { n = 10 } = {}) {
  let ph = 0, pd = 0, pa = 0, over = 0;
  for (let h = 0; h <= n; h++) for (let a = 0; a <= n; a++) {
    const p = poisson(lh, h) * poisson(la, a);
    if (h > a) ph += p; else if (h === a) pd += p; else pa += p;
    if (h + a > 2.5) over += p;
  }
  return { ph, pd, pa, over };
}

// Resuelve (λh, λa) que reproducen la probabilidad de local y la de más de 2,5. Dos ecuaciones, dos
// incógnitas: se busca el total por bisección sobre `over` y el reparto por bisección sobre `ph`.
function lambdasDelCierre(pHome, pOver) {
  if (!(pHome > 0 && pHome < 1) || !(pOver > 0 && pOver < 1)) return null;
  let lo = 0.4, hi = 8;
  for (let i = 0; i < 50; i++) {
    const tot = (lo + hi) / 2;
    // dentro de cada total, el reparto que reproduce pHome
    let rlo = 0.05, rhi = 0.95;
    for (let j = 0; j < 40; j++) {
      const r = (rlo + rhi) / 2;
      const p = probs(tot * r, tot * (1 - r));
      if (p.ph < pHome) rlo = r; else rhi = r;
    }
    const r = (rlo + rhi) / 2;
    const p = probs(tot * r, tot * (1 - r));
    if (p.over < pOver) lo = tot; else hi = tot;
  }
  const tot = (lo + hi) / 2;
  let rlo = 0.05, rhi = 0.95;
  for (let j = 0; j < 40; j++) {
    const r = (rlo + rhi) / 2;
    const p = probs(tot * r, tot * (1 - r));
    if (p.ph < pHome) rlo = r; else rhi = r;
  }
  const r = (rlo + rhi) / 2;
  return { lh: tot * r, la: tot * (1 - r), total: tot };
}

// ── EL ESTADO AL DESCANSO ───────────────────────────────────────────────────────────────────────────────
// Se agrupa por DIFERENCIA, no por marcador exacto: 2-0 y 3-1 son el mismo estado táctico y separarlos
// parte la muestra sin ganar nada. Los extremos se juntan porque más allá de ±2 hay muy pocos partidos.
function estadoDe(hthg, htag) {
  const d = hthg - htag;
  if (d <= -2) return 'local pierde por 2+';
  if (d === -1) return 'local pierde por 1';
  if (d === 0) return hthg === 0 ? 'empate a 0' : 'empate con goles';
  if (d === 1) return 'local gana por 1';
  return 'local gana por 2+';
}
const ORDEN = ['local pierde por 2+', 'local pierde por 1', 'empate a 0', 'empate con goles', 'local gana por 1', 'local gana por 2+'];

async function main() {
  const filas = [];
  let bajados = 0, fallidos = 0;
  for (const t of TEMPS) {
    for (const d of DIVS) {
      const txt = await bajaCsv(t, d);
      if (!txt) { fallidos++; continue; }
      bajados++;
      for (const r of parseCsv(txt)) {
        const fthg = num(r.FTHG), ftag = num(r.FTAG), hthg = num(r.HTHG), htag = num(r.HTAG);
        if (fthg == null || ftag == null || hthg == null || htag == null) continue;
        // cierre: Pinnacle primero, media del mercado de respaldo
        const h = num(r.PSCH) || num(r.AvgCH) || num(r.PSH) || num(r.AvgH);
        const dr = num(r.PSCD) || num(r.AvgCD) || num(r.PSD) || num(r.AvgD);
        const a = num(r.PSCA) || num(r.AvgCA) || num(r.PSA) || num(r.AvgA);
        const o25 = num(r['AvgC>2.5']) || num(r['Avg>2.5']) || num(r['BbAv>2.5']);
        const u25 = num(r['AvgC<2.5']) || num(r['Avg<2.5']) || num(r['BbAv<2.5']);
        if (!(h > 1 && dr > 1 && a > 1 && o25 > 1 && u25 > 1)) continue;
        const p1x2 = sinVig([1 / h, 1 / dr, 1 / a]);
        const pou = sinVig([1 / o25, 1 / u25]);
        if (!p1x2 || !pou) continue;
        const L = lambdasDelCierre(p1x2[0], pou[0]);
        if (!L || !(L.lh > 0) || !(L.la > 0)) continue;
        filas.push({ div: d, temp: t, hthg, htag, h2h: fthg - hthg, h2a: ftag - htag,
          lh2: L.lh * (1 - M.CUOTA_1T), la2: L.la * (1 - M.CUOTA_1T),
          estado: estadoDe(hthg, htag) });
      }
    }
  }

  const salida = { at: new Date().toISOString(), ficheros: bajados, fallidos, n: filas.length,
    cuota_1t: M.CUOTA_1T, estados: [] };

  if (!filas.length) {
    console.error('no se bajó ningún fichero utilizable');
    if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1));
    process.exit(1);
  }

  console.log('═══ ¿LA SEGUNDA MITAD DEPENDE DEL MARCADOR AL DESCANSO? (A22) ═══\n');
  console.log(`${filas.length.toLocaleString('es')} partidos · ${bajados} ficheros (${fallidos} no disponibles)`);
  console.log(`λ del CIERRE (no del modelo), mitad = λ × (1 − ${M.CUOTA_1T})\n`);
  console.log('estado al descanso        n      goles 2T local           goles 2T visitante');
  console.log('                              obs   pred    desvío     obs   pred    desvío');

  for (const e of ORDEN) {
    const sub = filas.filter((f) => f.estado === e);
    if (sub.length < 200) { salida.estados.push({ estado: e, n: sub.length, muestra_corta: true }); continue; }
    const bh = INF.bootstrapClusters(sub, { valor: (f) => f.h2h - f.lh2, cluster: (f, i) => 'p' + i, replicas: 1500, semilla: 20260916 });
    const ba = INF.bootstrapClusters(sub, { valor: (f) => f.h2a - f.la2, cluster: (f, i) => 'p' + i, replicas: 1500, semilla: 20260917 });
    const obsH = sub.reduce((s, f) => s + f.h2h, 0) / sub.length;
    const preH = sub.reduce((s, f) => s + f.lh2, 0) / sub.length;
    const obsA = sub.reduce((s, f) => s + f.h2a, 0) / sub.length;
    const preA = sub.reduce((s, f) => s + f.la2, 0) / sub.length;
    const fila = { estado: e, n: sub.length,
      local: { obs: +obsH.toFixed(4), pred: +preH.toFixed(4), desvio: bh.media, ic: bh.ic, t: bh.t },
      visita: { obs: +obsA.toFixed(4), pred: +preA.toFixed(4), desvio: ba.media, ic: ba.ic, t: ba.t } };
    salida.estados.push(fila);
    const f3 = (x) => (x == null ? '  —  ' : (x >= 0 ? '+' : '') + x.toFixed(3));
    console.log(`${e.padEnd(24)} ${String(sub.length).padStart(5)}   ${obsH.toFixed(3)}  ${preH.toFixed(3)}  ${f3(bh.media)} (t ${bh.t == null ? '—' : bh.t.toFixed(1)})`
      + `   ${obsA.toFixed(3)}  ${preA.toFixed(3)}  ${f3(ba.media)} (t ${ba.t == null ? '—' : ba.t.toFixed(1)})`);
  }

  // ── LA LECTURA ────────────────────────────────────────────────────────────────────────────────────────
  const conDato = salida.estados.filter((x) => x.local && Number.isFinite(x.local.t));
  const fuertes = conDato.filter((x) => Math.abs(x.local.t) >= 3 || Math.abs(x.visita.t) >= 3);
  // el rango de desvío entre estados: si el modelo independiente valiera, todos los estados se desviarían
  // lo mismo (un sesgo global) en vez de en direcciones distintas
  const desvH = conDato.map((x) => x.local.desvio).filter(Number.isFinite);
  const desvA = conDato.map((x) => x.visita.desvio).filter(Number.isFinite);
  const rango = (a) => (a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(4) : null);
  salida.rango_desvio_local = rango(desvH);
  salida.rango_desvio_visita = rango(desvA);
  salida.estados_con_desvio_fuerte = fuertes.map((x) => x.estado);

  console.log('\n── LECTURA ──');
  console.log(`Estados con desvío fuerte (|t| ≥ 3): ${fuertes.length ? fuertes.map((x) => x.estado).join(', ') : 'ninguno'}`);
  console.log(`Rango del desvío entre estados: local ${salida.rango_desvio_local} goles · visitante ${salida.rango_desvio_visita} goles.`);
  console.log('\nUn SESGO GLOBAL —todos los estados desviándose lo mismo— sería un problema de la cuota 0,446 y se');
  console.log('arreglaría cambiando la constante. Lo que invalidaría la independencia es que el desvío CAMBIE DE');
  console.log('SIGNO entre estados: que el que va ganando marque menos de lo previsto y el que va perdiendo más.');
  console.log('Ese es el número que hay que mirar, y es el rango de arriba.');
  console.log('\nESTE SCRIPT NO CAMBIA NADA. Modelar la segunda mitad condicionada es una decisión de Alexis.');

  if (SALIDA) { fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1)); console.log(`\nEscrito ${SALIDA}`); }
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { lambdasDelCierre, estadoDe, parseCsv };
