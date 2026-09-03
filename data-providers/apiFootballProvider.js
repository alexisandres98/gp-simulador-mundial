// apiFootballProvider.js — FUENTE PRINCIPAL de la Fase 4.
// Provider server-side de API-Football (api-sports.io / RapidAPI). La API key NUNCA
// llega al frontend: vive en el servidor (env API_FOOTBALL_KEY) y la UI solo recibe
// data ya normalizada vía /api/match/:id y /api/teamdetail/:id.
//
// Variables de entorno:
//   API_FOOTBALL_KEY        (preferida)  — también se acepta VITE_API_FOOTBALL_KEY como alias
//   API_FOOTBALL_HOST       (opcional)   — default v3.football.api-sports.io (dashboard directo)
//                                          usar api-football-v1.p.rapidapi.com para RapidAPI
//   API_FOOTBALL_LEAGUE     (opcional)   — default 1 (FIFA World Cup)
//   API_FOOTBALL_SEASON     (opcional)   — default 2026
//
// Si NO hay key configurada, todas las funciones devuelven null/[] sin lanzar:
// la app sigue funcionando con ESPN + manual + modelo (fallback elegante).

const cache = require('./cache');

const KEY = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
const HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const LEAGUE = Number(process.env.API_FOOTBALL_LEAGUE || 1);
const SEASON = Number(process.env.API_FOOTBALL_SEASON || 2026);
const isRapid = /rapidapi\.com$/i.test(HOST);

function configured() { return !!KEY; }

function headers() {
  return isRapid
    ? { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST }
    : { 'x-apisports-key': KEY };
}

