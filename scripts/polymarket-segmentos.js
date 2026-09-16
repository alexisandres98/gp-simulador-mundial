#!/usr/bin/env node
// scripts/polymarket-segmentos.js — ¿ES `fútbol·No` UNA VENTAJA O UNA SELECCIÓN? (16-sep, D-1)
//
// ── LA PREGUNTA ────────────────────────────────────────────────────────────────────────────────────────
// De los cuatro candidatos a dinero del plan, `fútbol·No` de Polymarket es el único con muestra Y signo
// positivo: +175,48 sobre 113 posiciones, **con la comisión ya descontada** (`polyshadow` la resta en el
// propio `pnl`). Es también el único que queda en pie: C3 se cerró por margen, C5 se retiró por contrato y
// C2 está en revisión.
//
// Pero un segmento positivo entre diez no es un hallazgo: es lo que pasa cuando se parte un libro en diez
// y se mira el mejor. D-1 pide tres cosas, y son las tres que separan una ventaja de una selección:
//
//   1. **Remuestreo por EVENTO**, no por posición. Tres mercados del mismo partido —«gana el local»,
//      «gana el visitante», «empate»— no son tres observaciones: se mueven juntos. Con posiciones sueltas
//      el error estándar sale dividido por la raíz de un número que no es el que hay.
//   2. **Benjamini-Hochberg sobre los DIEZ segmentos**, no solo sobre el que gusta. Mirar diez y quedarse
//      con el mejor sin corregir es exactamente cómo se fabrica un descubrimiento falso.
//   3. **¿`Yes` y `No` son el mismo mercado visto de dos lados?** Si lo fueran, que uno gane lo que el otro
//      pierde es aritmética, no ventaja, y el «edge» sería puro sesgo de selección.
//
// USO
//   node scripts/polymarket-segmentos.js --libro /ruta/poly-export.json
//   node scripts/polymarket-segmentos.js --libro ... --json
'use strict';
const fs = require('fs');
const INF = require('../lib/inferencia');

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);

// El racimo es el PARTIDO. `evento` es el nombre del enfrentamiento y agrupa todos sus mercados.
const racimoDe = (p) => String(p.evento || p.pm_mid || p.senal_id || '?');
const segmentoDe = (p) => `${p.deporte || '?'}·${p.lado || '?'}`;

