#!/usr/bin/env node
// scripts/cards-contrato.js — T2.1 DE LA AUDITORÍA EXTERNA (15-sep-2026).
//
// EL HALLAZGO QUE OBLIGA A ESCRIBIR ESTO. El reglamento de Cloudbet (Booking Markets, copia literal en
// `docs/CONTRATOS_CASA.md`) dice:
//
//   «Yellow card counts as 1 card and red or yellow-red card as 2. The 2nd yellow for one player which
//    leads to a yellow red card is not considered. As a consequence one player cannot cause more than 3
//    cards. Settlement will be made according to all available evidence of cards shown during the regular
//    90 minutes play. Cards shown after the match are not considered. Cards for non-players (already
//    substituted players, managers, players on bench) are not considered.»
//
// NOSOTROS CONTAMOS OTRA COSA. El modelo se ajusta y el libro se liquida con `amarillas + rojas` sumadas
// como CONTEOS (`prop-engine/model.js` y `settleClubPropsViaAf` en server.js). Una roja directa vale 1 para
// nosotros y 2 para la casa. La consecuencia no es académica: contamos de menos, así que el modelo cree que
// el under es más probable de lo que la casa va a liquidar. En la única familia con dinero real.
//
// Este script mide el tamaño del hueco sobre 10.000 partidos de clubes y lo traduce a lo único que importa:
// cuántos puntos porcentuales de probabilidad de under se evaporan en 4,5 · 5,5 · 6,5.
//
// LOS DOS LÍMITES. Los datos de API-Football traen `yellows` y `reds` agregados por equipo, sin decir cuáles
// de las rojas vienen de doble amarilla. Eso deja el conteo de la casa entre dos límites exactos:
//   · si TODAS las rojas fueran dobles amarillas → la casa cuenta lo mismo que nosotros (1 + 2 = 3 = 2 + 1).
//   · si TODAS fueran rojas directas → la casa cuenta uno más por cada roja.
// El verdadero está en medio y se puede estrechar con la proporción de rojas directas de la liga.
//
// Uso: node scripts/cards-contrato.js --dir <carpeta con props-history-*.json> [--directas 0.55]
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../lib/conteos');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = arg('--dir', process.env.GP_CLUB_DATA_DIR || path.join(__dirname, '..', 'data', 'clubs'));
// Proporción de rojas que son DIRECTAS (no doble amarilla). Por defecto 0,55, que es el orden de magnitud
// habitual en ligas europeas. Es un parámetro, no un dato: por eso se enseñan también los dos límites.
const DIRECTAS = Number(arg('--directas', '0.55'));
const LINEAS = [4.5, 5.5, 6.5];

function carga() {
  const files = fs.readdirSync(DIR).filter((f) => /^props-history-.*\.json$/.test(f));
  const filas = [];
  for (const f of files) {
    const liga = f.replace(/^props-history-/, '').replace(/\.json$/, '');
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const m of (j.matches || [])) {
      if (m.et || !m.home || !m.away) continue;
      if (m.home.yellows == null && m.away.yellows == null) continue;
      const am = (Number(m.home.yellows) || 0) + (Number(m.away.yellows) || 0);
      const ro = (Number(m.home.reds) || 0) + (Number(m.away.reds) || 0);
      filas.push({ liga, fecha: (m.date || '').slice(0, 10), am, ro, nuestro: am + ro });
    }
  }
  return filas;
}

