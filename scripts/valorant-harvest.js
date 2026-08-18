// scripts/valorant-harvest.js — LA BASE HISTÓRICA PROPIA DE VALORANT (18-ago, blueprint 4.0 Fases 1)
//
// Fuente: vlr.gg (registro de derechos en data/esports/valorant/RIGHTS.md: research_only — la base
// alimenta rating interno, catálogo admin y sombra; NINGUNA pick pública nace de aquí). robots.txt de
// vlr.gg permite estas rutas; se cosecha LENTO (1 req/2,5 s), con UA identificado y contacto, y todo
// es reanudable por construcción — la lección de la cosecha de LoL aplicada desde el diseño.
//
// DOS TABLAS:
//   series  — el índice de resultados completo (…/matches/results/?page=N, ~660 páginas, 2020→hoy):
//             id, equipos, marcador de serie, evento, fase, fecha/hora. Es la base del Elo.
//   details — la página de cada serie DESDE --since (default 2024-01-01): por mapa (nombre, marcador,
//             mitades ataque/defensa, prórroga, duración) y por jugador (agente, rating2, ACS, K/D/A,
//             KAST, ADR, FK/FD). Es la base de mapas, agentes y jugadores.
//
// USO
//   node scripts/valorant-harvest.js --only=series                 # índice completo (reanudable)
//   node scripts/valorant-harvest.js --only=details --since=2024-01-01
//   node scripts/valorant-harvest.js                               # las dos, series primero
//   GP_VAL_DIR=/data/val-raw node scripts/valorant-harvest.js      # en Render (disco persistente)
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_VAL_DIR || (fs.existsSync('/data') ? '/data/val-raw' : path.join(__dirname, '..', 'data', 'esports', 'valorant'));
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const ONLY = arg('only', '');
const SINCE = arg('since', '2024-01-01');
const SLEEP = +arg('sleep', 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'GP-Simulador/1.0 (codigo@gpsimulador.com; cosecha lenta 1req/2.5s, contacto en el UA)';

let calls = 0;
async function page(url) {
  // paciencia estructural (lección LoL): un límite de tasa se ESPERA, no termina una tabla.
  // Si tras ~40 min no hay ventana, se lanza: el proceso sale ≠0 y la próxima pasada reanuda.
  let netTries = 0;
  for (let i = 0; i < 8; i++) {
    calls++;
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(40000) });
      if (r.status === 429 || r.status === 403 || r.status === 503) {
        const wait = i === 0 ? 60e3 : 300e3;
        console.log(`[val] HTTP ${r.status} en ${url.slice(0, 60)} — espero ${wait / 1000}s (${i + 1}/8)`);
        await sleep(wait); continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (++netTries >= 5) throw e; await sleep(8000 * netTries); }
  }
  throw new Error('límite persistente: sin ventana en ~40 min. Se reanuda en la próxima pasada.');
}

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => {
  fs.mkdirSync(DIR, { recursive: true });
  const p = path.join(DIR, f);
  fs.writeFileSync(p + '.tmp', JSON.stringify(o));
  fs.renameSync(p + '.tmp', p);
};
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&ndash;/g, '–').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
const MONTHS = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };

