// nfl-engine/data.js — LA BASE PROPIA DE NFL (17-ago, blueprint V0.5).
//
// Sirve los agregados versionados de `data/nfl/` y deriva los DOS estados que el blueprint exige separar:
//   · RATING en puntos (opponent-adjusted, recency-weighted, point-in-time) — la fuerza que fija el margen.
//   · ESTADOS EPA (pase/carrera, ofensa/defensa) — el ESTILO y el mecanismo, que fijan el total y el relato.
//
// LAS TRES REGLAS DEL BLUEPRINT QUE ESTE ARCHIVO HACE CUMPLIR:
//   · NFL-0100 / NFL-0741+: point-in-time o no existe. TODA función acepta un corte (season, week) y solo
//     mira partidos ANTERIORES. No hay camino de código que lea el futuro.
//   · NFL-0032/0033: en septiembre manda el prior (temporada anterior encogida); el peso de 2026 crece con
//     la muestra. El shrinkage es explícito, no un accidente.
//   · NFL-0131: métricas de proceso (EPA) separadas de métricas de resultado (margen). Las dos viajan.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'nfl');
const G = global._nfldata = global._nfldata || { at: 0, stamp: '', data: null };

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
function stamp() {
  try { return ['games.json', 'team-weeks.json', 'venues.json', 'model-priors.json', 'players.json'].map((f) => { try { return fs.statSync(path.join(DIR, f)).mtimeMs; } catch { return 0; } }).join('|'); } catch { return ''; }
}

// ── identidad: abreviatura nflverse → nombre, ciudad y logo (ESPN CDN, mismas siglas casi siempre) ───────
const TEAMS = {
  ARI: ['Arizona Cardinals', 'ari'], ATL: ['Atlanta Falcons', 'atl'], BAL: ['Baltimore Ravens', 'bal'],
  BUF: ['Buffalo Bills', 'buf'], CAR: ['Carolina Panthers', 'car'], CHI: ['Chicago Bears', 'chi'],
  CIN: ['Cincinnati Bengals', 'cin'], CLE: ['Cleveland Browns', 'cle'], DAL: ['Dallas Cowboys', 'dal'],
  DEN: ['Denver Broncos', 'den'], DET: ['Detroit Lions', 'det'], GB: ['Green Bay Packers', 'gb'],
  HOU: ['Houston Texans', 'hou'], IND: ['Indianapolis Colts', 'ind'], JAX: ['Jacksonville Jaguars', 'jax'],
  KC: ['Kansas City Chiefs', 'kc'], LA: ['Los Angeles Rams', 'lar'], LAC: ['Los Angeles Chargers', 'lac'],
  LV: ['Las Vegas Raiders', 'lv'], MIA: ['Miami Dolphins', 'mia'], MIN: ['Minnesota Vikings', 'min'],
  NE: ['New England Patriots', 'ne'], NO: ['New Orleans Saints', 'no'], NYG: ['New York Giants', 'nyg'],
  NYJ: ['New York Jets', 'nyj'], PHI: ['Philadelphia Eagles', 'phi'], PIT: ['Pittsburgh Steelers', 'pit'],
  SEA: ['Seattle Seahawks', 'sea'], SF: ['San Francisco 49ers', 'sf'], TB: ['Tampa Bay Buccaneers', 'tb'],
  TEN: ['Tennessee Titans', 'ten'], WAS: ['Washington Commanders', 'wsh'],
  // abreviaturas históricas (rebrands/mudanzas) → mapean al club actual para continuidad de rating
  OAK: ['Las Vegas Raiders', 'lv'], SD: ['Los Angeles Chargers', 'lac'], STL: ['Los Angeles Rams', 'lar'],
};
const CUR = (abbr) => (abbr === 'OAK' ? 'LV' : abbr === 'SD' ? 'LAC' : abbr === 'STL' ? 'LA' : abbr);
const teamName = (abbr) => (TEAMS[abbr] || [abbr])[0];
const teamLogo = (abbr) => { const t = TEAMS[abbr]; return t ? `https://a.espncdn.com/i/teamlogos/nfl/500/${t[1]}.png` : null; };

function load() {
  const s = stamp();
  if (G.data && G.stamp === s && Date.now() - G.at < 10 * 60e3) return G.data;
  const games = rd('games.json'), tw = rd('team-weeks.json'), venues = rd('venues.json'), priors = rd('model-priors.json');
  const players = rd('players.json');
  const data = {
    available: !!(games && games.games && tw && tw.rows),
    games: (games && games.games) || [],
    currentSeason: (games && games.current_season) || new Date().getUTCFullYear(),
    tw: (tw && tw.rows) || [],
    venues: (venues && venues.venues) || {},
    players: (players && players.players) || {},
    priors: priors || null,
    at: (games && games.at) || null,
  };
  // índice: partidos ordenados por fecha (el orden ES el point-in-time)
  data.games.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  G.data = data; G.stamp = s; G.at = Date.now();
  return data;
}