function main() {
  const filas = carga();
  const n = filas.length;
  const conRoja = filas.filter((f) => f.ro > 0).length;
  const rojas = filas.reduce((s, f) => s + f.ro, 0);

  console.log('═══ CONTRATO DE TARJETAS: LO QUE CONTAMOS vs LO QUE LIQUIDA CLOUDBET ═══\n');
  console.log(`Partidos (90', sin prórroga): ${n}   con al menos una roja: ${conRoja} (${(100 * conRoja / n).toFixed(2)} %)`);
  console.log(`Rojas totales: ${rojas}   por partido: ${(rojas / n).toFixed(4)}\n`);

  // Los tres conteos sobre las MISMAS filas.
  const cuentas = {
    nuestro: filas.map((f) => f.nuestro),                       // amarillas + rojas (lo que hacemos hoy)
    limite_bajo: filas.map((f) => f.nuestro),                   // todas las rojas serían dobles amarillas
    central: filas.map((f) => f.nuestro + f.ro * DIRECTAS),     // proporción de rojas directas
    limite_alto: filas.map((f) => f.nuestro + f.ro),            // todas las rojas serían directas
  };

  console.log('─── Media del conteo ───');
  for (const k in cuentas) {
    const m = C.momentos(cuentas[k]);
    console.log(`  ${k.padEnd(12)} media ${m.media.toFixed(4)}   varianza ${m.varianza.toFixed(4)}`);
  }

  console.log('\n─── P(under) REAL en cada conteo, sobre los mismos partidos ───');
  console.log('línea   nuestro   límite alto   central        pérdida vs nuestro (pp)');
  const perdida = {};
  for (const l of LINEAS) {
    const p = (arr) => arr.filter((v) => v < l).length / n;
    const pn = p(cuentas.nuestro), pa = p(cuentas.limite_alto), pc = p(cuentas.central);
    perdida[l] = { alto: (pn - pa) * 100, central: (pn - pc) * 100 };
    console.log(`${String(l).padStart(5)}   ${pn.toFixed(4)}    ${pa.toFixed(4)}        ${pc.toFixed(4)}         ` +
      `alto ${((pn - pa) * 100).toFixed(2)}  ·  central ${((pn - pc) * 100).toFixed(2)}`);
  }

  console.log('\n─── QUÉ SIGNIFICA EN DINERO ───');
  console.log('El under se cobra a cuota ~1,8-2,0. A 1,91 el punto de equilibrio es 52,36 % de aciertos.');
  for (const l of LINEAS) {
    const pn = cuentas.nuestro.filter((v) => v < l).length / n;
    const pa = cuentas.limite_alto.filter((v) => v < l).length / n;
    const ev = (p) => 1.91 * p - 1;
    console.log(`  línea ${l}: creemos EV ${(100 * ev(pn)).toFixed(2)} % y en el peor caso es ` +
      `${(100 * ev(pa)).toFixed(2)} %  → se evaporan ${(100 * (ev(pn) - ev(pa))).toFixed(2)} puntos de EV`);
  }

  // Por liga: dónde duele más. Las ligas con más rojas son las que más nos engañan, y son justo las
  // sudamericanas, donde el ejecutor real ha estado apostando.
  const porLiga = {};
  for (const f of filas) {
    const o = porLiga[f.liga] || (porLiga[f.liga] = { n: 0, ro: 0, nuestro: [], alto: [] });
    o.n++; o.ro += f.ro; o.nuestro.push(f.nuestro); o.alto.push(f.nuestro + f.ro);
  }
  const tabla = Object.entries(porLiga).map(([lg, o]) => {
    const p = (arr) => arr.filter((v) => v < 5.5).length / o.n;
    return { lg, n: o.n, rojas_por_partido: o.ro / o.n, perdida_pp: (p(o.nuestro) - p(o.alto)) * 100 };
  }).filter((r) => r.n >= 100).sort((a, b) => b.perdida_pp - a.perdida_pp);

  console.log('\n─── LAS DIEZ LIGAS DONDE MÁS SE PIERDE (línea 5,5, límite alto) ───');
  console.log('liga             n     rojas/partido   P(under) que se evapora (pp)');
  for (const r of tabla.slice(0, 10)) {
    console.log(`${r.lg.padEnd(16)} ${String(r.n).padStart(5)}   ${r.rojas_por_partido.toFixed(4)}          ${r.perdida_pp.toFixed(2)}`);
  }
  console.log('\n─── Y LAS CINCO DONDE MENOS ───');
  for (const r of tabla.slice(-5)) {
    console.log(`${r.lg.padEnd(16)} ${String(r.n).padStart(5)}   ${r.rojas_por_partido.toFixed(4)}          ${r.perdida_pp.toFixed(2)}`);
  }

  console.log('\n─── LO QUE ESTE SCRIPT NO PUEDE RESOLVER ───');
  console.log('1. Qué proporción de las rojas son directas. Los agregados de API-Football no lo dicen; hace');
  console.log('   falta el detalle de eventos (data/fotmob-events.json lo tiene para el Mundial, no para clubes).');
  console.log('2. Si API-Football cuenta las tarjetas del banquillo y del cuerpo técnico, que la casa NO cuenta.');
  console.log('   Ese error va en la dirección CONTRARIA y podría compensar parte del anterior.');
  console.log('3. Las dos se cierran igual: comparando 40 liquidaciones REALES de Cloudbet con nuestro conteo.');
  console.log('   Hasta entonces, el límite alto es la hipótesis prudente y la que manda para decidir.');
}

if (require.main === module) main();
module.exports = { carga, LINEAS };
