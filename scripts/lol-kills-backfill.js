// scripts/lol-kills-backfill.js — LO QUE FALTABA EN LA BASE DE LoL: KILLS Y OBJETIVOS (19-ago).
//
// Diagnóstico: `games.json.gz` trae 84.586 partidas con duración y con TODO LO DEMÁS NULO — kills, dragones,
// barones, heraldos, torres y oro. No es que Leaguepedia no lo publique (`ScoreboardGames` tiene las nueve
// columnas y responden perfectamente): la base viva salió del espejo de HuggingFace, que solo copió
// id/equipos/ganador/fecha/parche/duración. Consecuencias visibles: `leagueTempo` vacío, el panel diciendo
// "RITMO DEL CIRCUITO · supuesto · muestra propia 0", todas las familias de kills cayendo por
// `estructura_no_medida`, y el panel de OBJETIVOS NEUTRALES —que es lo más propio de LoL, lo que ningún
// otro juego de la casa tiene— enseñando un perfil de circuito en vez de una medición.
//
// Se piden las nueve columnas en la MISMA página: el limitador de Fandom cobra por petición, no por ancho,
// así que traer kills y objetivos juntos cuesta exactamente lo mismo que traer solo kills.
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
// EMPEZAR POR DONDE IMPORTA (19-ago): el agregado de tempo mira una ventana de 180 DÍAS, así que rellenar
// desde enero gasta las primeras páginas —y con ellas las fichas del limitador, que es lo escaso— en
// partidas que el modelo ni siquiera va a mirar. Se arranca en el borde de esa ventana y se sigue hacia
// adelante: la primera página ya sirve para algo. Lo viejo se puede rellenar después, o no rellenarse.
// Es la misma lección que la cosecha de Valorant: lo RECIENTE primero.
//
// USO: node scripts/lol-kills-backfill.js [--since=2026-02-21] [--sleep=20000]
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
// por defecto, el borde de la ventana de tempo (180 días), no el principio del año
const defSince = new Date(Date.now() - 178 * 864e5).toISOString().slice(0, 10);
const SINCE = arg('since', defSince) + ' 00:00:00';
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
    fields: ['Team1', 'Team2', 'Team1Kills', 'Team2Kills', 'Team1Dragons', 'Team2Dragons',
      'Team1Barons', 'Team2Barons', 'Team1Towers', 'Team2Towers', 'Team1Gold', 'Team2Gold', 'DateTime_UTC']
      .map((f) => 'ScoreboardGames.' + f).join(','),
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

// CERROJO DE INSTANCIA ÚNICA (19-ago). Este script carga games.json ENTERO en memoria y reescribe el
// archivo completo en cada página. Dos instancias a la vez no se reparten el trabajo: cada una parte de la
// foto que leyó al arrancar y la última en escribir borra lo que hizo la otra. Pasó de verdad —quedaron dos
// corriendo y el registro decía 1.498 partidas rellenadas mientras en disco había 270—, así que deja de
// depender de que quien lo lanza se acuerde.
const LOCK = path.join(DIR, '.kills-backfill.lock');
function acquireLock() {
  try {
    const prev = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    // un cerrojo huérfano (proceso muerto) no debe bloquear para siempre
    let alive = false;
    try { process.kill(prev.pid, 0); alive = true; } catch { alive = false; }
    if (alive && prev.pid !== process.pid) {
      console.error(`[kills] ya hay una instancia corriendo (pid ${prev.pid}). Dos a la vez se pisan la escritura: salgo.`);
      process.exit(2);
    }
  } catch { /* sin cerrojo previo, o ilegible: seguimos */ }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const release = () => { try { fs.unlinkSync(LOCK); } catch { } };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
}

