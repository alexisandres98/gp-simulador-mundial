#!/usr/bin/env node
// scripts/lol-gen-reparto.js — ¿CUÁNTAS VECES EL GANADOR HACE MENOS KILLS? (16-sep-2026, H-L1)
//
// POR QUÉ HACE FALTA UN NÚMERO Y NO UNA INTUICIÓN. El generador de kills recorta el reparto del ganador a
// [0,50 , 0,95]:
//
//     shareW = Math.max(0.50, Math.min(0.95, P.share_win + P.share_win_sd * normal(rnd)))
//
// Ese recorte no es una salvaguarda numérica: es una AFIRMACIÓN sobre el juego — que quien gana el mapa
// nunca hace menos kills que quien lo pierde. Si es cierta, el recorte solo corta cola. Si es falsa, el
// modelo le asigna probabilidad CERO a algo que pasa, y ese error cae entero sobre las familias que
// apuestan al MARGEN de kills (KILLS_HANDICAP, KILLS_DNB), que son justo las que generan las picks.
//
// Este script la comprueba sobre la base propia (97.588 partidas de Leaguepedia, 2020→hoy) con EXACTAMENTE
// el mismo filtro que usa `stats()` en el generador — si se midiera sobre otro subconjunto, el número no
// diría nada sobre el modelo.
//
// Uso: node scripts/lol-gen-reparto.js [--json] [--por-liga]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const POR_LIGA = argv.includes('--por-liga');

// Mismo orden de búsqueda que el resto del motor: disco persistente primero, repo como línea de base.
function baseDir() {
  const raiz = process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : (fs.existsSync('/data') ? '/data' : null);
  for (const d of [raiz && path.join(raiz, 'esports', 'lol'), path.join(__dirname, '..', 'data', 'esports', 'lol')]) {
    if (d && fs.existsSync(path.join(d, 'games.json.gz'))) return d;
  }
  return null;
}

function carga() {
  const d = baseDir();
  if (!d) return null;
  const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(d, 'games.json.gz'))).toString('utf8'));
  const rows = Array.isArray(j.rows) ? j.rows : Object.values(j.rows || {});
  return { dir: d, rows, at: j.at || null, source: j.source || null };
}

// EL MISMO FILTRO QUE `stats()` EN esports-engine/lol-gen.js. Copiado a propósito y no importado: si el
// generador cambiara su filtro, este script tiene que seguir midiendo lo que mide hoy hasta que alguien
// decida actualizarlo, y el desajuste tiene que ser visible en el diff.
const utilizable = (g) => {
  const k1 = +g.k1, k2 = +g.k2, len = +g.len;
  if (!(len > 8 && len < 90) || !Number.isFinite(k1) || !Number.isFinite(k2) || k1 + k2 < 2) return false;
  return g.win === g.t1 || g.win === g.t2;
};

const CUBOS = [[0, 0.40], [0.40, 0.45], [0.45, 0.50], [0.50, 0.55], [0.55, 0.60], [0.60, 0.70], [0.70, 0.80], [0.80, 1.01]];
const RECORTE = [0.50, 0.95];

function mide(rows) {
  let n = 0, menos = 0, igual = 0, sobre95 = 0, suma = 0;
  const cubos = CUBOS.map(() => 0);
  for (const g of rows) {
    if (!utilizable(g)) continue;
    const k1 = +g.k1, k2 = +g.k2, tot = k1 + k2;
    const winK = g.win === g.t1 ? k1 : k2;
    const share = winK / tot;
    n++; suma += share;
    if (winK < tot - winK) menos++;
    else if (winK === tot - winK) igual++;
    if (share > RECORTE[1]) sobre95++;
    for (let i = 0; i < CUBOS.length; i++) if (share >= CUBOS[i][0] && share < CUBOS[i][1]) { cubos[i]++; break; }
  }
  const pct = (x) => (n ? +(100 * x / n).toFixed(2) : null);
  return {
    n,
    ganador_con_menos_kills: menos, ganador_con_menos_kills_pct: pct(menos),
    empate_a_kills: igual, empate_a_kills_pct: pct(igual),
    por_encima_del_recorte_alto: sobre95, por_encima_del_recorte_alto_pct: pct(sobre95),
    // lo que el recorte manda al borde inferior: lo que está por debajo de 0,50 MÁS los empates exactos
    masa_apilada_en_el_borde_pct: pct(menos + igual),
    reparto_medio_pct: n ? +(100 * suma / n).toFixed(2) : null,
    distribucion: CUBOS.map(([lo, hi], i) => ({ desde: lo, hasta: hi, n: cubos[i], pct: pct(cubos[i]) })),
    recorte_del_modelo: RECORTE,
  };
}

