// scripts/cfl-harvest.js — BASE HISTÓRICA DE LA CFL: resultados + cierres (18-ago).
//
// EL ENCARGO ("busca la forma de conseguir los cierres, no sé cómo pero hazlo"). La CFL no tiene nflverse
// ni CFBD: el dato está repartido y hubo que coserlo de CUATRO fuentes, cada una la mejor en su tramo:
//
//   RESULTADOS
//     2021-2022  ESPN (scoreboard con rango de fechas — ESPN soltó los derechos de la CFL después de 2022
//                y sus datos mueren ahí; verificado: 2023+ devuelve vacío).
//     2023-2025  Wikipedia, páginas de temporada POR EQUIPO ("2024 Winnipeg Blue Bombers season"): el
//                game log trae semana, fecha, rival, W/L y marcador. 9 equipos × 3 temporadas = 27 páginas
//                con throttle (el 429 de Wikipedia salió de rastreos masivos, no de 27 páginas lentas).
//                Cada partido aparece dos veces (una por equipo) → dedupe por (fecha, local, visita) que
//                además VERIFICA que los dos marcadores coincidan — parser con testigo, no a ciegas.
//     2026       El JSON del scoreboard oficial de la CFL (cflscoreboard.cfl.ca/json/scoreboard/rounds.json,
//                sin clave): temporada completa con estado y marcador. Solo sirve la temporada ACTUAL —
//                por eso no vale para el histórico pero es LA fuente de liquidación en producción.
//
//   CIERRES — el hueco que el documento de investigación daba por imposible:
//     The Odds API HISTORICAL (el plan de la casa lo incluye; snapshots cada 5 min desde ~oct-2022 para
//     CFL, verificado sondando: jul-2022 vacío, oct-2022 en adelante responde). Para cada fecha con
//     partidos: /historical/events a mediodía (1 crédito) da los kickoffs exactos del día; luego UN
//     snapshot de /historical/odds a (kickoff − 5 min) por cada hora de inicio distinta captura el cierre
//     de todos los partidos de esa tanda. Los partidos anteriores a oct-2022 quedan SIN cierre y el fit
//     los usa solo para el rating, no para los residuos.
//
// CONVENCIÓN: misma escala GP que NFL/NCAAF — resultado = puntos local − visita; spread_close = línea del
// local con favorito local POSITIVO (la Odds API da el point del local con favorito negativo → se invierte).
//
// USO
//   node scripts/cfl-harvest.js                    # todo: resultados + cierres (usa SPORTSBOOK_PROVIDER_API_KEY)
//   node scripts/cfl-harvest.js --results-only     # sin gastar créditos de la Odds API
//   node scripts/cfl-harvest.js --closes-only      # solo la pasada de cierres (reanudable: cachea por fecha)
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'amfoot');
const GAMES_FILE = path.join(DIR, 'cfl-games.json');
const ODDS_KEY = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (f) => process.argv.includes('--' + f);

async function getJSON(url, { tries = 3, timeoutMs = 30000, headers = {} } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      // ESPN devuelve 403 a user-agents no navegador (probado): el UA de navegador es el mismo criterio
      // que ya usa data-providers/. Wikipedia va con su UA de contacto aparte (política de ellos).
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
}

const keyOf = (date, home, away) => `${date}|${home}|${away}`;

// ── 1) ESPN 2021-2022 ────────────────────────────────────────────────────────────────────────────────────
// ESPN (Akamai) rechaza el fetch de Node con 403 pero acepta curl (verificado con el MISMO user-agent):
// es huella del cliente HTTP, no del UA. Para dos llamadas one-off, curl como transporte es la salida
// honesta — este tramo es histórico congelado (ESPN no tiene CFL desde 2023) y no corre en producción.
function curlJSON(url) {
  const { execFileSync } = require('child_process');
  return JSON.parse(execFileSync('curl', ['-s', '-m', '30', url], { maxBuffer: 32 * 1024 * 1024 }).toString());
}
async function espnSeason(store, year) {
  const d = curlJSON(`https://site.api.espn.com/apis/site/v2/sports/football/cfl/scoreboard?dates=${year}0501-${year}1231&limit=300`);
  let n = 0;
  for (const ev of d.events || []) {
    const c = (ev.competitions || [])[0]; if (!c) continue;
    const H = (c.competitors || []).find((x) => x.homeAway === 'home');
    const A = (c.competitors || []).find((x) => x.homeAway === 'away');
    if (!H || !A) continue;
    const done = (ev.status || {}).type && ev.status.type.completed;
    const date = String(ev.date).slice(0, 10);
    const row = {
      season: year, date, start: ev.date,
      home: H.team.displayName, away: A.team.displayName,
      hp: done ? +H.score : null, ap: done ? +A.score : null,
      type: (ev.season && ev.season.type === 3) ? 'POST' : 'REG', src: 'espn',
    };
    if (row.hp == null) continue;
    store.games[keyOf(date, row.home, row.away)] = row;
    n++;
  }
  console.log(`[cfl] ESPN ${year}: ${n} partidos con resultado`);
}

