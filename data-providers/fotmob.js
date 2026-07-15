// fotmob.js — Provider server-side de event data fino (shotmap con SITUACIÓN de cada remate: de córner /
// jugada / balón parado / contragolpe / penal, coordenadas x-y, xG/xGOT, dentro/fuera del área) + momentum.
// Es la capa de event data que Opta/StatsBomb venden y acá se obtiene del API público de FotMob (mismo dato
// Opta por debajo — playerStats trae optaId). SIN key. USO EDUCADO Y ACOTADO: solo partidos TERMINADOS,
// 1 request cada ~2.5s, cache permanente (patrón theStatsApi: 1 fetch por partido en la vida del server).
// Si FotMob cierra el path, todo devuelve null sin romper (los consumidores tienen fallback TSA).
'use strict';
const { TEAMS } = require('../data/tournament');

const BASE = 'https://www.fotmob.com/api/data';
const WC_LEAGUE_ID = 894789;   // leagueId que reporta matchDetails.general (página del torneo)
const WC_PRIMARY_ID = 77;      // id canónico del Mundial en el índice de matches (sub-ligas por grupo/fase)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ALIAS_TO_ID = {};
TEAMS.forEach(t => { [t.en, t.name, t.id, ...(t.aliases || [])].filter(Boolean).forEach(a => { ALIAS_TO_ID[norm(a)] = t.id; }); });
ALIAS_TO_ID[norm('Cape Verde Islands')] = 'CPV';
ALIAS_TO_ID[norm('Cabo Verde')] = 'CPV';

let _lastReq = 0;
async function politeFetch(url) {
  const wait = Math.max(0, _lastReq + 2500 - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  _lastReq = Date.now();
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://www.fotmob.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`fotmob HTTP ${r.status}`);
  return r.json();
}

// Partidos del Mundial de una fecha (YYYYMMDD) → [{matchId, home, away, homeCode, awayCode, finished}].
async function matchesByDate(yyyymmdd) {
  const j = await politeFetch(`${BASE}/matches?date=${yyyymmdd}`).catch(() => null);
  if (!j || !Array.isArray(j.leagues)) return [];
  const wc = j.leagues.filter(l => Number(l.primaryId) === WC_PRIMARY_ID || /^world cup/i.test(String(l.name || '')));
  const out = [];
  for (const l of wc) {
    for (const m of (l.matches || [])) {
      out.push({
        matchId: Number(m.id),
        home: m.home && m.home.name, away: m.away && m.away.name,
        homeCode: ALIAS_TO_ID[norm(m.home && (m.home.longName || m.home.name))] || ALIAS_TO_ID[norm(m.home && m.home.name)] || null,
        awayCode: ALIAS_TO_ID[norm(m.away && (m.away.longName || m.away.name))] || ALIAS_TO_ID[norm(m.away && m.away.name)] || null,
        finished: !!(m.status && m.status.finished),
      });
    }
  }
  return out;
}

// Detalle compacto de un partido TERMINADO: remates con situación + momentum. null si no disponible.
async function matchEvents(matchId) {
  const j = await politeFetch(`${BASE}/matchDetails?matchId=${matchId}`).catch(() => null);
  if (!j || !j.general) return null;
  const g = j.general;
  const homeId = g.homeTeam && g.homeTeam.id, awayId = g.awayTeam && g.awayTeam.id;
  const shots = (((j.content || {}).shotmap || {}).shots || []).map(s => ({
    team: s.teamId === homeId ? 'home' : s.teamId === awayId ? 'away' : null,
    player: s.fullName || s.lastName || null,
    playerId: s.playerId || null,
    min: s.min, period: s.period || null,
    x: s.x, y: s.y,
    situation: s.situation || null,           // RegularPlay/FromCorner/SetPiece/DirectFreekick/Penalty/FastBreak/ThrowInSetPiece
    event: s.eventType || null,               // Goal/AttemptSaved/Miss/Post/Blocked
    on_target: !!s.isOnTarget, inside_box: !!s.isFromInsideBox, blocked: !!s.isBlocked,
    xg: s.expectedGoals != null ? +Number(s.expectedGoals).toFixed(4) : null,
    xgot: s.expectedGoalsOnTarget != null ? +Number(s.expectedGoalsOnTarget).toFixed(4) : null,
    shot_type: s.shotType || null,            // LeftFoot/RightFoot/Header/Other
    own_goal: !!s.isOwnGoal,
  })).filter(s => s.team);
  const momentum = (((j.content || {}).momentum || {}).main || {}).data || null;
  return {
    matchId: Number(matchId), finished: !!g.finished,
    home: g.homeTeam && g.homeTeam.name, away: g.awayTeam && g.awayTeam.name,
    homeCode: ALIAS_TO_ID[norm(g.homeTeam && g.homeTeam.name)] || null,
    awayCode: ALIAS_TO_ID[norm(g.awayTeam && g.awayTeam.name)] || null,
    utc: g.matchTimeUTCDate || null,
    shots,
    momentum: Array.isArray(momentum) ? momentum.map(p => ({ m: p.minute, v: p.value })) : null,
  };
}

// FASE CLUBES — fixtures de UNA liga por su primaryId de FotMob (no filtra al Mundial): usa el endpoint de liga
// (/leagues?id=) que lista toda la temporada sin depender de que jueguen ese día. Devuelve [{matchId, home, away,
// finished, utc}] con NOMBRES (la resolución nombre→tm_ la hace el server con los ratings de la liga). Reusa el
// mismo matchEvents (agnóstico de liga) para el shotmap. Uso educado: 1 request de liga + 1 por partido.
async function leagueFixtures(primaryId) {
  const j = await politeFetch(`${BASE}/leagues?id=${primaryId}`).catch(() => null);
  if (!j) return [];
  const all = (j.fixtures && j.fixtures.allMatches) || (j.overview && j.overview.matches && j.overview.matches.allMatches) || [];
  const out = [];
  for (const m of all) {
    if (!m || !m.id) continue;
    out.push({
      matchId: Number(m.id),
      home: m.home && (m.home.name || m.home.longName), away: m.away && (m.away.name || m.away.longName),
      finished: !!(m.status && m.status.finished),
      utc: (m.status && m.status.utcTime) || null,
    });
  }
  return out;
}

module.exports = { matchesByDate, matchEvents, leagueFixtures, WC_LEAGUE_ID, _aliasToId: ALIAS_TO_ID };
