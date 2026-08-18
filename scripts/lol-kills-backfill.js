// scripts/lol-kills-backfill.js — LOS KILLS QUE FALTABAN EN LA BASE DE LoL (19-ago).
//
// Diagnóstico: `games.json.gz` trae 84.586 partidas CON duración y con `k1`/`k2` NULOS. No es que
// Leaguepedia no los publique —`ScoreboardGames.Team1Kills` responde perfectamente— es que las filas se
// guardaron ANTES de que el `slim` de lol-harvest.js pidiera esos dos campos, y la cosecha incremental no
// vuelve sobre lo ya escrito. Consecuencia visible: `leagueTempo` sale vacío, el panel enseña "RITMO DEL
// CIRCUITO · supuesto · muestra propia 0" y TODAS las familias de kills caen por `estructura_no_medida`.
//
// Por qué un script aparte y no re-correr la cosecha: la cosecha re-pide las 18 columnas y REESCRIBE la
// fila entera; esto pide lo justo y lo FUNDE sobre lo que ya hay. Menos bytes contra un limitador que va
// por cubo de fichas, y ningún riesgo de pisar campos buenos con una respuesta parcial.
//
// EL CRUCE NO PUEDE IR POR GameId (comprobado): la base viva NO salió de la cosecha de Leaguepedia sino del
// espejo de HuggingFace (gptilt/lol-esports-matches, linaje Leaguepedia), y ese espejo re-numera las filas
// con un entero secuencial — sus claves son "1", "2", "3", no "2026 Asia Masters_Day 1_1_1". Un cruce por
// id daba 0 de 500 en la primera página. Se cruza por CLAVE NATURAL: instante exacto + los dos equipos,
// que el espejo copia tal cual del origen. El instante es lo que distingue los mapas de una misma serie
// (tres partidas LNG vs IG el mismo día a las 09:14, 10:16 y 11:06).
//
// El limitador de Fandom es un cubo que se rellena: comprobado que una petición pasa y la siguiente no.
// Así que se va despacio a propósito y se espera largo ante un 429 — esto tarda lo que tarde, pero no
// pierde el trabajo: escribe a disco en cada página y se reanuda por el cursor.
//
// USO: node scripts/lol-kills-backfill.js [--since=2026-01-01] [--sleep=20000]
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const SINCE = arg('since', '2026-01-01') + ' 00:00:00';
const SLEEP = +arg('sleep', 20000);
const DIR = path.join(__dirname, '..', 'data', 'esports', 'lol');
const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = (x) => (x == null || x === '' ? null : +x);

function readGames() {
  const plain = path.join(DIR, 'games.json');
  if (fs.existsSync(plain)) return { path: plain, data: JSON.parse(fs.readFileSync(plain, 'utf8')) };
  const gz = path.join(DIR, 'games.json.gz');
  return { path: plain, data: JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8')) };
}

async function cargo(where, limit) {
  const q = new URLSearchParams({
    action: 'cargoquery', format: 'json', tables: 'ScoreboardGames',
    fields: 'ScoreboardGames.Team1,ScoreboardGames.Team2,ScoreboardGames.Team1Kills,ScoreboardGames.Team2Kills,ScoreboardGames.DateTime_UTC',
    where, order_by: 'ScoreboardGames.DateTime_UTC ASC', limit: String(limit),
  });
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch('https://lol.fandom.com/api.php?' + q, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40000) });
      const j = await r.json();
      if (j.error && j.error.code === 'ratelimited') {
        // el cubo se rellena solo: se espera largo y se vuelve a pedir LA MISMA página
        console.log(`  (cubo vacio ${i + 1}/30, espero 120 s)`);
        await sleep(120e3); continue;
      }
      if (j.error) throw new Error(j.error.info || j.error.code);
      return (j.cargoquery || []).map((x) => x.title);
    } catch (e) { if (i >= 8) throw e; await sleep(10000); }
  }
  throw new Error('limitado sin ventana tras 30 intentos');
}

const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const keyOf = (at, t1, t2) => `${String(at || '').slice(0, 19)}|${norm(t1)}|${norm(t2)}`;

(async () => {
  const G = readGames();
  const rows = G.data.rows || {};
  const total = Object.keys(rows).length;
  // índice por clave natural; y un segundo índice sin orden de equipos por si el espejo invirtió los lados
  const byKey = new Map(), byLoose = new Map();
  for (const g of Object.values(rows)) {
    if (!g.at) continue;
    byKey.set(keyOf(g.at, g.t1, g.t2), g);
    const pair = [norm(g.t1), norm(g.t2)].sort().join('|');
    byLoose.set(`${String(g.at).slice(0, 19)}|${pair}`, g);
  }
  const faltan0 = Object.values(rows).filter((r) => (r.at || '') >= SINCE && r.k1 == null).length;
  console.log(`[kills] ${total} partidas en disco · ${faltan0} sin kills desde ${SINCE.slice(0, 10)}`);

  let cursor = SINCE, page = 0, tocadas = 0, vistas = 0, stall = 0;
  while (true) {
    const got = await cargo(`ScoreboardGames.DateTime_UTC>='${cursor}'`, 500);
    if (!got.length) break;
    page++;
    let maxDt = cursor, nuevas = 0;
    for (const r of got) {
      const dt = r['DateTime UTC'] || '';
      if (dt > maxDt) maxDt = dt;
      vistas++;
      const at = String(dt).slice(0, 19);
      let g = byKey.get(keyOf(at, r.Team1, r.Team2));
      let flip = false;
      if (!g) {                                          // mismo instante, lados al revés en el espejo
        const pair = [norm(r.Team1), norm(r.Team2)].sort().join('|');
        g = byLoose.get(`${at}|${pair}`);
        if (g) flip = norm(g.t1) !== norm(r.Team1);
      }
      if (!g) continue;                                  // partida que la base no tiene: no se inventa
      const a = N(r.Team1Kills), bK = N(r.Team2Kills);
      if (a == null || bK == null) continue;
      // los kills viajan CON su equipo: si el espejo guardó los lados invertidos, se invierten también
      const k1 = flip ? bK : a, k2 = flip ? a : bK;
      if (g.k1 === k1 && g.k2 === k2) continue;
      g.k1 = k1; g.k2 = k2; tocadas++; nuevas++;
    }
    if (maxDt === cursor) {                              // pagina entera dentro del mismo segundo: se empuja
      maxDt = new Date(Date.parse(cursor.replace(' ', 'T') + 'Z') + 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
    cursor = maxDt;
    fs.writeFileSync(G.path + '.tmp', JSON.stringify(G.data));
    fs.renameSync(G.path + '.tmp', G.path);
    console.log(`[kills] p${page}: +${nuevas} (rellenadas ${tocadas} de ${vistas} vistas) · cursor ${cursor}`);
    if (nuevas === 0) { if (++stall >= 3) { console.log('[kills] 3 paginas sin rellenar nada — fin'); break; } }
    else stall = 0;
    if (got.length < 500) break;
    await sleep(SLEEP);
  }

  // el motor lee el .gz: se regenera al terminar
  const gzPath = path.join(DIR, 'games.json.gz');
  fs.writeFileSync(gzPath, zlib.gzipSync(Buffer.from(JSON.stringify(G.data)), { level: 9 }));
  const conKills = Object.values(rows).filter((r) => r.k1 != null).length;
  console.log(`[kills] LISTO: ${tocadas} partidas rellenadas · ${conKills}/${total} con kills · gz regenerado`);
})().catch((e) => { console.error('[kills] ' + e.message); process.exit(1); });
