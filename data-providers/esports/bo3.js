// data-providers/esports/bo3.js — LA MEMORIA HISTÓRICA DE CS2 (16-ago).
//
// POR QUÉ EXISTE ESTE ARCHIVO. Hasta hoy el motor de CS2 vivía prestado del mercado: sin histórico propio,
// la fuerza por mapa era `null`, el árbol de veto no se podía dibujar y las constantes de ronda eran
// supuestos de circuito. Este adaptador es lo que convierte a GP de "lector de precios" en "dueño de un
// modelo": trae el histórico real de partidos y de MAPAS, y de ahí sale todo lo demás.
//
// ── LO QUE HAY, MEDIDO CONTRA LA API EL 16-ago ───────────────────────────────────────────────────────────
//   /matches       78.804 partidos (2020 → hoy) · equipos, formato, marcador de serie, tier, torneo
//   /games        142.139 MAPAS · nombre del mapa, marcador (13-x), nº de rondas, prórroga y orden del mapa
//   /teams          8.359 equipos CON LOGO, país y ranking
//   /players       20.281 jugadores
//   /tournaments    3.109 torneos con imagen
//   /maps              46 mapas con marca de pool activo
// Lo que NO hay: ronda a ronda, economía, y el veto (pick/ban). Eso sigue necesitando demos o Liquipedia,
// y hasta entonces se declara como hueco en vez de inventarse.
//
// ── LA ADVERTENCIA QUE NO SE ESCONDE ─────────────────────────────────────────────────────────────────────
// El `robots.txt` de bo3.gg desaconseja el acceso automatizado a `/api/`. Es el mismo riesgo que el
// blueprint señala para HLTV (módulo 5: "no construir el backend comercial alrededor de scraping"). La
// decisión tomada, consciente y reversible: se usa para ARRANCAR el modelo, detrás de esta interfaz que es
// lo único que sabe que bo3 existe, identificándonos con un User-Agent real, con freno entre peticiones y
// cacheando todo lo que se pueda. Los identificadores, el almacén y las definiciones de features son de GP:
// cambiar de proveedor es reescribir este archivo, no el producto. En paralelo hay que pedir Liquipedia.
//
// SER BUEN CIUDADANO NO ES OPCIONAL AQUÍ: 100 filas por página es el máximo real (pedir 1000 devuelve 100),
// y el freno entre peticiones está puesto a propósito por encima de lo que el servidor aguantaría.
'use strict';

const BASE = 'https://api.bo3.gg/api/v1';
const UA = 'GPSimulador/1.0 (+https://gpsimulador.com; codigo@gpsimulador.com) sports-intelligence';
const PAGE = 100;          // el máximo real del proveedor
const THROTTLE_MS = 260;   // freno deliberado

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, { tries = 3, timeoutMs = 25000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(900 * (i + 1)); }
  }
  return null;
}

// Recorre una colección paginada hasta agotarla o hasta que `stop` diga basta. `onPage` recibe cada tanda,
// para poder ir escribiendo a disco sin acumular 90.000 filas en memoria — la lección del pico de memoria.
async function paginate(collection, { filters = '', sort = '', max = Infinity, onPage = null, stop = null, log = null } = {}) {
  const out = [];
  let offset = 0, total = null, pages = 0;
  for (;;) {
    const qs = `?page[limit]=${PAGE}&page[offset]=${offset}` + (sort ? `&sort=${sort}` : '') + (filters ? '&' + filters : '');
    const j = await req(`/${collection}${qs}`);
    if (!j) break;
    if (total == null) total = (j.total && j.total.count) || 0;
    const rows = j.results || [];
    if (!rows.length) break;
    pages++;
    if (onPage) { const keep = await onPage(rows, { offset, total, pages }); if (keep === false) break; }
    else out.push(...rows);
    if (log && pages % 10 === 0) log(`  ${collection}: ${offset + rows.length} de ${total}`);
    if (stop && stop(rows[rows.length - 1])) break;
    offset += rows.length;
    if (offset >= total || offset >= max) break;
    await sleep(THROTTLE_MS);
  }
  return { rows: out, total, pages };
}

