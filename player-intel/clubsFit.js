// player-intel/clubsFit.js — F2.2: adapta el player-history de una liga de clubes al MISMO fitres que el
// Mundial, para reusar buildScout/radar SIN bifurcar el engine (regla de Alexis: mismos módulos parametrizados
// por competición). No hay motor nuevo: fitPlayers (prop-engine) + buildScout (player-intel/scout) tal cual.
// Percentiles calculados vs jugadores CONFIABLES DE LA LIGA (no del Mundial) → un delantero de Liga MX se
// compara con delanteros de Liga MX, exactamente como Yamal vs delanteros del Mundial.
'use strict';
const fs = require('fs');
const path = require('path');
const { fitPlayers } = require('../prop-engine/players');
const { buildScout } = require('./scout');

const _cache = {}; // liga → { at, fit }
const TTL = 30 * 60e3;

// carga (memo) el fitres de una liga desde data/clubs/player-history-<liga>.json
function leagueFit(league) {
  const c = _cache[league];
  if (c && Date.now() - c.at < TTL) return c.fit;
  const file = path.join(__dirname, '..', 'data', 'clubs', `player-history-${league}.json`);
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

module.exports = { leagueFit, clubPlayerScout };
