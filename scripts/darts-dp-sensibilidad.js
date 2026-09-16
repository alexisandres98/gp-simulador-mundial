#!/usr/bin/env node
// scripts/darts-dp-sensibilidad.js — LO QUE CUESTAN LAS DOS APROXIMACIONES DEL DP (16-sep-2026, A26)
//
// A26 de la auditoría externa señala dos aproximaciones en la política de dardos y pide medirlas. No son la
// misma cosa y conviene no mezclarlas:
//
// 1. EL ESTADO DEL BUST. La dinámica (el kernel de visita) devuelve un bust EXACTAMENTE al marcador con el
//    que empezó la visita, `r0`. La política, cuyo estado es (r, d), no conoce `r0` y lo aproxima con `r`,
//    el marcador antes de ese dardo. Coinciden solo si el bust cae en el primer dardo; en el segundo o el
//    tercero la política cree que fallar devuelve a donde está AHORA —ya habiendo puntuado— cuando en
//    realidad devuelve a donde estaba antes. Subestima el coste de fallar, y por tanto tira más agresivo
//    de lo que debería en los tramos de cierre. `policyExacta` amplía el estado a (r0, r, d) y lo resuelve
//    sin aproximar.
//
// 2. EL REDONDEO DE LA CLAVE DE CACHÉ. La política se cachea con `pT` redondeado a 0,1 y `pD` a 0,05. Dos
//    jugadores cuyo triple difiera en menos de 0,1 comparten política. Sin esa caché, la calibración por
//    bisección recomputa la DP en cada paso y ajustar un jugador cuesta minutos; con ella, la política
//    servida no es la del jugador sino la del jugador REDONDEADO.
//
// Este script mide las dos por separado sobre el objeto que de verdad importa: la distribución de visitas
// para cerrar un leg de 501, y de ahí la media de tres dardos y la tasa de 180s, que son los tres números
// con los que se precia cualquier familia de dardos.
//
// NO CAMBIA NADA. `GP_DARTS_DP_EXACTO=1` y `GP_DARTS_DP_FINO=1` existen para poder encenderlas; encenderlas
// cambia qué picks nacen y lo decide Alexis.
//
// Uso: node scripts/darts-dp-sensibilidad.js [--json]
'use strict';
const K = require('../darts-engine/kernel');

const JSON_OUT = process.argv.includes('--json');

// Cinco perfiles que cubren el circuito: de un jugador de clasificatorio a un top-4.
const PERFILES = [
  { nombre: 'clasificatorio',   media: 82 },
  { nombre: 'tour bajo',        media: 88 },
  { nombre: 'tour medio',       media: 94 },
  { nombre: 'top 32',           media: 99 },
  { nombre: 'top 4',            media: 104 },
];

// Resumen de un leg: visitas esperadas, media de tres dardos y 180s por leg.
function resumen(sk, opciones) {
  const pol = K.policyFor(sk, opciones);
  const leg = K.soloLeg(sk, { pol });
  if (!leg) return null;
  const visitas = leg.visits || [];
  let eV = 0, tot = 0;
  for (let k = 0; k < visitas.length; k++) { eV += k * visitas[k]; tot += visitas[k]; }
  const evis = tot > 0 ? eV / tot : null;
  return {
    visitas_esperadas: evis != null ? +evis.toFixed(4) : null,
    dardos_esperados: leg.eDarts != null ? +leg.eDarts.toFixed(4) : null,
    media_tres_dardos: leg.avg3 != null ? +leg.avg3.toFixed(3) : (evis ? +(501 / evis).toFixed(3) : null),
    p180_leg: leg.p180Leg != null ? +leg.p180Leg.toFixed(5) : null,
  };
}

function main() {
  const filas = [];
  for (const P of PERFILES) {
    let sk = null;
    try { const c = K.calibrate({ avg: P.media }); sk = c && (c.sk || c.skills || c); } catch { sk = null; }
    if (!sk || !Number.isFinite(sk.pT)) sk = null;
    if (!sk) { filas.push({ ...P, error: 'no se pudo calibrar el perfil' }); continue; }

    const aprox = resumen(sk, { exacto: false, fino: false });
    const exact = resumen(sk, { exacto: true, fino: false });
    const fino = resumen(sk, { exacto: false, fino: true });
    if (!aprox || !exact || !fino) { filas.push({ ...P, error: 'el kernel no devolvió leg' }); continue; }

    const dif = (a, b, k) => (a[k] != null && b[k] != null ? +(b[k] - a[k]).toFixed(4) : null);
    filas.push({
      ...P, sk: { pT: +sk.pT.toFixed(4), pD: +sk.pD.toFixed(4) },
      aprox, exacto: exact, fino,
      // el coste de cada aproximación, en la unidad que se lee: puntos de media de tres dardos
      coste_estado_bust_pts: dif(aprox, exact, 'media_tres_dardos'),
      coste_redondeo_pts: dif(aprox, fino, 'media_tres_dardos'),
      coste_estado_bust_visitas: dif(aprox, exact, 'visitas_esperadas'),
      coste_redondeo_visitas: dif(aprox, fino, 'visitas_esperadas'),
    });
  }

  if (JSON_OUT) { console.log(JSON.stringify({ at: new Date().toISOString(), filas }, null, 1)); return; }

  console.log('═══ SENSIBILIDAD DEL DP DE DARDOS (A26) ═══\n');
  console.log('perfil            media  │  aproximada   exacta(r0)   Δ      │  rejilla fina   Δ');
  console.log('                         │  media 3d     media 3d            │  media 3d');
  for (const f of filas) {
    if (f.error) { console.log(`${f.nombre.padEnd(17)} ${String(f.media).padStart(5)}  │  ${f.error}`); continue; }
    const c = (x) => (x == null ? '   —  ' : (x >= 0 ? '+' : '') + x.toFixed(3));
    console.log(`${f.nombre.padEnd(17)} ${String(f.media).padStart(5)}  │  ${String(f.aprox.media_tres_dardos).padStart(8)}   `
      + `${String(f.exacto.media_tres_dardos).padStart(8)}  ${c(f.coste_estado_bust_pts).padStart(7)}  │  `
      + `${String(f.fino.media_tres_dardos).padStart(8)}  ${c(f.coste_redondeo_pts).padStart(7)}`);
  }

  const val = (k) => filas.filter((f) => Number.isFinite(f[k])).map((f) => Math.abs(f[k]));
  const pico = (k) => (val(k).length ? Math.max(...val(k)) : null);
  console.log('\n── LECTURA ──');
  const pb = pico('coste_estado_bust_pts'), pr = pico('coste_redondeo_pts');
  console.log(`El estado del bust vale hasta ${pb == null ? '—' : pb.toFixed(3)} puntos de media de tres dardos.`);
  console.log(`El redondeo de la clave de caché vale hasta ${pr == null ? '—' : pr.toFixed(3)} puntos.`);
  console.log('\nPara ponerlo en contexto: la diferencia de media entre un top-4 y un jugador de tour medio son');
  console.log('unos 10 puntos, y el error de calibración de la propia base ronda el punto. Una aproximación');
  console.log('que cueste centésimas es ruido; una que cueste décimas entra en el listón de la familia,');
  console.log('porque el error de calibración se SUMA al listón (doctrina de goal-engine/mitades.js).');
  console.log('\nNada de esto está encendido. GP_DARTS_DP_EXACTO=1 / GP_DARTS_DP_FINO=1 lo encienden, y');
  console.log('encenderlo cambia la política, la distribución de visitas y el precio de cada familia.');
}

if (require.main === module) main();
module.exports = { resumen, PERFILES };
