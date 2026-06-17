// espnProvider.js — FUENTE SECUNDARIA / FALLBACK (nunca principal).
// API pública no oficial de ESPN (fifa.world). Sirve para validar marcador/calendario,
// traer resúmenes, eventos, stats y titulares cuando API-Football no entrega o no está configurada.
// Nunca lanza: ante cualquier fallo devuelve null/[] para no afectar la experiencia.

const cache = require('./cache');

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

async function getJSON(url, ttlKey, ttl) {
  return cache.wrap(`espn:${ttlKey}`, ttl, async () => {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
    return r.json();
  });
}

async function getFixtures() {
  const j = await getJSON(`${BASE}/scoreboard?limit=250`, 'scoreboard', cache.TTL.fixtures);
  return (j && j.events) || [];
}

// Resumen completo de un partido por su espnId (eventos, stats, rosters, comentarios)
async function getMatchSummary(espnEventId) {
  if (!espnEventId) return null;
  return getJSON(`${BASE}/summary?event=${espnEventId}`, `summary:${espnEventId}`, cache.TTL.events);
}

async function getMatchEvents(espnEventId) {
  const s = await getMatchSummary(espnEventId);
  if (!s) return [];
  // ESPN expone jugadas clave en keyEvents / commentary
  return (s.keyEvents || s.commentary || []);
}

async function getMatchStats(espnEventId) {
  const s = await getMatchSummary(espnEventId);
  if (!s || !s.boxscore) return null;
  return s.boxscore; // { teams: [{ team, statistics: [...] }] }
}

// Titulares de la competición (fallback de noticias; ESPN no segmenta bien por selección)
async function getTeamNews() {
  const j = await getJSON(`${BASE}/news`, 'news', cache.TTL.injuries);
  return (j && j.articles) || [];
}

async function getTeamSchedule(espnTeamId) {
  if (!espnTeamId) return [];
  const j = await getJSON(`${BASE}/teams/${espnTeamId}/schedule`, `sched:${espnTeamId}`, cache.TTL.form);
  return (j && j.events) || [];
}

module.exports = {
  getFixtures, getMatchSummary, getMatchEvents, getMatchStats, getTeamNews, getTeamSchedule,
};
