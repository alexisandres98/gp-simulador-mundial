#!/usr/bin/env node
// scripts/darts-censura.js — LA MEDIA QUE CALIBRAMOS NO ES LA MEDIA QUE OBSERVAMOS (16-sep-2026, A27)
//
// EL DESAJUSTE. `calibrate()` busca el `pT` que hace que `soloLeg()` reproduzca la media de tres dardos
// observada. `soloLeg()` simula un jugador SOLO ante el 501: siempre llega a cero, siempre tira el
// checkout. Las medias que observamos —Darts Orakel, la PDC— se calculan sobre PARTIDOS, donde la mitad de
// los legs se PIERDEN: el que pierde deja de tirar cuando el rival cierra, y nunca tira ese checkout.
//
// O sea, se está calibrando contra un objetivo censurado de forma distinta a como lo genera el simulador.
// Dos efectos empujan en direcciones opuestas y por eso hay que medirlo en vez de razonarlo:
//
//   · la VISITA DE CHECKOUT suele puntuar poco (se tira a un doble) pero con MENOS de tres dardos, y la
//     media se calcula puntos/dardos×3 — así que suele SUBIR la media del leg ganado;
//   · el leg PERDIDO se corta en un punto arbitrario, sin checkout, así que es media de puro scoring.
//
// Este script simula partidos reales entre dos jugadores calibrados, calcula la media como la calcularía
// la fuente —puntos totales entre dardos totales, mezclando legs ganados y perdidos— y la compara con el
// `avg3` de `soloLeg` que es lo que hoy se persigue.
//
// NO CAMBIA NADA. Si el sesgo resulta material, corregir el objetivo de calibración cambia `pT` de todos
// los jugadores y con él el precio de todas las familias: eso lo decide Alexis.
//
// Uso: node scripts/darts-censura.js [--legs 4000] [--json]
'use strict';
const K = require('../darts-engine/kernel');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LEGS = +arg('--legs', 4000);
const JSON_OUT = argv.includes('--json');

// generador sembrado: el mismo libro en cualquier máquina
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(16807, s) % 2147483647) >>> 0; return (s - 1) / 2147483646; }; }

const PERFILES = [
  { nombre: 'clasificatorio', media: 82 },
  { nombre: 'tour bajo', media: 88 },
  { nombre: 'tour medio', media: 94 },
  { nombre: 'top 32', media: 99 },
  { nombre: 'top 4', media: 104 },
];

// La media como la calcula la fuente: puntos anotados entre dardos tirados, por 3. Se acumula por jugador
// a lo largo de muchos legs, ganados y perdidos, alternando quién sale — que es como se juega de verdad.
function mediaObservada(skA, skB, { legs = LEGS, semilla = 20260916 } = {}) {
  const r = rng(semilla);
  const acc = { a: { pts: 0, darts: 0, ganados: 0 }, b: { pts: 0, darts: 0, ganados: 0 } };
  for (let i = 0; i < legs; i++) {
    const starter = i % 2 === 0 ? 'a' : 'b';
    const leg = K.sampleLeg(skA, skB, { starter, rng: r });
    if (!leg || !leg.visits) continue;
    for (const v of leg.visits) {
      const o = acc[v.who];
      o.pts += v.scored; o.darts += v.darts;
    }
    if (leg.winner) acc[leg.winner].ganados++;
  }
  const med = (o) => (o.darts > 0 ? 3 * o.pts / o.darts : null);
  return { a: med(acc.a), b: med(acc.b), acc, legs };
}

function main() {
  const filas = [];
  for (const P of PERFILES) {
    let c = null;
    try { c = K.calibrate({ avg: P.media }); } catch { c = null; }
    if (!c || !c.sk) { filas.push({ ...P, error: 'no se pudo calibrar' }); continue; }
    // el rival es un jugador de la media MEDIANA del circuito: lo que importa es que el leg se corte, y se
    // corta porque hay rival, no porque el rival sea uno concreto
    let riv = null;
    try { riv = K.calibrate({ avg: 94 }); } catch { riv = null; }
    if (!riv || !riv.sk) { filas.push({ ...P, error: 'no se pudo calibrar el rival' }); continue; }

    const obs = mediaObservada(c.sk, riv.sk);
    const solo = c.leg && c.leg.avg3;
    const censurada = obs.a;
    filas.push({
      ...P,
      objetivo_pedido: P.media,
      media_solo_leg: solo != null ? +solo.toFixed(3) : null,         // lo que hoy se persigue
      media_censurada: censurada != null ? +censurada.toFixed(3) : null, // lo que la fuente mediría
      sesgo_pts: (solo != null && censurada != null) ? +(censurada - solo).toFixed(3) : null,
      legs_ganados_pct: +(100 * obs.acc.a.ganados / obs.legs).toFixed(1),
    });
  }

  if (JSON_OUT) { console.log(JSON.stringify({ at: new Date().toISOString(), legs: LEGS, filas }, null, 1)); return; }

  console.log('═══ LA CENSURA DEL LEG EN LA CALIBRACIÓN DE DARDOS (A27) ═══\n');
  console.log(`${LEGS} legs por perfil contra un rival de 94 de media.\n`);
  console.log('perfil            pedida   solo-leg   censurada   sesgo    legs ganados');
  for (const f of filas) {
    if (f.error) { console.log(`${f.nombre.padEnd(17)} ${f.error}`); continue; }
    const s = f.sesgo_pts == null ? '  —  ' : (f.sesgo_pts >= 0 ? '+' : '') + f.sesgo_pts.toFixed(3);
    console.log(`${f.nombre.padEnd(17)} ${String(f.objetivo_pedido).padStart(6)}   ${String(f.media_solo_leg).padStart(8)}   `
      + `${String(f.media_censurada).padStart(9)}   ${s.padStart(7)}   ${String(f.legs_ganados_pct).padStart(6)} %`);
  }

  const ses = filas.filter((f) => Number.isFinite(f.sesgo_pts)).map((f) => f.sesgo_pts);
  const pico = ses.length ? Math.max(...ses.map(Math.abs)) : null;
  const medio = ses.length ? ses.reduce((a, b) => a + b, 0) / ses.length : null;
  console.log('\n── LECTURA ──');
  console.log(`Sesgo medio ${medio == null ? '—' : (medio >= 0 ? '+' : '') + medio.toFixed(3)} puntos · pico ${pico == null ? '—' : pico.toFixed(3)}.`);
  console.log('\nEl objetivo de calibración es la media de un leg que SIEMPRE se termina; la fuente mide partidos,');
  console.log('donde la mitad de los legs se pierden y el que pierde nunca tira el checkout. Si el sesgo es de');
  console.log('centésimas, la censura es irrelevante y A27 se cierra. Si es de décimas o más, `calibrate()`');
  console.log('está persiguiendo el número equivocado y todos los pT salen desplazados en la misma dirección.');
  console.log('\nContexto: el error de calibración de la propia base ronda EL PUNTO, y las dos aproximaciones');
  console.log('del DP medidas hoy valen 0,026 y 0,017 puntos (scripts/darts-dp-sensibilidad.js).');
  console.log('\nESTE SCRIPT NO CAMBIA NADA. Cambiar el objetivo mueve el pT de todos los jugadores.');
}

if (require.main === module) main();
module.exports = { mediaObservada, PERFILES };