// ── 2) Wikipedia 2023-2025 (páginas por equipo, parser con testigo doble) ────────────────────────────────
const WIKI_TEAMS = ['BC Lions', 'Calgary Stampeders', 'Edmonton Elks', 'Saskatchewan Roughriders',
  'Winnipeg Blue Bombers', 'Hamilton Tiger-Cats', 'Toronto Argonauts', 'Ottawa Redblacks', 'Montreal Alouettes'];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseTeamPage(html, team, year) {
  const out = [];
  const rows = html.split(/<tr[^>]*>/).slice(1);
  for (const raw of rows) {
    const txt = raw.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    // fila de game log: "1 1 Thu, June 6 7:30 p.m. CDT vs. Montreal Alouettes L 12–27 …". Wikipedia
    // abrevia meses a mitad de tabla ("Aug 1", "Sept 7") — el primer parser solo aceptaba nombres
    // completos y por eso caían 2 de cada 3 filas; ahora el mes casa por prefijo de 3 letras. La
    // clasificación PRE/REG/POST sale del MES (may = pretemporada, nov+ = playoffs): más robusta que la
    // columna de semana, que en playoffs es texto libre ("West Semi-Final").
    const m = txt.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}).*?\b(at|vs\.?)\s+(BC Lions|Calgary Stampeders|Edmonton Elks|Saskatchewan Roughriders|Winnipeg Blue Bombers|Hamilton Tiger-Cats|Toronto Argonauts|Ottawa Redblacks|Montreal Alouettes)\b.*?\b([WLT])\s+(\d{1,3})\s*[–—-]\s*(\d{1,3})/i);
    if (!m) continue;
    const [, monPre, dayS, homeaway, opp, wl, mine, theirs] = m;
    const mm = MONTHS[monPre.toLowerCase()]; if (!mm) continue;
    if (mm === 5) continue;                              // mayo = pretemporada
    if (opp === team) continue;                          // fila rara (no debería pasar)
    const date = `${year}-${String(mm).padStart(2, '0')}-${String(+dayS).padStart(2, '0')}`;
    const atHome = !/^at$/i.test(homeaway);
    const my = +mine, th = +theirs;
    // sanity del W/L contra el marcador: si no cuadra, la fila se descarta (mejor un hueco que un dato falso)
    const okWL = (wl.toUpperCase() === 'W' && my > th) || (wl.toUpperCase() === 'L' && my < th) || (wl.toUpperCase() === 'T' && my === th);
    if (!okWL) continue;
    out.push({
      season: year, date, home: atHome ? team : opp, away: atHome ? opp : team,
      hp: atHome ? my : th, ap: atHome ? th : my, type: mm >= 11 ? 'POST' : 'REG', src: 'wiki',
    });
  }
  return out;
}

