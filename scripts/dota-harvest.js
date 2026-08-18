// scripts/dota-harvest.js — BASE HISTÓRICA PROPIA DE DOTA 2 (17-ago).
//
// POR QUÉ. El punto 1 de `TODO_NEXT` dice que sin fuente de resultados propia no hay rating, ni liquidación,
// ni ROI, ni CLV — y que OpenDota es pública y no necesita permiso comercial. Para liquidar ya está enchufada
// (`data-providers/esports/results.js`), pero liquidar mira solo unos días atrás: para tener RATING PROPIO
// hace falta histórico, y eso es lo que baja este archivo.
//
// LO QUE BAJA. `/api/proMatches` devuelve 100 partidas profesionales por llamada, de la más reciente hacia
// atrás, y se pagina con `?less_than_match_id=`. De cada partida se guardan los diez campos que sirven para
// modelar (equipos, marcador, duración, liga, serie y quién ganó) y nada más: el volcado entero multiplica
// el tamaño del archivo sin añadir señal.
//
// LO QUE NO HACE, dicho antes de que alguien lo suponga:
//   · NO toca el motor de Dota 2 ni las picks. Esto deja un archivo en disco; el rating se valida aparte
//     (`scripts/dota-validate.js`) y solo se enchufa si la validación lo aguanta. Es la lección de CS2:
//     el modelo que yo había defendido lo tumbó su propia validación.
//   · NO resuelve identidades contra la base de GP. Guarda los nombres y los `team_id` de OpenDota, que son
//     estables; casarlos con los nombres del libro es trabajo del motor, y sabe negarse cuando no está seguro.
//
// USO
//   node scripts/dota-harvest.js                 # 365 días hacia atrás (o hasta donde llegue)
//   node scripts/dota-harvest.js --days=730
//   node scripts/dota-harvest.js --max-pages=40  # tope de llamadas (por si se quiere una pasada corta)
// Es idempotente y acumulativo: fusiona por `match_id` con lo que ya hubiera en disco.
'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://api.opendota.com/api/proMatches';
const UA = 'GP-Simulador/1.0 (+https://gpsimulador.com) node-fetch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mismo criterio de disco que el resto de esports: al disco persistente si existe, al repo si no.
const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'esports', 'dota2');
const REPO_DIR = path.join(__dirname, '..', 'data', 'esports', 'dota2');
const DIR = (() => { try { fs.mkdirSync(DISK_DIR, { recursive: true }); return DISK_DIR; } catch { return REPO_DIR; } })();
const FILE = path.join(DIR, 'matches.json');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};

async function getJSON(url, { tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) { await sleep(1200 * (i + 1)); continue; }
      return await r.json();
    } catch { await sleep(1200 * (i + 1)); }
  }
  return null;
}

// Solo lo que modela. `series_type`: 0 = bo1, 1 = bo3, 2 = bo5 (así lo publica OpenDota).
const slim = (m) => ({
  id: m.match_id, at: m.start_time, dur: m.duration,
  r_id: m.radiant_team_id || null, r: m.radiant_name || null,
  d_id: m.dire_team_id || null, d: m.dire_name || null,
  lg: m.leagueid || null, lg_name: m.league_name || null,
  ser: m.series_id || null, ser_type: m.series_type != null ? m.series_type : null,
  r_score: m.radiant_score, d_score: m.dire_score, r_win: !!m.radiant_win,
});

async function main() {
  const days = +arg('days', 365);
  const maxPages = +arg('max-pages', 400);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  let store = { at: null, matches: {} };
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* primera pasada */ }
  const before = Object.keys(store.matches || {}).length;
  console.log(`[dota] base en disco: ${before} partidas · destino ${FILE}`);

  let cursor = null, pages = 0, added = 0, oldest = null;
  while (pages < maxPages) {
    const url = cursor ? `${API}?less_than_match_id=${cursor}` : API;
    const rows = await getJSON(url);
    pages++;
    if (!Array.isArray(rows) || !rows.length) { console.log('[dota] la API dejó de devolver filas; se para acá'); break; }
    for (const m of rows) {
      if (!m || !m.match_id) continue;
      if (!store.matches[m.match_id]) added++;
      store.matches[m.match_id] = slim(m);
      oldest = oldest == null ? m.start_time : Math.min(oldest, m.start_time);
    }
    cursor = rows[rows.length - 1].match_id;
    const oldestPage = Math.min(...rows.map((m) => m.start_time || Infinity));
    if (pages % 10 === 0 || oldestPage < since) {
      console.log(`[dota] página ${pages} · ${Object.keys(store.matches).length} partidas · más antigua ${new Date(oldestPage * 1000).toISOString().slice(0, 10)}`);
    }
    if (oldestPage < since) { console.log('[dota] alcanzada la ventana pedida'); break; }
    await sleep(1200);   // cortesía con una API pública y gratis: ~50 llamadas/minuto como techo
  }

  store.at = new Date().toISOString();
  store.window_days = days;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store));
  const all = Object.values(store.matches);
  const withTeams = all.filter((m) => m.r_id && m.d_id).length;
  console.log(`[dota] LISTO · ${all.length} partidas (${added} nuevas) · con los dos equipos identificados: ${withTeams}`);
  if (all.length) {
    const ts = all.map((m) => m.at).filter(Boolean);
    console.log(`[dota] rango ${new Date(Math.min(...ts) * 1000).toISOString().slice(0, 10)} → ${new Date(Math.max(...ts) * 1000).toISOString().slice(0, 10)}`);
    console.log(`[dota] tasa de victoria de Radiant: ${(100 * all.filter((m) => m.r_win).length / all.length).toFixed(2)}%`);
  }
}

main().catch((e) => { console.error('[dota] error:', e.message); process.exit(1); });