// ── RATING EN PUNTOS, point-in-time ──────────────────────────────────────────────────────────────────────
// Margen capado (±28: el basurero de las palizas no informa), recency por半 vida en PARTIDOS, ajuste por
// rival iterativo (30 pasadas bastan con 32 equipos) y arrastre entre temporadas ENCOGIDO. El HFA no vive
// aquí: vive en los priors ajustados (model-priors.json) y se aplica al armar el partido.
const CAP = 28;
function ratings(data, { beforeDate = '9999-12-31', halflife = 24, carry = 0.60 } = {}) {
  const rows = data.games.filter((g) => g.result != null && g.date < beforeDate && g.type !== 'PRE');
  if (!rows.length) return { teams: {}, n: 0 };
  const lastDate = rows[rows.length - 1].date;
  const seasons = [...new Set(rows.map((g) => g.season))];
  const curSeason = Math.max(...seasons);
  // peso: recencia en nº de partidos del EQUIPO hacia atrás + descuento extra entre temporadas
  const perTeam = {};
  const obs = [];
  for (const g of rows) {
    const home = CUR(g.home), away = CUR(g.away);
    const margin = Math.max(-CAP, Math.min(CAP, g.result));
    obs.push({ home, away, margin, season: g.season, neutral: g.location === 'Neutral', date: g.date });
    (perTeam[home] = perTeam[home] || []).push(obs.length - 1);
    (perTeam[away] = perTeam[away] || []).push(obs.length - 1);
  }
  for (const [team, idxs] of Object.entries(perTeam)) {
    for (let k = 0; k < idxs.length; k++) {
      const o = obs[idxs[k]];
      const back = idxs.length - 1 - k;                       // 0 = el más reciente del equipo
      let w = Math.pow(0.5, back / halflife);
      if (o.season < curSeason) w *= Math.pow(carry, curSeason - o.season);
      obs[idxs[k]]['w_' + team] = w;
    }
  }
  const hfa = (data.priors && data.priors.hfa) != null ? data.priors.hfa : 1.9;
  const R = {}; for (const t of Object.keys(perTeam)) R[t] = 0;
  for (let it = 0; it < 30; it++) {
    const nxt = {};
    for (const [team, idxs] of Object.entries(perTeam)) {
      let sw = 0, sv = 0;
      for (const i of idxs) {
        const o = obs[i];
        const isHome = o.home === team;
        const opp = isHome ? o.away : o.home;
        const mAdj = (isHome ? o.margin : -o.margin) - (o.neutral ? 0 : (isHome ? hfa : -hfa));
        const w = o['w_' + team];
        sw += w; sv += w * (mAdj + R[opp]);
      }
      // shrinkage bayesiano hacia 0 (media de la liga): con poca muestra efectiva, el rating no grita
      const K = 6;
      nxt[team] = sv / (sw + K);
    }
    Object.assign(R, nxt);
  }
  // muestra efectiva de la temporada actual (para la incertidumbre del partido)
  const curN = {};
  for (const [team, idxs] of Object.entries(perTeam)) curN[team] = idxs.filter((i) => obs[i].season === curSeason).length;
  const out = {};
  for (const t of Object.keys(R)) out[t] = { pts: +R[t].toFixed(2), games_cur: curN[t] || 0 };
  return { teams: out, n: rows.length, asof: lastDate, season: curSeason };
}

// ── ESTADOS EPA (proceso), point-in-time ─────────────────────────────────────────────────────────────────
// Media recency-weighted de EPA/jugada por dimensión, con el prior de temporada anterior encogido — el
// mecanismo del blueprint §6 en su versión honesta: cuatro dimensiones medidas, no veinte inventadas.
function epaStates(data, { beforeSeason = 9999, beforeWeek = 99, halflife = 10, carry = 0.55 } = {}) {
  const rows = data.tw.filter((r) => r.type !== 'PRE' &&
    (r.season < beforeSeason || (r.season === beforeSeason && r.week < beforeWeek)));
  const by = {};
  for (const r of rows) (by[CUR(r.team)] = by[CUR(r.team)] || []).push(r);
  const curSeason = rows.length ? Math.max(...rows.map((r) => r.season)) : null;
  const out = {};
  const dims = [
    ['pass_off', (r) => r.off && r.off.pass_epa], ['rush_off', (r) => r.off && r.off.rush_epa],
    ['pass_def', (r) => r.def && r.def.pass_epa_allowed], ['rush_def', (r) => r.def && r.def.rush_epa_allowed],
    ['pass_rate', (r) => r.off && r.off.pass_rate], ['plays', (r) => r.off && r.off.plays],
    ['expl_pass', (r) => r.off && r.off.expl_pass], ['expl_rush', (r) => r.off && r.off.expl_rush],
    ['cpoe', (r) => r.off && r.off.cpoe],
  ];
  for (const [team, list] of Object.entries(by)) {
    list.sort((a, b) => (a.season - b.season) || (a.week - b.week));
    const st = { n_cur: list.filter((r) => r.season === curSeason).length, n: list.length };
    for (const [key, fn] of dims) {
      let sw = 0, sv = 0;
      for (let k = 0; k < list.length; k++) {
        const v = fn(list[k]);
        if (v == null) continue;
        const back = list.length - 1 - k;
        let w = Math.pow(0.5, back / halflife);
        if (list[k].season < curSeason) w *= Math.pow(carry, curSeason - list[k].season);
        sw += w; sv += w * v;
      }
      st[key] = sw ? +(sv / sw).toFixed(4) : null;
    }
    out[team] = st;
  }
  return { teams: out, season: curSeason };
}

// medias de liga de los estados (para pintar diverging bars centradas en lo neutral, NFL-0914)
function leagueMeans(states) {
  const keys = ['pass_off', 'rush_off', 'pass_def', 'rush_def', 'pass_rate', 'plays', 'expl_pass', 'expl_rush', 'cpoe'];
  const mu = {};
  for (const k of keys) {
    const xs = Object.values(states.teams).map((t) => t[k]).filter((v) => v != null);
    mu[k] = xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null;
  }
  return mu;
}

module.exports = { load, ratings, epaStates, leagueMeans, teamName, teamLogo, CUR, TEAMS, DIR };