(async () => {
  acquireLock();
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
  const pendientes = Object.values(rows).filter((r) => (r.at || '') >= SINCE && (r.k1 == null || r.d1 == null));
  const faltan0 = pendientes.length;
  console.log(`[kills] ${total} partidas en disco · ${faltan0} sin kills u objetivos desde ${SINCE.slice(0, 10)}`);

  // ── EMPEZAR EN EL PRIMER HUECO DE VERDAD (19-ago, tras verlo fallar entero) ──────────────────────────
  // El arranque por defecto era el borde de la ventana de 180 días. Pero la ventana ya puede estar
  // rellenada por delante: hoy las partidas hasta el 19-abr estaban completas y los huecos empezaban ahí.
  // El script gastó tres páginas —y sus fichas del limitador, que es el recurso escaso— re-caminando
  // partidas que ya tenían todo, y encima el detector de parón lo interpretó como "no hay nada que
  // rellenar" y cortó 120 días ANTES de llegar a los 5.074 huecos reales. Se arranca donde falta algo.
  //
  // `--since` explícito sigue mandando: si alguien quiere re-pedir un tramo ya completo (para corregirlo),
  // tiene que poder.
  const sinceExplicit = process.argv.some((a) => a.startsWith('--since='));
  let arranque = SINCE;
  // EL CURSOR GUARDADO MANDA SOBRE EL PRIMER HUECO (19-ago, visto al relanzar). Tras una pasada larga quedan
  // huecos ANTIGUOS que el cruce por clave natural no supo emparejar —partidas que el espejo no tiene,
  // nombres que no casan—. Arrancar en el primer hueco manda al script a re-caminar meses de páginas casi
  // llenas para rescatar un puñado de filas imposibles, y cada página cuesta una ficha del limitador, que es
  // el recurso escaso. Si hay cursor se sigue desde ahí; el primer hueco solo decide cuando no lo hay.
  if (!sinceExplicit && G.data.kills_cursor && G.data.kills_cursor > SINCE) {
    arranque = G.data.kills_cursor;
    console.log(`[kills] reanudo en ${arranque} (cursor guardado)`);
  } else if (!sinceExplicit && pendientes.length) {
    const primerHueco = pendientes.reduce((m, r) => (r.at < m ? r.at : m), pendientes[0].at);
    // se retrocede un minuto para no perder la partida justo en el borde por el `>=` de la consulta
    arranque = String(primerHueco).slice(0, 19);
    console.log(`[kills] primer hueco en ${arranque} — se arranca ahí y no en el borde de la ventana`);
  }

  let cursor = arranque, page = 0, tocadas = 0, vistas = 0, stall = 0;
  while (true) {
    const got = await cargo(`ScoreboardGames.DateTime_UTC>='${cursor}'`, 500);
    if (!got.length) break;
    page++;
    let maxDt = cursor, nuevas = 0, podian = 0;
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
      if (g.k1 == null || g.d1 == null) podian++;        // esta fila SÍ tenía hueco: cuenta para el parón
      // TODAS las columnas viajan CON su equipo: si el espejo guardó los lados invertidos, se invierte el
      // par entero — poner los dragones del azul en el rojo sería peor que no tenerlos.
      const PAIR = [['k', 'Kills'], ['d', 'Dragons'], ['b', 'Barons'], ['tw', 'Towers'], ['g', 'Gold']];
      let touched = false;
      for (const [key, col] of PAIR) {
        const a = N(r['Team1' + col]), bv = N(r['Team2' + col]);
        if (a == null || bv == null) continue;
        const v1 = flip ? bv : a, v2 = flip ? a : bv;
        if (g[key + '1'] === v1 && g[key + '2'] === v2) continue;
        g[key + '1'] = v1; g[key + '2'] = v2; touched = true;
      }
      if (!touched) continue;
      tocadas++; nuevas++;
    }
    if (maxDt === cursor) {                              // pagina entera dentro del mismo segundo: se empuja
      maxDt = new Date(Date.parse(cursor.replace(' ', 'T') + 'Z') + 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
    cursor = maxDt;
    G.data.kills_cursor = cursor;                        // reanudar donde se paró, no donde se empezó
    fs.writeFileSync(G.path + '.tmp', JSON.stringify(G.data));
    fs.renameSync(G.path + '.tmp', G.path);
    console.log(`[kills] p${page}: +${nuevas} (rellenadas ${tocadas} de ${vistas} vistas) · cursor ${cursor}`);
    // EL PARÓN SE MIDE CONTRA LO QUE FALTABA, NO CONTRA LO QUE SE RELLENÓ. Una página que rellena 0 porque
    // esas partidas YA estaban completas no es un callejón sin salida: es trabajo ya hecho. Confundir las
    // dos cosas es lo que cortó la pasada de hoy a 120 días de los huecos. Solo cuenta como parón la página
    // en la que había filas que SÍ podíamos haber rellenado y no se rellenó ninguna — eso sí es que el
    // cruce por clave natural dejó de funcionar y seguir pidiendo no arregla nada.
    if (nuevas === 0 && podian > 0) {
      if (++stall >= 3) { console.log('[kills] 3 paginas con huecos y ningun cruce — el cruce falla, paro'); break; }
    } else stall = 0;
    if (nuevas === 0 && podian === 0) console.log(`[kills] p${page}: ya estaba completa, sigo`);
    if (got.length < 500) break;
    await sleep(SLEEP);
  }

  // el motor lee el .gz: se regenera al terminar
  const gzPath = path.join(DIR, 'games.json.gz');
  fs.writeFileSync(gzPath, zlib.gzipSync(Buffer.from(JSON.stringify(G.data)), { level: 9 }));
  const conKills = Object.values(rows).filter((r) => r.k1 != null).length;
  const conObj = Object.values(rows).filter((r) => r.d1 != null).length;
  console.log(`[kills] LISTO: ${tocadas} rellenadas · ${conKills}/${total} con kills · ${conObj} con objetivos · gz regenerado`);
})().catch((e) => { console.error('[kills] ' + e.message); process.exit(1); });