// GET genérico al endpoint v3. Devuelve el array `response` o [] ante cualquier fallo.
async function call(path, params = {}) {
  if (!KEY) return [];
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)])
  ).toString();
  // El host directo (v3.football.api-sports.io) YA lleva la versión en el subdominio → path sin /v3.
  // RapidAPI sí requiere el prefijo /v3/.
  const base = isRapid ? `https://${HOST}/v3/` : `https://${HOST}/`;
  const url = `${base}${path}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`API-Football ${path} → HTTP ${r.status}`);
  const j = await r.json();
  if (j && j.errors && Object.keys(j.errors).length) {
    // errors puede traer {requests, plan, token...}; lo logueamos pero no rompemos
    const msg = Object.values(j.errors).join('; ');
    if (msg) console.warn(`[apifootball] ${path}: ${msg}`);
  }
  return (j && j.response) || [];
}

// ---- descubrimiento + cache de IDs de equipo (nuestro 'ESP' → id numérico API-Football) ----
// Semilla manual opcional en data/manual/apifootball_ids.json; el resto se descubre por búsqueda.
let seedIds = null;
function loadSeed() {
  if (seedIds) return seedIds;
  try { seedIds = require('../data/manual/apifootball_ids.json'); }
  catch { seedIds = {}; }
  return seedIds;
}

// teamCode = nuestro id (p.ej. 'ESP'); searchName = nombre en inglés (p.ej. 'Spain')
async function resolveTeamId(teamCode, searchName) {
  if (!KEY) return null;
  const seed = loadSeed();
  if (seed[teamCode] && seed[teamCode].teamId) return seed[teamCode].teamId;
  return cache.wrap(`af:teamid:${teamCode}`, cache.TTL.teamMeta, async () => {
    const res = await call('teams', { search: searchName });
    // preferimos selecciones nacionales
    const national = res.find(x => x.team && x.team.national) || res[0];
    return national && national.team ? national.team.id : null;
  });
}

// ---- FIXTURES / PARTIDOS ----
async function getFixtures() {
  return cache.wrap('af:fixtures', cache.TTL.fixtures, () =>
    call('fixtures', { league: LEAGUE, season: SEASON }));
}
async function getFixtureById(fixtureId) {
  if (!fixtureId) return null;
  return cache.wrap(`af:fixture:${fixtureId}`, cache.TTL.liveFixture, async () => {
    const r = await call('fixtures', { id: fixtureId });
    return r[0] || null;
  });
}
// Árbitro designado de un fixture (fixture.referee). Cache propia de 6 h (el de getFixtureById es de 45 s,
// pensado para el marcador en vivo). Sin key o sin dato → null, nunca lanza. Un null se cachea 30 s (wrap).
async function getFixtureReferee(fixtureId) {
  if (!fixtureId || !KEY) return null;
  const v = await cache.wrap(`af:referee:${fixtureId}`, cache.TTL.referee, async () => {
    const r = await call('fixtures', { id: fixtureId });
    const fx = r[0] && r[0].fixture;
    return (fx && fx.referee) ? String(fx.referee).trim() : '';
  });
  return v || null;
}
async function getLiveFixtures() {
  return cache.wrap('af:live', cache.TTL.liveFixture, () =>
    call('fixtures', { league: LEAGUE, season: SEASON, live: 'all' }));
}
// Localiza un fixture por equipos+fecha (cuando no tenemos el id de API-Football)
async function findFixture(homeApiId, awayApiId, isoDate) {
  if (!KEY || !homeApiId || !awayApiId) return null;
  const day = (isoDate || '').slice(0, 10);
  return cache.wrap(`af:findfix:${homeApiId}:${awayApiId}:${day}`, cache.TTL.fixtures, async () => {
    const params = { league: LEAGUE, season: SEASON, h2h: `${homeApiId}-${awayApiId}` };
    if (day) params.date = day;
    let res = await call('fixtures/headtohead', params);
    if (!res.length && day) res = await call('fixtures/headtohead', { h2h: `${homeApiId}-${awayApiId}` });
    // el más cercano a la fecha objetivo
    if (day && res.length) {
      const target = new Date(day + 'T12:00Z').getTime();
      res.sort((a, b) => Math.abs(new Date(a.fixture.date) - target) - Math.abs(new Date(b.fixture.date) - target));
    }
    return res[0] || null;
  });
}

async function getFixtureEvents(fixtureId) {
  if (!fixtureId) return [];
  return cache.wrap(`af:events:${fixtureId}`, cache.TTL.events, () =>
    call('fixtures/events', { fixture: fixtureId }));
}
async function getFixtureStatistics(fixtureId) {
  if (!fixtureId) return [];
  return cache.wrap(`af:stats:${fixtureId}`, cache.TTL.statistics, () =>
    call('fixtures/statistics', { fixture: fixtureId }));
}
async function getFixtureLineups(fixtureId) {
  if (!fixtureId) return [];
  return cache.wrap(`af:lineups:${fixtureId}`, cache.TTL.lineups, () =>
    call('fixtures/lineups', { fixture: fixtureId }));
}
async function getFixtureOdds(fixtureId) {
  if (!fixtureId) return [];
  return cache.wrap(`af:odds:${fixtureId}`, cache.TTL.odds, () =>
    call('odds', { fixture: fixtureId, league: LEAGUE, season: SEASON }));
}
async function getPredictions(fixtureId) {
  if (!fixtureId) return null;
  return cache.wrap(`af:pred:${fixtureId}`, cache.TTL.predictions, async () => {
    const r = await call('predictions', { fixture: fixtureId });
    return r[0] || null;
  });
}

// ---- EQUIPOS / JUGADORES ----
async function getTeamById(teamApiId) {
  if (!teamApiId) return null;
  return cache.wrap(`af:team:${teamApiId}`, cache.TTL.teamMeta, async () => {
    const r = await call('teams', { id: teamApiId });
    return r[0] || null;
  });
}
async function getTeamSquad(teamApiId) {
  if (!teamApiId) return [];
  return cache.wrap(`af:squad:${teamApiId}`, cache.TTL.squad, async () => {
    const r = await call('players/squads', { team: teamApiId });
    return (r[0] && r[0].players) || [];
  });
}
async function getTeamPlayers(teamApiId) {
  if (!teamApiId) return [];
  return cache.wrap(`af:players:${teamApiId}`, cache.TTL.players, () =>
    call('players', { team: teamApiId, season: SEASON }));
}
async function getTeamInjuries(teamApiId) {
  if (!teamApiId) return [];
  return cache.wrap(`af:inj:${teamApiId}`, cache.TTL.injuries, () =>
    call('injuries', { team: teamApiId, league: LEAGUE, season: SEASON }));
}
async function getTeamSidelined(teamApiId) {
  // El endpoint /sidelined de API-Football NO acepta `team` (solo player/coach) → devolvía siempre el error
  // "The Team field do not exist" y ensuciaba el contexto. Las lesiones vigentes vienen de /injuries. Desactivado.
  return [];
}
async function getTeamFixtures(teamApiId, last = 0, next = 0) {
  if (!teamApiId) return [];
  const params = { team: teamApiId, season: SEASON };
  if (last) params.last = last;
  if (next) params.next = next;
  const tag = `af:teamfix:${teamApiId}:${last}:${next}`;
  return cache.wrap(tag, cache.TTL.form, () => call('fixtures', params));
}
async function getTeamRecentResults(teamApiId, n = 5) {
  if (!teamApiId) return [];
  return cache.wrap(`af:recent:${teamApiId}:${n}`, cache.TTL.form, () =>
    call('fixtures', { team: teamApiId, last: n }));
}
async function getHeadToHead(aApiId, bApiId, n = 10) {
  if (!aApiId || !bApiId) return [];
  return cache.wrap(`af:h2h:${aApiId}:${bApiId}:${n}`, cache.TTL.h2h, () =>
    call('fixtures/headtohead', { h2h: `${aApiId}-${bApiId}`, last: n }));
}
async function getStandings(leagueId = LEAGUE, season = SEASON) {
  return cache.wrap(`af:standings:${leagueId}:${season}`, cache.TTL.standings, () =>
    call('standings', { league: leagueId, season }));
}
// team statistics (forma, medias) — requiere fixture de liga; útil para la página de equipo
async function getTeamStatistics(teamApiId) {
  if (!teamApiId) return null;
  return cache.wrap(`af:teamstats:${teamApiId}`, cache.TTL.form, async () => {
    const r = await call('teams/statistics', { team: teamApiId, league: LEAGUE, season: SEASON });
    return r && r.league ? r : (Array.isArray(r) ? r[0] : r) || null;
  });
}

module.exports = {
  configured, resolveTeamId,
  getFixtures, getFixtureById, getFixtureReferee, getLiveFixtures, findFixture,
  getFixtureEvents, getFixtureStatistics, getFixtureLineups, getFixtureOdds, getPredictions,
  getTeamById, getTeamSquad, getTeamPlayers, getTeamInjuries, getTeamSidelined,
  getTeamFixtures, getTeamRecentResults, getHeadToHead, getStandings, getTeamStatistics,
  LEAGUE, SEASON,
};