function analiza(posiciones, { q = 0.10, nMin = 30, replicas = 4000 } = {}) {
  const cerradas = (posiciones || []).filter((p) => Number.isFinite(p.pnl) && Number.isFinite(p.costo) && p.costo > 0);
  const porSeg = {};
  for (const p of cerradas) (porSeg[segmentoDe(p)] ||= []).push(p);

  const filas = [];
  for (const [seg, v] of Object.entries(porSeg)) {
    const costo = v.reduce((s, p) => s + p.costo, 0);
    const pnl = v.reduce((s, p) => s + p.pnl, 0);
    const racimos = new Set(v.map(racimoDe)).size;
    // ROI con remuestreo por racimo: se remuestrean PARTIDOS y dentro va lo que haya
    const bo = INF.roiIC(v, { beneficio: (p) => p.pnl, stake: (p) => p.costo, cluster: racimoDe, replicas });
    const roi = 100 * pnl / costo;
    const se = bo && Number.isFinite(bo.se_pct) ? bo.se_pct : null;
    const t = se > 0 ? roi / se : null;
    filas.push({ segmento: seg, n: v.length, racimos, costo: r2(costo), pnl: r2(pnl),
      roi_pct: r2(roi), se_pct: r2(se), ic: bo && bo.ic_pct ? [r2(bo.ic_pct[0]), r2(bo.ic_pct[1])] : null,
      t: r4(t), p: INF.pDeT(t, Math.max(0, racimos - 1)), suficiente: v.length >= nMin });
  }
  // BH sobre TODOS los segmentos con muestra, no solo sobre el que gusta
  const conMuestra = filas.filter((f) => f.suficiente && Number.isFinite(f.p));
  const ps = conMuestra.map((f) => f.p);
  const rech = ps.length ? new Set(INF.bh(ps, q).rechazadas) : new Set();
  conMuestra.forEach((f, i) => { f.significativa_bh = rech.has(i); });
  for (const f of filas) if (f.significativa_bh == null) f.significativa_bh = false;
  filas.sort((a, b) => (b.roi_pct ?? -1e9) - (a.roi_pct ?? -1e9));

  // ── ¿YES Y NO SON EL MISMO MERCADO? ───────────────────────────────────────────────────────────────────
  // Se mira por `pm_mid`, que es el identificador del MERCADO. Dos posiciones del mismo partido en mercados
  // distintos («gana el local» y «gana el visitante») están correlacionadas, pero no son la misma apuesta;
  // dos posiciones en el MISMO pm_mid con lados opuestos sí lo son.
  const fut = cerradas.filter((p) => p.deporte === 'futbol');
  const porMercado = {};
  for (const p of fut) (porMercado[String(p.pm_mid)] ||= { yes: [], no: [] })[p.lado === 'No' ? 'no' : 'yes'].push(p);
  const mercados = Object.entries(porMercado);
  const conLosDos = mercados.filter(([, v]) => v.yes.length && v.no.length);
  const complementariedad = {
    mercados_de_futbol: mercados.length,
    con_los_dos_lados: conLosDos.length,
    cuota_con_los_dos: r4(mercados.length ? conLosDos.length / mercados.length : 0),
    pnl_de_esos_mercados: r2(conLosDos.reduce((s, [, v]) => s + [...v.yes, ...v.no].reduce((x, p) => x + p.pnl, 0), 0)),
    veredicto: conLosDos.length / (mercados.length || 1) > 0.25
      ? 'OJO: una parte grande de los mercados se apostó por los dos lados, así que el signo de un lado es en buena medida el reflejo del otro'
      : 'Yes y No son casi siempre mercados DISTINTOS, así que el signo de uno no es el reflejo aritmético del otro',
  };
  // Y por si acaso: la suma de los dos lados del fútbol, que es lo que el plan pedía mirar
  const sumaFutbol = r2(fut.reduce((s, p) => s + p.pnl, 0));

  const no = filas.find((f) => f.segmento === 'futbol·No') || null;
  let veredicto, razon;
  if (!no || !no.suficiente) {
    veredicto = 'sin_muestra';
    razon = 'no hay suficientes posiciones cerradas en fútbol·No para juzgarlo.';
  } else if (!no.significativa_bh) {
    veredicto = 'NO_pasa_G1';
    razon = `fútbol·No rinde ${no.roi_pct} % sobre ${no.n} posiciones en ${no.racimos} partidos, pero con el `
      + `remuestreo por partido su t es ${no.t} y NO sobrevive a Benjamini-Hochberg junto a los otros `
      + `${conMuestra.length - 1} segmentos. Su intervalo es [${no.ic && no.ic[0]}, ${no.ic && no.ic[1]}] %: `
      + `incluye el cero. Con diez segmentos mirados, quedarse con el mejor sin corregir es como se fabrica `
      + `un descubrimiento falso, y corregido no queda nada.`;
  } else {
    veredicto = 'pasa_G1';
    razon = `fútbol·No rinde ${no.roi_pct} % sobre ${no.n} posiciones en ${no.racimos} partidos, t ${no.t}, `
      + `y SOBREVIVE a Benjamini-Hochberg junto a los otros segmentos. Intervalo [${no.ic && no.ic[0]}, `
      + `${no.ic && no.ic[1]}] %.`;
  }
  return { at: new Date().toISOString(), posiciones_cerradas: cerradas.length,
    regla: `ROI con remuestreo por PARTIDO (no por posición) y Benjamini-Hochberg al q = ${q} sobre los ${conMuestra.length} segmentos con al menos ${nMin} posiciones.`,
    veredicto, razon, tabla: filas, complementariedad, suma_de_los_dos_lados_de_futbol: sumaFutbol,
    comision: 'el pnl de cada posición ya viene NETO de comisión (propfirm/polyshadow.js la resta al liquidar)' };
}

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const f = arg('--libro');
  if (!f) { console.error('uso: node scripts/polymarket-segmentos.js --libro <export de picks-export?poly=1>'); process.exit(2); }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const inf = analiza(j.posiciones || j.rows || j);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(inf, null, 2)); process.exit(0); }
  console.log(`\nPOLYMARKET · LOS SEGMENTOS · ${inf.posiciones_cerradas} posiciones cerradas · ${inf.at.slice(0, 10)}\n`);
  console.log('segmento'.padEnd(16) + 'n'.padStart(5) + 'part.'.padStart(7) + 'costo'.padStart(10)
    + 'pnl'.padStart(10) + 'ROI%'.padStart(9) + 't'.padStart(8) + '  IC del ROI'.padEnd(22) + 'BH');
  for (const r of inf.tabla) {
    console.log(r.segmento.padEnd(16) + String(r.n).padStart(5) + String(r.racimos).padStart(7)
      + String(r.costo).padStart(10) + String(r.pnl).padStart(10) + String(r.roi_pct).padStart(9)
      + String(r.t ?? '—').padStart(8) + ('  ' + JSON.stringify(r.ic)).padEnd(22)
      + (r.significativa_bh ? 'SÍ' : r.suficiente ? '·' : 'n<30'));
  }
  console.log(`\ncomplementariedad: ${inf.complementariedad.con_los_dos_lados} de ${inf.complementariedad.mercados_de_futbol} mercados con los dos lados`);
  console.log(`  ${inf.complementariedad.veredicto}`);
  console.log(`  suma de los dos lados del fútbol: ${inf.suma_de_los_dos_lados_de_futbol}`);
  console.log(`\nVEREDICTO: ${inf.veredicto}\n${inf.razon}\n`);
}

module.exports = { analiza, racimoDe, segmentoDe };