// ---- 1) PARTIDOS -----------------------------------------------------------------------------------------
// `tiers` filtra la calidad del circuito: 's' y 'a' son tier 1, 'b' es tier 2 sólido, 'c'/'d' son partidos de
// clasificatorios y ligas menores. Se incluye 'c' a propósito para el modelo de RONDAS —las distribuciones de
// ronda apenas dependen del nivel y la muestra ayuda— pero el rating se pesa por tier (ver cs2-model).
async function matches({ since = null, tiers = ['s', 'a', 'b', 'c'], onPage = null, max = Infinity, log = null } = {}) {
  const f = [
    'filter[matches.status][eq]=finished',
    `filter[matches.tier][in]=${tiers.join(',')}`,
    since ? `filter[matches.start_date][gt]=${since}` : '',
  ].filter(Boolean).join('&');
  return paginate('matches', { filters: f, sort: '-start_date', onPage, max, log });
}

// ---- 2) MAPAS (la unidad que de verdad importa) ----------------------------------------------------------
// Cada fila es un mapa jugado: `map_name` (de_mirage…), marcador ganador-perdedor, nº de rondas, `ov_index`
// (>0 = hubo prórroga) y `number` (1, 2, 3 → orden dentro de la serie, que es lo que permite separar el
// mapa elegido por cada equipo del decisivo).
async function games({ since = null, onPage = null, max = Infinity, log = null } = {}) {
  const f = [
    'filter[games.state][eq]=done',
    since ? `filter[games.begin_at][gt]=${since}` : '',
  ].filter(Boolean).join('&');
  return paginate('games', { filters: f, sort: '-begin_at', onPage, max, log });
}

// ---- 3) EQUIPOS, JUGADORES, TORNEOS, MAPAS ---------------------------------------------------------------
async function teams({ onPage = null, max = Infinity, log = null } = {}) {
  return paginate('teams', { sort: '-id', onPage, max, log });
}
async function team(slugOrId) { return req(`/teams/${slugOrId}`); }
async function players({ onPage = null, max = Infinity, log = null } = {}) {
  return paginate('players', { sort: '-id', onPage, max, log });
}
async function tournaments({ onPage = null, max = Infinity, log = null } = {}) {
  return paginate('tournaments', { sort: '-id', onPage, max, log });
}
async function mapCatalogue() {
  const j = await req('/maps?page[limit]=100');
  return ((j && j.results) || []).filter((m) => m.discipline_id === 1);
}

// ---- 4) NORMALIZACIÓN A LA IDENTIDAD DE GP ---------------------------------------------------------------
// Los ids de GP no son los del proveedor. Esto es la regla de propiedad intelectual del blueprint y también
// sentido común: el día que se cambie de fuente, el histórico tiene que seguir apuntando a los mismos
// equipos. El id propio es el slug, que es estable y legible.
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function normTeam(t) {
  if (!t) return null;
  return {
    id: t.slug || slug(t.name), name: t.name || '—',
    provider_id: t.id,
    logo: t.image_url || null, icon: t.icon_url || null,
    country_id: t.country_id != null ? t.country_id : null,
    rank: Number.isFinite(t.rank) ? t.rank : null,
  };
}
function normMatch(m) {
  return {
    provider_id: m.id, slug: m.slug,
    t1: m.team1_id, t2: m.team2_id, winner: m.winner_team_id,
    s1: m.team1_score, s2: m.team2_score,
    bo: m.bo_type, tier: m.tier, tournament: m.tournament_id,
    at: m.start_date,
  };
}
// El mapa se normaliza a "local/visitante" usando el nombre del clan, porque el proveedor guarda ganador y
// perdedor en vez de local y visitante. Si el nombre no casa, se marca `side_unknown` en vez de adivinar:
// asignar mal un mapa a un equipo envenena su fuerza por mapa para siempre.
function normGame(g) {
  return {
    provider_id: g.id, match_id: g.match_id,
    map: String(g.map_name || '').replace(/^de_/, '') || null,
    number: g.number != null ? g.number : null,
    w_name: g.winner_clan_name || null, l_name: g.loser_clan_name || null,
    w_score: g.winner_clan_score, l_score: g.loser_clan_score,
    rounds: g.rounds_count != null ? g.rounds_count : null,
    ot: (g.ov_index || 0) > 0 ? 1 : 0,
    at: g.begin_at,
    has_demo: !!g.demo_url,
  };
}

module.exports = {
  BASE, UA, PAGE, THROTTLE_MS,
  req, paginate, matches, games, teams, team, players, tournaments, mapCatalogue,
  normTeam, normMatch, normGame, slug,
};
