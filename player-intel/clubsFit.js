// player-intel/clubsFit.js — F2.2: adapta el player-history de una liga de clubes al MISMO fitres que el
// Mundial, para reusar buildScout/radar SIN bifurcar el engine (regla de Alexis: mismos módulos parametrizados
// por competición). No hay motor nuevo: fitPlayers (prop-engine) + buildScout (player-intel/scout) tal cual.
// Percentiles calculados vs jugadores CONFIABLES DE LA LIGA (no del Mundial) → un delantero de Liga MX se
// compara con delanteros de Liga MX, exactamente como Yamal vs delanteros del Mundial.
'use strict';
const fs = require('fs');
const path = require('path');
const { fitPlayers, projectTeam } = require('../prop-engine/players');
const { buildScout } = require('./scout');

const _cache = {}; // liga → { at, fit }
const _rowsCache = {}; // liga → { at, rows }  (filas crudas jugador-partido, para el match-by-match)
const TTL = 30 * 60e3;

// Los player-history son grandes (~12MB total) → NO viven en git (inflan el clone del deploy). Se sirven del
// disco persistente de Render (<dir(DB_FILE)>/clubs/) si están ahí; fallback al repo (data/clubs/) para dev.
function clubDataFile(name) {
  const disk = process.env.DB_FILE ? path.join(path.dirname(process.env.DB_FILE), 'clubs', name) : null;
  if (disk) { try { if (fs.existsSync(disk)) return disk; } catch { /* */ } }
  return path.join(__dirname, '..', 'data', 'clubs', name);
}

function leagueRows(league) {
  const c = _rowsCache[league];
  if (c && Date.now() - c.at < TTL) return c.rows;
  let rows = [];
  try { rows = (JSON.parse(fs.readFileSync(clubDataFile(`player-history-${league}.json`), 'utf8')).rows) || []; } catch { rows = []; }
  _rowsCache[league] = { at: Date.now(), rows };
  return rows;
}
// MATCH BY MATCH de un jugador: sus partidos con oponente (el otro equipo del mismo match), más recientes primero.
function clubPlayerMatches(league, pid, ratings) {
  const rows = leagueRows(league);
  const mine = rows.filter(r => r.pid === pid);
  if (!mine.length) return [];
  // índice de equipos por match para derivar el oponente
  const teamsByMatch = {};
  for (const r of rows) { (teamsByMatch[r.match] = teamsByMatch[r.match] || new Set()).add(r.team); }
  const nameOf = (tid) => (ratings && ratings[tid] && ratings[tid].name) || tid;
  return mine
    .map(r => {
      const others = [...(teamsByMatch[r.match] || [])].filter(t => t !== r.team);
      return { date: r.date, opp: others.length ? nameOf(others[0]) : '', min: r.min, sh: r.shots, sot: r.sot, g: r.goals, xg: r.xg != null ? +Number(r.xg).toFixed(2) : null };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 12);
}

// carga (memo) el fitres de una liga desde data/clubs/player-history-<liga>.json
function leagueFit(league) {
  const c = _cache[league];
  if (c && Date.now() - c.at < TTL) return c.fit;
  // clubDataFile: disco persistente de Render primero (los player-history NO viven en git desde el 14-jul) —
  // leer el path del repo directo dejaba fit=null EN PROD (radar/scout/intel/props muertos silenciosamente).
  const file = clubDataFile(`player-history-${league}.json`);
  let rows = [];
  try { rows = (JSON.parse(fs.readFileSync(file, 'utf8')).rows) || []; } catch { rows = []; }
  if (!rows.length) { _cache[league] = { at: Date.now(), fit: null }; return null; }
  // agrupar filas jugador-partido por match → forma que fitPlayers espera
  const byMatch = {};
  for (const r of rows) (byMatch[r.match] = byMatch[r.match] || []).push(r);
  const matches = Object.values(byMatch).map(players => ({ players }));
  const fit = fitPlayers(matches);
  _cache[league] = { at: Date.now(), fit };
  return fit;
}

// share ofensivo del jugador dentro de su equipo (xG del jugador / xG del equipo), para el eje attack_share.
function attackShare(fit, pid) {
  const pl = fit.players[pid]; if (!pl || !pl.team) return null;
  const mates = Object.values(fit.players).filter(x => x.team === pl.team);
  const teamXg = mates.reduce((s, x) => s + (x.xg90 * x.minutes / 90), 0);
  if (teamXg <= 0) return null;
  return +((pl.xg90 * pl.minutes / 90) / teamXg).toFixed(3);
}

// scouting completo de un jugador de club: ejes de radar + arquetipo + scout read + tasas/90 crudas.
function clubPlayerScout(league, pid) {
  const fit = leagueFit(league);
  if (!fit || !fit.players[pid]) return null;
  const pl = fit.players[pid];
  const share = attackShare(fit, pid);
  const scout = buildScout(fit, pid, { attackShare: share });
  return {
    stats_available: true,
    minutes: pl.minutes, apps: pl.apps, starts: pl.starts, goals: pl.goals, assists: pl.assists,
    xg90: +pl.xg90.toFixed(2), shots90: +pl.shots90.toFixed(2), sot90: +pl.sot90.toFixed(2), xa90: +pl.xa90.toFixed(2),
    yc: pl.yc, rc: pl.rc, reliable: pl.reliable, attack_share: share,
    scout, // { axes, archetype, read } — mismo shape que el perfil del Mundial
  };
}

// MATCH INTEL de un cruce: anotadores probables de cada equipo (P(gol), remates esperados) dado el λ GP del
// partido. Mismo projectTeam del Mundial. Devuelve { home:[...], away:[...] } o null si no hay fit de la liga.
function clubMatchIntel(league, homeId, awayId, lambdaHome, lambdaAway) {
  const fit = leagueFit(league);
  if (!fit) return null;
  const side = (teamId, lam) => projectTeam(fit, teamId, { teamLambda: lam, top: 5 })
    .filter(p => p.reliable)
    .map(p => ({ pid: p.pid, name: p.name, pos: p.pos, anytime: +p.anytime_goal.toFixed(3), shots: +p.shots_match.toFixed(1), xg: +p.xg_match.toFixed(2) }));
  const home = side(homeId, lambdaHome), away = side(awayId, lambdaAway);
  if (!home.length && !away.length) return null;
  return { home, away };
}

module.exports = { leagueFit, clubPlayerScout, clubMatchIntel, clubPlayerMatches };
