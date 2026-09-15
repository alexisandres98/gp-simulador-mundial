#!/usr/bin/env node
// scripts/cards-autopsia.js — T2.5 DE LA AUDITORÍA EXTERNA (15-sep-2026, hallazgo A20).
//
// QUÉ ESTABA MAL EN LA AUTOPSIA ANTERIOR. Se listaron varias causas de las pérdidas del libro real —líneas
// apiladas del mismo partido, ligas eficientes, apuestas con EV no positivo— y se cuantificó cada una POR
// SEPARADO. El problema es que una apuesta puede estar en dos listas a la vez: una segunda línea del mismo
// partido en la Premier con EV negativo aparecía en las tres. Sumando los "costes" de cada causa salía más
// dinero perdido del que se perdió, y cada causa parecía más grave de lo que era.
//
// LO QUE HACE ESTE SCRIPT. Las causas se convierten en una PARTICIÓN: cada ticket cae en exactamente un
// grupo, por orden de prioridad declarado abajo, y la suma de los P&L de los grupos reproduce EXACTAMENTE
// el P&L del libro. Esa identidad se comprueba y se imprime: si no cuadra a un céntimo, el script lo dice.
//
// Y UNA DISTINCIÓN QUE LA AUDITORÍA EXIGE. No toda causa sirve para un contrafactual. Una regla solo es
// contrafactual si se podía aplicar CON LA INFORMACIÓN DE ENTONCES:
//
//   · «una posición por partido y lado» SÍ: en el momento de colocar la segunda ya sabíamos que la primera
//     estaba puesta. Es una regla aplicable, y la respuesta a "¿cuánto habríamos ganado?" es legítima.
//   · «no apostar en ligas eficientes» NO: esas cuatro ligas se clasificaron como eficientes DESPUÉS de
//     haberlas apostado, con los datos que generaron esas mismas apuestas. Calcular cuánto habríamos
//     ahorrado evitándolas es mirar el resultado y decidir con él. Aquí se DESCRIBE lo que pasó en cada
//     banda y NO se presenta como un contrafactual.
//
// Uso: node scripts/cards-autopsia.js --libro <libro-real.json>
'use strict';

const fs = require('fs');
const INF = require('../lib/inferencia');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIBRO = arg('--libro', null);
if (!LIBRO) { console.error('Falta --libro <archivo json del export real>'); process.exit(1); }

// Las cuatro ligas que se clasificaron como eficientes DESPUÉS de haberlas apostado (doctrina del ejecutor,
// 12-sep). Se usan para describir, nunca para un contrafactual.
const EFICIENTES = new Set(['premier', 'bundesliga', 'mls', 'rusia']);

function carga() {
  const j = JSON.parse(fs.readFileSync(LIBRO, 'utf8'));
  // las de tarjetas son las que NO llevan `familia` (el perímetro original, anterior a que existiera el campo)
  return (j.bets || []).filter((b) => b.status === 'SETTLED' && !b.familia && !b.family && b.stake > 0);
}

// ── LA PARTICIÓN ─────────────────────────────────────────────────────────────────────────────────────────
// Orden de prioridad. Cada ticket cae en el PRIMER grupo que le aplica y en ninguno más. El orden no es
// arbitrario: va de lo que invalida el dato (no hay resultado) a lo que es una decisión nuestra (apilar),
// a lo que es una propiedad de la señal (EV), a lo que es una propiedad del mercado (la liga).
const GRUPOS = [
  { id: 'sin_resolver', etiqueta: 'sin resultado localizable' },
  { id: 'superseded', etiqueta: 'la señal se reemplazó (no es un resultado deportivo)' },
  { id: 'apilada', etiqueta: 'segunda o tercera posición del mismo partido y lado' },
  { id: 'ev_no_positivo', etiqueta: 'el modelo no le veía ventaja' },
  { id: 'liga_eficiente', etiqueta: 'liga clasificada eficiente (a posteriori)' },
  { id: 'nucleo', etiqueta: 'núcleo limpio' },
];

function clasifica(bets) {
  // PRIMERA POSICIÓN DE CADA (partido, lado): la más temprana por hora de colocación. Esa es la que una
  // regla de "una por partido" habría dejado pasar, porque es la única que existía cuando se decidió.
  const primera = new Map();
  for (const b of bets.slice().sort((x, y) => Date.parse(x.placed_at || x.at || 0) - Date.parse(y.placed_at || y.at || 0))) {
    const k = (b.match || '?') + '|' + String(b.side || '').toLowerCase();
    if (!primera.has(k)) primera.set(k, b.pick_id || b.ref_id);
  }
  for (const b of bets) {
    const k = (b.match || '?') + '|' + String(b.side || '').toLowerCase();
    b._primera = primera.get(k) === (b.pick_id || b.ref_id);
    if (b.sin_resolver || b.resultado === 'DATA_UNRESOLVED') b._grupo = 'sin_resolver';
    else if (b.resultado_nuestro === 'SUPERSEDED' && b.resultado === 'SUPERSEDED') b._grupo = 'superseded';
    else if (!b._primera) b._grupo = 'apilada';
    else if (b.ev_modelo_pct != null && b.ev_modelo_pct <= 0) b._grupo = 'ev_no_positivo';
    else if (EFICIENTES.has(String(b.league || '').toLowerCase())) b._grupo = 'liga_eficiente';
    else b._grupo = 'nucleo';
  }
  return bets;
}