// ── TABLA 1: el índice de series ─────────────────────────────────────────────────────────────────────────
// Cursor por PÁGINA descendente-en-el-tiempo… no: las páginas se desplazan cuando entran series nuevas.
// Robusto de verdad: se recorre desde la página 1 y se corta cuando una página entera ya está en disco
// Y su fecha es anterior al último corte guardado — así cada pasada recoge lo nuevo y rellena lo viejo
// con un cursor de página independiente (`deep_page`) que avanza hasta agotar el histórico.
async function harvestSeries() {
  const st = rd('series.json') || { rights_class: 'research_only', source: 'vlr.gg (índice de resultados)', rows: {}, deep_page: 0, deep_done: false };
  st.rows = st.rows || {};
  const parse = (html) => {
    // los items cuelgan de headers de fecha ("Mon, August 17, 2026"): se recorre en orden guardando la vigente
    const out = [];
    const rx = /wf-label mod-large[^>]*>\s*([^<]+?)\s*<|<a href="\/(\d+)\/([^"]*)" class="[^"]*match-item[^"]*"([\s\S]*?)<\/a>/g;
    let m, curDate = null;
    while ((m = rx.exec(html))) {
      if (m[1]) {
        const dm = m[1].match(/(\w+) (\d+), (\d+)/);
        curDate = dm ? `${dm[3]}-${MONTHS[dm[1]] || '01'}-${String(dm[2]).padStart(2, '0')}` : curDate;
        continue;
      }
      const [, , id, slug, body] = m;
      const time = (body.match(/match-item-time">\s*([^<]+?)\s*</) || [])[1] || null;
      const names = [...body.matchAll(/<div class="text-of">\s*(?:<span[^>]*><\/span>\s*)?([^<]+?)\s*<\/div>/g)].map((x) => clean(x[1]));
      const scores = [...body.matchAll(/match-item-vs-team-score[^"]*">\s*([^<]+?)\s*</g)].map((x) => clean(x[1]));
      const evStage = clean((body.match(/match-item-event-series[^>]*>\s*([\s\S]*?)<\/div>/) || [])[1]);
      const evBlock = (body.match(/match-item-event text-of">([\s\S]*?)(?:<div class="match-item-icon"|<\/a>)/) || [])[1] || '';
      const evName = clean(evBlock.replace(/<div class="match-item-event-series[\s\S]*?<\/div>/, ''));
      if (names.length < 2) continue;
      out.push({ id, slug, at: curDate, time, t1: names[0], t2: names[1],
        s1: +scores[0] >= 0 ? +scores[0] : null, s2: +scores[1] >= 0 ? +scores[1] : null,
        event: evName || null, stage: evStage || null });
    }
    return out;
  };
  // 1) pasada de frescura: página 1 hacia abajo hasta topar con 2 páginas enteramente conocidas.
  // En la primera corrida nada es conocido, así que esta misma pasada ES el crawl profundo: va avanzando
  // el cursor deep_page para que la pasada 2 no repita trabajo.
  let known = 0, maxSeen = 0;
  for (let p = 1; p <= 700 && known < 2; p++) {
    const rows = parse(await page(`https://www.vlr.gg/matches/results/?page=${p}`));
    if (!rows.length) { st.deep_done = true; break; }
    let added = 0;
    for (const r of rows) if (!st.rows[r.id]) { st.rows[r.id] = r; added++; }
    if (added === 0) known++; else known = 0;
    maxSeen = p;
    if (p > st.deep_page) st.deep_page = p;
    st.at = new Date().toISOString(); wr('series.json', st);
    if (p % 20 === 0 || added) console.log(`[val] series p${p}: +${added} (total ${Object.keys(st.rows).length})`);
    await sleep(SLEEP);
  }
  // 2) pasada profunda: desde el cursor histórico hasta agotar (una sola vez; luego deep_done). Solo
  // trabaja cuando la frescura se detuvo por "ya conocido" y el histórico de abajo sigue sin agotar.
  if (!st.deep_done) {
    let empty = 0;
    for (let p = Math.max(maxSeen + 1, st.deep_page + 1); p <= 700; p++) {
      const rows = parse(await page(`https://www.vlr.gg/matches/results/?page=${p}`));
      if (!rows.length) { if (++empty >= 2) { st.deep_done = true; break; } continue; }
      empty = 0;
      let added = 0;
      for (const r of rows) if (!st.rows[r.id]) { st.rows[r.id] = r; added++; }
      st.deep_page = p; st.at = new Date().toISOString(); wr('series.json', st);
      if (p % 20 === 0) console.log(`[val] series profunda p${p}: +${added} (total ${Object.keys(st.rows).length})`);
      await sleep(SLEEP);
    }
    if (st.deep_page >= 700) st.deep_done = true;
    wr('series.json', st);
  }
  console.log(`[val] series LISTO: ${Object.keys(st.rows).length} series · profunda ${st.deep_done ? 'agotada' : 'en p' + st.deep_page}`);
  return st;
}

// ── TABLA 2: el detalle por serie (mapas + jugadores) ────────────────────────────────────────────────────
function parseDetail(html) {
  const out = { maps: [], players: [] };
  out.patch = (html.match(/Patch\s*([\d.]+)/) || [])[1] || null;
  const blocks = html.split(/<div class="vm-stats-game(?= |")/).slice(1);
  for (const raw of blocks) {
    const gid = (raw.match(/data-game-id="(\d+)"/) || [])[1];
    if (!gid || gid === 'all') continue;
    const blk = raw;
    const mapName = clean((blk.match(/<div class="map"[^>]*>[\s\S]*?<span[^>]*>\s*([^<]+?)\s*</) || [])[1]);
    const scores = [...blk.matchAll(/<div class="score[^"]*"[^>]*>\s*(\d+)\s*<\/div>/g)].map((x) => +x[1]);
    const halves = [...blk.matchAll(/<span class="mod-(t|ct|ot)">\s*(\d+)\s*<\/span>/g)].map((x) => ({ side: x[1], r: +x[2] }));
    const dur = clean((blk.match(/map-duration[^>]*>\s*([^<]+?)\s*</) || [])[1]) || null;
    if (!mapName || scores.length < 2) continue;
    out.maps.push({ gid, map: mapName, s1: scores[0], s2: scores[1], halves, dur });
    // filas de jugador: divs ovw-row (10 por mapa, equipo 1 primero); cada celda declara su data-col,
    // así que se mapea por NOMBRE de columna, no por posición — sobrevive a reordenamientos del sitio
    const rows = blk.split(/<div class="ovw-row">/).slice(1);
    let idx = 0;
    for (const row of rows) {
      const pid = (row.match(/href="\/player\/(\d+)\//) || [])[1];
      if (!pid) continue;
      const nick = clean((row.match(/ovw-player-name[^>]*>\s*([^<]+?)\s*</) || [])[1]);
      const tag = clean((row.match(/ovw-player-tag[^>]*>\s*([^<]+?)\s*</) || [])[1]);
      const agent = (row.match(/agents\/([a-z0-9]+)\.png/) || [])[1] || null;
      const cols = {};
      for (const m2 of row.matchAll(/data-col="([\w-]+)"(?:(?!data-col)[\s\S]){0,240}?class="side mod-(?:side mod-)?both">\s*([^<]*?)\s*</g)) {
        const v = parseFloat(String(m2[2]).replace('%', ''));
        if (Number.isFinite(v) && cols[m2[1]] === undefined) cols[m2[1]] = v;
      }
      out.players.push({ gid, pid, nick, tag, agent, team: idx < 5 ? 1 : 2,
        r2: cols.rating2 ?? null, acs: cols.acs ?? null, k: cols.kills ?? null, d: cols.deaths ?? null,
        a: cols.assists ?? null, kast: cols.kast ?? null, adr: cols.adr ?? null,
        fk: cols.fb ?? null, fd: cols.fd ?? null });   // vlr llama "fb" (first bloods) a los first kills
      idx++;
    }
  }
  return out;
}

async function harvestDetails(seriesSt) {
  const S = seriesSt || rd('series.json');
  if (!S || !S.rows) { console.log('[val] details: no hay series.json todavía'); return; }
  const maps = rd('maps.json') || { rights_class: 'research_only', source: 'vlr.gg (detalle por serie)', rows: {} };
  const players = rd('players-raw.json') || { rights_class: 'research_only', source: 'vlr.gg (scoreboard por mapa)', rows: {} };
  const done = new Set(Object.keys(maps.rows || {}));
  const todo = Object.values(S.rows)
    .filter((s) => s.at && s.at >= SINCE && !done.has(s.id))
    // walkovers y series sin marcador no tienen página útil
    .filter((s) => s.s1 != null && s.s2 != null && (s.s1 + s.s2) > 0)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  console.log(`[val] details: ${todo.length} series pendientes desde ${SINCE} (${done.size} ya en disco)`);
  let n = 0;
  for (const s of todo) {
    let det;
    try { det = parseDetail(await page(`https://www.vlr.gg/${s.id}/${s.slug || 'x'}`)); }
    catch (e) { console.log(`[val] detalle ${s.id}: ${e.message}`); throw e; }
    maps.rows[s.id] = { at: s.at, patch: det.patch, maps: det.maps };
    for (const p of det.players) (players.rows[`${s.id}|${p.gid}|${p.pid}`] = { sid: s.id, at: s.at, ...p });
    n++;
    if (n % 25 === 0 || n === todo.length) {
      maps.at = players.at = new Date().toISOString();
      wr('maps.json', maps); wr('players-raw.json', players);
      console.log(`[val] details ${n}/${todo.length} · maps ${Object.keys(maps.rows).length} · filas jugador ${Object.keys(players.rows).length}`);
    }
    await sleep(SLEEP);
  }
  maps.at = players.at = new Date().toISOString();
  wr('maps.json', maps); wr('players-raw.json', players);
  console.log(`[val] details LISTO`);
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let S = null;
  if (!ONLY || ONLY === 'series') S = await harvestSeries();
  if (!ONLY || ONLY === 'details') await harvestDetails(S);
  // marcador de completitud (misma semántica que LoL): llegar aquí = las tablas pedidas terminaron de verdad
  const st = rd('state.json') || {};
  st[ONLY || 'all'] = { complete: true, at: new Date().toISOString(), calls };
  if (st.all || (st.series && st.details)) st.complete = true;
  wr('state.json', st);
  console.log(`[val] COSECHA COMPLETA (${ONLY || 'todo'}) · ${calls} llamadas`);
})();