function main() {
  const b = carga();
  if (!b) { console.error('no encuentro data/esports/lol/games.json.gz'); process.exit(1); }
  const global = mide(b.rows);

  const salida = { at: new Date().toISOString(), base: b.dir, base_at: b.at, fuente: b.source, global };

  if (POR_LIGA) {
    const porLiga = {};
    for (const g of b.rows) {
      if (!utilizable(g)) continue;
      const k = String(g.page || '').split('/')[0].trim() || '?';
      (porLiga[k] = porLiga[k] || []).push(g);
    }
    salida.ligas = Object.entries(porLiga)
      .filter(([, arr]) => arr.length >= 300)
      .map(([liga, arr]) => ({ liga, ...mide(arr) }))
      .sort((a, b2) => b2.ganador_con_menos_kills_pct - a.ganador_con_menos_kills_pct)
      .slice(0, 25);
  }

  if (JSON_OUT) { console.log(JSON.stringify(salida, null, 1)); return; }

  console.log('═══ EL REPARTO DE KILLS DEL GANADOR, EN LA BASE PROPIA ═══');
  console.log(`base: ${b.dir} · ${global.n.toLocaleString('es')} partidas utilizables (mismo filtro que stats())\n`);
  console.log(`el GANADOR hace MENOS kills que el perdedor : ${global.ganador_con_menos_kills.toLocaleString('es')}  (${global.ganador_con_menos_kills_pct} %)`);
  console.log(`empate a kills                             : ${global.empate_a_kills.toLocaleString('es')}  (${global.empate_a_kills_pct} %)`);
  console.log(`reparto medio del ganador                  : ${global.reparto_medio_pct} %\n`);
  console.log('distribución del reparto del ganador:');
  for (const c of global.distribucion) console.log(`  [${c.desde.toFixed(2)}, ${c.hasta.toFixed(2)})   ${String(c.n).padStart(6)}   ${String(c.pct).padStart(5)} %`);

  console.log(`\nEL MODELO recorta a [${RECORTE[0]}, ${RECORTE[1]}].`);
  console.log(`  · le asigna probabilidad CERO al ${global.ganador_con_menos_kills_pct} % de las partidas (una de cada ${Math.round(100 / global.ganador_con_menos_kills_pct)});`);
  console.log(`  · y apila el ${global.masa_apilada_en_el_borde_pct} % de la masa justo en el borde 0,50.`);
  console.log(`  · por arriba se pierde poco: solo el ${global.por_encima_del_recorte_alto_pct} % supera 0,95.`);
  console.log('\nEso cae entero sobre las familias que apuestan al MARGEN de kills, y encaja con lo medido el');
  console.log('16-sep (docs/CALIBRACION_2026-09-16.md): KILLS_HANDICAP se pasa +19,5 pp y KILLS_DNB +10,9 pp.');
  console.log('\nESTE SCRIPT NO CAMBIA NADA. Ensancharlo cambia qué picks nacen, y eso lo decide Alexis.');

  if (salida.ligas) {
    console.log('\n── por liga (n ≥ 300), las 25 con más casos ──');
    for (const l of salida.ligas) console.log(`  ${l.liga.slice(0, 34).padEnd(35)} n=${String(l.n).padStart(6)}  ganador con menos kills ${String(l.ganador_con_menos_kills_pct).padStart(5)} %  reparto medio ${l.reparto_medio_pct} %`);
  }
}

if (require.main === module) main();
module.exports = { mide, utilizable, carga, CUBOS, RECORTE };