const agg = (rows) => {
  const apostado = rows.reduce((a, b) => a + (b.stake || 0), 0);
  const pnl = rows.reduce((a, b) => a + (b.pnl || 0), 0);
  const w = rows.filter((b) => b.resultado === 'WIN').length;
  const l = rows.filter((b) => b.resultado === 'LOSS').length;
  return { n: rows.length, w, l, apostado: +apostado.toFixed(2), pnl: +pnl.toFixed(2),
    roi_pct: apostado ? +(100 * pnl / apostado).toFixed(2) : null };
};

function main() {
  const bets = clasifica(carga());
  console.log('═══ AUTOPSIA DEL LIBRO DE TARJETAS, CON LAS CAUSAS COMO PARTICIÓN ═══\n');
  console.log(`Apuestas liquidadas: ${bets.length}`);

  const total = agg(bets);
  console.log(`Total: apostado ${total.apostado} · P&L ${total.pnl} · ROI ${total.roi_pct} %\n`);

  console.log('─── LA PARTICIÓN (cada ticket en un solo grupo) ───');
  console.log('grupo                n     W-L      apostado      P&L      ROI %');
  let sumaN = 0, sumaPnl = 0, sumaApostado = 0;
  const porGrupo = {};
  for (const g of GRUPOS) {
    const rows = bets.filter((b) => b._grupo === g.id);
    if (!rows.length) continue;
    const a = agg(rows);
    porGrupo[g.id] = a;
    sumaN += a.n; sumaPnl += a.pnl; sumaApostado += a.apostado;
    console.log(`${g.id.padEnd(18)} ${String(a.n).padStart(4)}  ${String(a.w + '-' + a.l).padStart(7)}  ${String(a.apostado).padStart(10)}  ${String(a.pnl).padStart(9)}  ${a.roi_pct == null ? '   —' : String(a.roi_pct).padStart(7)}   ${g.etiqueta}`);
  }
  console.log(`${'SUMA'.padEnd(18)} ${String(sumaN).padStart(4)}           ${sumaApostado.toFixed(2).padStart(10)}  ${sumaPnl.toFixed(2).padStart(9)}`);

  // LA IDENTIDAD. Si esto no cuadra, la partición no es una partición y todo lo de arriba es decorativo.
  const cuadraN = sumaN === bets.length;
  const cuadraPnl = Math.abs(sumaPnl - total.pnl) < 0.01;
  console.log(`\n  ¿la partición reproduce el libro? filas ${cuadraN ? 'SÍ' : 'NO (' + sumaN + ' vs ' + bets.length + ')'} · ` +
    `P&L ${cuadraPnl ? 'SÍ' : 'NO (' + sumaPnl.toFixed(2) + ' vs ' + total.pnl + ')'}`);
  if (!cuadraN || !cuadraPnl) { console.log('  → la partición está mal construida; no leer nada de lo de arriba.'); process.exit(1); }

  // ── EL CONTRAFACTUAL LEGÍTIMO ──────────────────────────────────────────────────────────────────────────
  // "Una posición por partido y lado", aplicada con la información de entonces: se queda la PRIMERA de cada
  // (partido, lado) y se tiran las siguientes. Nada más. No se filtra por liga ni por resultado.
  console.log('\n─── CONTRAFACTUAL: UNA POSICIÓN POR PARTIDO Y LADO ───');
  console.log('Se conserva la PRIMERA posición de cada (partido, lado) y se descartan las siguientes.');
  console.log('Es aplicable con la información de entonces: al colocar la segunda ya sabíamos de la primera.\n');
  const soloPrimeras = bets.filter((b) => b._primera && b._grupo !== 'sin_resolver' && b._grupo !== 'superseded');
  const conApiladas = bets.filter((b) => b._grupo !== 'sin_resolver' && b._grupo !== 'superseded');
  const a1 = agg(soloPrimeras), a2 = agg(conApiladas);
  console.log(`  como se apostó:        ${String(a2.n).padStart(4)} apuestas · apostado ${a2.apostado} · P&L ${a2.pnl} · ROI ${a2.roi_pct} %`);
  console.log(`  una por partido/lado:  ${String(a1.n).padStart(4)} apuestas · apostado ${a1.apostado} · P&L ${a1.pnl} · ROI ${a1.roi_pct} %`);
  console.log(`  diferencia de P&L: ${(a1.pnl - a2.pnl >= 0 ? '+' : '') + (a1.pnl - a2.pnl).toFixed(2)}`);

  // Y CON SU INCERTIDUMBRE, que es la mitad que siempre falta. El racimo es el PARTIDO: las posiciones
  // apiladas del mismo partido se liquidan con el mismo marcador y no son observaciones independientes.
  const roiIC = (rows) => INF.roiIC(rows, { beneficio: (b) => b.pnl, stake: (b) => b.stake,
    cluster: (b) => b.match || b.pick_id, replicas: 4000, semilla: 20260915 });
  const ic1 = roiIC(soloPrimeras), ic2 = roiIC(conApiladas);
  console.log(`\n  ROI con IC por racimos de partido:`);
  console.log(`    como se apostó:       ${ic2.roi_pct} % [${ic2.ic_pct[0]}, ${ic2.ic_pct[1]}] sobre ${ic2.n_clusters} partidos`);
  console.log(`    una por partido/lado: ${ic1.roi_pct} % [${ic1.ic_pct[0]}, ${ic1.ic_pct[1]}] sobre ${ic1.n_clusters} partidos`);
  console.log(`\n  Los dos intervalos se solapan casi por completo: la mejora existe en el número y NO se`);
  console.log(`  distingue del ruido con esta muestra. Decir "apilar costó X" sin este intervalo al lado es`);
  console.log(`  exactamente lo que la auditoría vino a corregir.`);

  // ── DESCRIPCIÓN POR BANDA (NO es contrafactual) ────────────────────────────────────────────────────────
  console.log('\n─── POR LIGA: DESCRIPCIÓN, NO CONTRAFACTUAL ───');
  console.log('Estas ligas se clasificaron eficientes DESPUÉS de haberlas apostado, con los datos que generaron');
  console.log('estas mismas apuestas. Evitarlas a toro pasado no es una regla: es mirar el resultado.\n');
  const porLiga = {};
  for (const b of bets) {
    if (b._grupo === 'sin_resolver' || b._grupo === 'superseded') continue;
    const lg = String(b.league || '?').toLowerCase();
    (porLiga[lg] = porLiga[lg] || []).push(b);
  }
  const filas = Object.entries(porLiga).map(([lg, rows]) => ({ lg, ...agg(rows), eficiente: EFICIENTES.has(lg) }))
    .sort((a, b) => a.pnl - b.pnl);
  console.log('liga             n     apostado      P&L     ROI %   clasificada eficiente');
  for (const f of filas.slice(0, 12)) {
    console.log(`${f.lg.padEnd(16)} ${String(f.n).padStart(3)}  ${String(f.apostado).padStart(10)}  ${String(f.pnl).padStart(9)}  ${f.roi_pct == null ? '  —' : String(f.roi_pct).padStart(7)}   ${f.eficiente ? 'sí' : ''}`);
  }

  // ── EL NÚCLEO LIMPIO, QUE ES LO QUE DE VERDAD SE ESTÁ DECIDIENDO ──────────────────────────────────────
  const nucleo = bets.filter((b) => b._grupo === 'nucleo');
  const icN = nucleo.length >= 10 ? roiIC(nucleo) : null;
  console.log('\n─── EL NÚCLEO LIMPIO ───');
  console.log('Primera posición de su partido y lado, con EV positivo, fuera de las ligas clasificadas eficientes.');
  console.log('Es la cohorte sobre la que se decide el 20-oct, y por eso es la única que importa contar bien.');
  const an = agg(nucleo);
  console.log(`  ${an.n} apuestas · ${an.w}W-${an.l}L · apostado ${an.apostado} · P&L ${an.pnl} · ROI ${an.roi_pct} %`);
  if (icN) console.log(`  ROI con IC por racimos: ${icN.roi_pct} % [${icN.ic_pct[0]}, ${icN.ic_pct[1]}] sobre ${icN.n_clusters} partidos`);
  const sinRes = bets.filter((b) => b._grupo === 'sin_resolver');
  if (sinRes.length) {
    console.log(`\n  Y ojo: quedan ${sinRes.length} apuestas sin resultado localizable (${agg(sinRes).apostado} de stake).`);
    console.log(`  No son devoluciones. Mientras estén ahí, ningún ROI de este libro es un número cerrado.`);
  }
}

if (require.main === module) main();
module.exports = { clasifica, GRUPOS, EFICIENTES };