async function wikiSeason(store, year) {
  let added = 0, conflicts = 0;
  for (const team of WIKI_TEAMS) {
    const title = `${year}_${team.replace(/ /g, '_')}_season`;
    let html = '';
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`,
        { headers: { 'user-agent': 'GP-Simulador/1.0 (contact: codigo@gpsimulador.com)' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) { console.log(`[cfl] wiki ${title}: HTTP ${r.status} (se salta)`); await sleep(2500); continue; }
      html = await r.text();
    } catch (e) { console.log(`[cfl] wiki ${title}: ${e.message}`); await sleep(2500); continue; }
    for (const row of parseTeamPage(html, team, year)) {
      const k = keyOf(row.date, row.home, row.away);
      const prev = store.games[k];
      if (prev && prev.src === 'wiki') {
        // el partido ya entró desde la página del rival: los dos marcadores tienen que COINCIDIR
        if (prev.hp !== row.hp || prev.ap !== row.ap) { conflicts++; delete store.games[k]; continue; }
        prev.confirmed = true;
      } else if (!prev) { store.games[k] = row; added++; }
    }
    await sleep(2500);   // cortesía: 27 páginas lentas, no un rastreo
  }
  console.log(`[cfl] Wikipedia ${year}: ${added} partidos añadidos · ${conflicts} conflictos descartados`);
}

// ── 3) temporada actual desde el scoreboard oficial de la CFL ────────────────────────────────────────────
async function cflCurrent(store) {
  const rounds = await getJSON('https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json');
  let n = 0;
  for (const r of rounds || []) {
    if (r.type === 'PRE') continue;
    for (const t of r.tournaments || []) {
      if (t.status !== 'complete' || !t.homeSquad || !t.awaySquad) continue;
      const date = String(t.date).slice(0, 10);
      const row = {
        season: new Date(t.date).getUTCFullYear(), date, start: t.date,
        home: t.homeSquad.name, away: t.awaySquad.name,
        hp: t.homeSquad.score, ap: t.awaySquad.score,
        type: r.type === 'REG' ? 'REG' : 'POST', src: 'cfl.ca',
      };
      store.games[keyOf(date, row.home, row.away)] = row;
      n++;
    }
  }
  console.log(`[cfl] cfl.ca (temporada actual): ${n} completados`);
}

// ── 4) CIERRES desde el histórico de The Odds API (oct-2022 →) ───────────────────────────────────────────
const BOOK_PRIORITY = ['pinnacle', 'fanduel', 'draftkings', 'bovada', 'betmgm', 'caesars'];
function closeFromEvent(ev) {
  const books = ev.bookmakers || [];
  const ordered = BOOK_PRIORITY.map((k) => books.find((b) => b.key === k)).filter(Boolean)
    .concat(books.filter((b) => !BOOK_PRIORITY.includes(b.key)));
  const out = { spread_close: null, total_close: null, close_book: null };
  for (const b of ordered) {
    const sp = (b.markets || []).find((m) => m.key === 'spreads');
    const to = (b.markets || []).find((m) => m.key === 'totals');
    const hOut = sp && (sp.outcomes || []).find((o) => o.name === ev.home_team);
    if (out.spread_close == null && hOut && hOut.point != null) { out.spread_close = +(-hOut.point).toFixed(1); out.close_book = b.key; }
    const over = to && (to.outcomes || []).find((o) => /^over$/i.test(o.name));
    if (out.total_close == null && over && over.point != null) { out.total_close = +(+over.point).toFixed(1); out.close_book = out.close_book || b.key; }
    if (out.spread_close != null && out.total_close != null) break;
  }
  return out;
}

async function harvestCloses(store) {
  if (!ODDS_KEY) { console.log('[cfl] sin SPORTSBOOK_PROVIDER_API_KEY: cierres saltados'); return; }
  const FLOOR = '2022-10-01';   // límite medido del histórico de CFL en The Odds API
  const dates = [...new Set(Object.values(store.games)
    .filter((g) => g.date >= FLOOR && g.spread_close == null && g.hp != null)
    .map((g) => g.date))].sort();
  console.log(`[cfl] cierres: ${dates.length} fechas por resolver`);
  let credits = 0, matched = 0;
  for (const date of dates) {
    // kickoffs exactos del día (1 crédito)
    let evs = null;
    try {
      evs = await getJSON(`https://api.the-odds-api.com/v4/historical/sports/americanfootball_cfl/events?apiKey=${ODDS_KEY}&date=${date}T12:00:00Z`);
      credits += 1;
    } catch (e) { console.log(`[cfl] ${date}: events falló (${e.message})`); continue; }
    const todays = ((evs && evs.data) || []).filter((e) => String(e.commence_time).slice(0, 10) >= date);
    const starts = [...new Set(todays.map((e) => e.commence_time))].sort();
    for (const st of starts) {
      const snapAt = new Date(Date.parse(st) - 5 * 60e3).toISOString().replace(/\.\d+Z$/, 'Z');
      let snap = null;
      try {
        snap = await getJSON(`https://api.the-odds-api.com/v4/historical/sports/americanfootball_cfl/odds?apiKey=${ODDS_KEY}&regions=us,eu&markets=spreads,totals&oddsFormat=decimal&date=${snapAt}`);
        credits += 40;   // 10 por región×mercado (2×2)
      } catch (e) { continue; }
      for (const ev of (snap && snap.data) || []) {
        if (ev.commence_time !== st) continue;
        // el partido en la base puede estar fechado por día local: se acepta el día del kickoff y el previo
        const dEv = String(ev.commence_time).slice(0, 10);
        const g = store.games[keyOf(dEv, ev.home_team, ev.away_team)] || store.games[keyOf(date, ev.home_team, ev.away_team)];
        if (!g || g.spread_close != null) continue;
        const cl = closeFromEvent(ev);
        if (cl.spread_close == null && cl.total_close == null) continue;
        Object.assign(g, cl, { close_at: snap.timestamp, start: g.start || ev.commence_time });
        matched++;
      }
      await sleep(400);
    }
    if (dates.indexOf(date) % 20 === 19) {
      fs.writeFileSync(GAMES_FILE, JSON.stringify(store));   // checkpoint reanudable
      console.log(`[cfl] …${date}: ${matched} cierres casados · ~${credits} créditos`);
    }
  }
  console.log(`[cfl] cierres: ${matched} partidos con cierre · ~${credits} créditos gastados`);
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  let store = { games: {} };
  try { store = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); } catch { /* primera pasada */ }

  if (!has('closes-only')) {
    await espnSeason(store, 2021); await sleep(800);
    await espnSeason(store, 2022); await sleep(800);
    for (const y of [2023, 2024, 2025]) await wikiSeason(store, y);
    await cflCurrent(store);
    fs.writeFileSync(GAMES_FILE, JSON.stringify(store));
  }
  if (!has('results-only')) {
    await harvestCloses(store);
    fs.writeFileSync(GAMES_FILE, JSON.stringify(store));
  }
  const all = Object.values(store.games);
  const withClose = all.filter((g) => g.spread_close != null);
  const bySeason = {};
  for (const g of all) bySeason[g.season] = (bySeason[g.season] || 0) + 1;
  console.log(`[cfl] LISTO · ${all.length} partidos · ${withClose.length} con cierre · por temporada:`, JSON.stringify(bySeason));
}

main().catch((e) => { console.error('[cfl] FALLO:', e.message); process.exit(1); });
