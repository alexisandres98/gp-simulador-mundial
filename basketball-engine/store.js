// basketball-engine/store.js — LA CAPA QUE SIRVE INTELIGENCIA (15-ago).
//
// Junta dataset + rating + simulación y arma los objetos que consumen los endpoints /api/hoops/*. Vive fuera
// de server.js a propósito: server.js ya son 16k líneas y este producto tiene mucha superficie propia; acá
// queda todo lo que razona sobre baloncesto y allá quedan solo las rutas.
//
// CACHE EN MEMORIA por liga: cargar el dataset (3,5MB) y ajustar el rating (60 iteraciones × 275 partidos)
// cuesta ~200ms — barato para hacerlo una vez, caro para hacerlo en cada request. Se recalcula cada 30 min
// o cuando entra un partido nuevo.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./ratings');
const S = require('./simulate');
const ESPN = require('../data-providers/basketball/espn');

const DIR = path.join(__dirname, '..', 'data', 'basketball');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const G = global._hoops = global._hoops || {};

// liga → { games[], teams{}, players{}, fit, at }
function load(league, { season = null, force = false } = {}) {
  const C = G[league];
  if (C && !force && Date.now() - C.at < 30 * 60e3) return C;
  const yr = season || (new Date().getUTCFullYear());
  // se aceptan varias temporadas en disco: se usan todas para el histórico y la más nueva manda en el rating
  const files = (() => { try { return fs.readdirSync(DIR).filter(f => f.startsWith(`games-${league}-`)); } catch { return []; } })();
  let games = [];
  for (const f of files) { const st = rd(f); if (st && st.games) games = games.concat(Object.values(st.games)); }
  const teams = {}; const tl = rd(`teams-${league}.json`); for (const t of ((tl && tl.teams) || [])) teams[t.id] = t;
  const players = {}; const pl = rd(`players-${league}.json`); for (const p of ((pl && pl.players) || [])) players[p.id] = p;
  const byTeam = {}; for (const p of Object.values(players)) (byTeam[p.team_id] = byTeam[p.team_id] || []).push(p);
  const fit = games.length ? R.fitRatings(games, { validTeams: Object.keys(teams).length ? Object.keys(teams) : null }) : null;
  const out = { league, season: yr, games, teams, players, byTeam, fit, at: Date.now(), n: games.length };

  // ── LA PILA COMPLETA (16-ago) ──────────────────────────────────────────────────────────────────────
  // El rating de equipo es la base; encima van las capas que saben lo que la base no puede saber.
  //
  // EL AJUSTE NO SE HACE ACÁ. RAPM (4,5 s) y el peso de mezcla (1,0 s) se ajustan fuera de línea con
  // `scripts/hoops-fit.js` y se sirven desde `fit-<liga>.json`. Hacerlo dentro de la carga costaba 5,7 s de
  // CPU bloqueante cada 30 minutos, y en un proceso Node de un solo hilo eso congela el sitio entero, no
  // solo baloncesto. Un modelo serio entrena en un sitio y sirve en otro; acá solo se sirve.
  // Si el artefacto falta, las capas que dependen de él quedan apagadas y el resto sigue funcionando.
  try {
    const CX = require('./context');
    const ESPN = require('../data-providers/basketball/espn');
    const L = ESPN.LEAGUES[league] || {};

    // 1-2) ARTEFACTO DE AJUSTE: RAPM, contexto y peso de mezcla, ya entrenados y versionados.
    const art = rd(`fit-${league}.json`);
    out.fit_artifact = art ? { at: art.at, games_n: art.games_n, ms: art.ms, stale: art.games_n !== games.length } : null;
    out.stint_coverage = art ? art.stint_coverage : 0;
    out.rapm = (art && art.rapm) || null;
    out.ctx = (art && art.ctx) || null;

    // 3) ESTADO DE CALENDARIO: barato (18 ms) y necesita el array de partidos vivo, así que sí va acá.
    out.sched = CX.scheduleState(games);
    // los partidos futuros no están en `sched` (se construye del histórico): resolver por equipo y fecha
    out.schedFor = (game, side) => {
      const id = String(game[side].id);
      const hit = out.sched.get(String(game.id) + '|' + id);
      if (hit) return hit;
      const prev = games.filter((g) => String(g.home.id) === id || String(g.away.id) === id)
        .map((g) => ({ t: Date.parse(g.date || 0), venue: g.home.abbr }))
        .filter((x) => Number.isFinite(x.t) && x.t < Date.parse(game.date || 0))
        .sort((a, b) => b.t - a.t)[0];
      if (!prev) return null;
      const rest = (Date.parse(game.date || 0) - prev.t) / 864e5;
      const venue = game.home.abbr;
      return {
        rest_days: +rest.toFixed(2), b2b: rest < 1.4 ? 1 : 0,
        three_in_four: 0, games_last7: 0,
        travel_km: Math.round(CX.haversine(CX.venueOf(prev.venue), CX.venueOf(venue)) || 0),
        road: side === 'away' ? 1 : 0, alt_m: (CX.venueOf(venue) || [0, 0, 0])[2],
      };
    };

    // 4) PESO DE MEZCLA con el mercado: viene del artefacto, estimado con validación anidada (el rating que
    // produce la probabilidad del modelo se ajusta con el 70% más antiguo y el peso se mide sobre el 30%
    // que ese rating no vio). Estimarlo con los mismos partidos que ajustaron el rating devolvía w = 1 por
    // construcción, que es el sesgo que más infla un backtest.
    out.blend = (art && art.blend) || { w: 0, n: 0, ok: false, reason: 'sin artefacto de ajuste' };

    // 5) VEREDICTO DE VALIDACIÓN: qué capas se ganaron su sitio en esta liga.
    out.validation = rd(`validation-${league}.json`) || null;

    // UNA SOLA AUTORIDAD PARA EL PESO. El artefacto estima w con un corte 70/30; la validación lo estima con
    // ventana móvil de 3 pliegues y 3.000 simulaciones por partido, que es el método más exigente de los dos
    // y además es el que publica el producto. Tener dos números distintos para lo mismo es como se cuelan los
    // errores caros, así que manda la validación y el otro queda como diagnóstico.
    const vb = out.validation && out.validation.layers && out.validation.layers.blend;
    if (vb && vb.on && vb.w != null) {
      out.blend = { ...out.blend, w: +Number(vb.w).toFixed(3), source: 'validación (ventana móvil)', w_split70: out.blend.w, ok: true };
    } else if (out.blend && out.blend.ok) {
      out.blend.source = 'corte 70/30';
    }
  } catch (e) {
    out.stack_error = e.message;
    console.error('[hoops-store] la pila avanzada falló:', e.message);
  }

  G[league] = out;
  return out;
}

// ---- PERFIL DE EQUIPO ------------------------------------------------------------------------------------
// Medias de temporada + perfil de tiro por zona + ranking dentro de la liga. Todo con la muestra REAL del
// equipo, y separando lo que hizo de lo que le hicieron: un ataque y una defensa son dos cosas distintas y
// el producto tiene que poder decir cuál de las dos explica el resultado.
function teamProfile(C, teamId, { lastN = null } = {}) {
  if (!C) return null;
  let gs = C.games.filter(g => g.home.id === teamId || g.away.id === teamId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (lastN) gs = gs.slice(0, lastN);
  if (!gs.length) return null;
  const mine = (g) => (g.home.id === teamId ? g.home : g.away), opp = (g) => (g.home.id === teamId ? g.away : g.home);
  const avg = (f) => +(gs.reduce((s, g) => s + (f(g) || 0), 0) / gs.length).toFixed(3);
  const zone = { rim: [0, 0], short_mid: [0, 0], long_mid: [0, 0], corner3: [0, 0], atb3: [0, 0] };
  const zoneAg = JSON.parse(JSON.stringify(zone));
  for (const g of gs) for (const sh of (g.shots || [])) {
    const tgt = sh.t === teamId ? zone : zoneAg;
    if (!tgt[sh.z]) continue;
    tgt[sh.z][0] += 1; tgt[sh.z][1] += sh.m ? sh.v : 0;      // [intentos, puntos]
  }
  const zpct = (z) => { const tot = Object.values(z).reduce((s, v) => s + v[0], 0) || 1;
    const o = {}; for (const k of Object.keys(z)) o[k] = { rate: +(z[k][0] / tot).toFixed(4), pps: z[k][0] ? +(z[k][1] / z[k][0]).toFixed(3) : null, n: z[k][0] }; return o; };
  const w = gs.filter(g => mine(g).pts > opp(g).pts).length;
  return {
    team_id: teamId, team: C.teams[teamId] || null, games: gs.length, record: { w, l: gs.length - w },
    pts: avg(g => mine(g).pts), pts_allowed: avg(g => opp(g).pts), poss: avg(g => g.poss),
    ortg: avg(g => mine(g).ff.ortg), drtg: avg(g => opp(g).ff.ortg),
    efg: avg(g => mine(g).ff.efg), efg_allowed: avg(g => opp(g).ff.efg),
    tov_pct: avg(g => mine(g).ff.tov_pct), orb_pct: avg(g => mine(g).ff.orb_pct), ftr: avg(g => mine(g).ff.ftr),
    tpa_rate: avg(g => mine(g).ff.tpa_rate),
    paint: avg(g => mine(g).paint), fastbreak: avg(g => mine(g).fastbreak), pts_off_tov: avg(g => mine(g).pts_off_tov),
    ast: avg(g => mine(g).ast), reb: avg(g => mine(g).reb),
    shot_profile: zpct(zone), shot_profile_allowed: zpct(zoneAg),
    // rating ajustado por rival (lo que de verdad describe al equipo, no lo que le tocó de calendario)
    adj: C.fit ? { off: +(C.fit.off[teamId] || 0).toFixed(2), def: +(C.fit.def[teamId] || 0).toFixed(2),
      pace: +(C.fit.pace[teamId] || 0).toFixed(2), net: +((C.fit.off[teamId] || 0) - (C.fit.def[teamId] || 0)).toFixed(2) } : null,
    form: gs.slice(0, 10).map(g => ({ id: g.id, date: g.date, opp: opp(g).abbr, home: g.home.id === teamId,
      pf: mine(g).pts, pa: opp(g).pts, w: mine(g).pts > opp(g).pts ? 1 : 0, ortg: mine(g).ff.ortg })),
  };
}

// ranking de la liga por métrica ajustada (para los percentiles del panel)
function leagueRanks(C) {
  if (!C || !C.fit) return {};
  const ids = Object.keys(C.fit.off);
  const mk = (f, asc) => { const s = ids.slice().sort((a, b) => asc ? f(a) - f(b) : f(b) - f(a)); const o = {}; s.forEach((id, i) => o[id] = i + 1); return o; };
  return {
    n: ids.length,
    off: mk(id => C.fit.off[id]), def: mk(id => C.fit.def[id], true),
    net: mk(id => C.fit.off[id] - C.fit.def[id]), pace: mk(id => C.fit.pace[id]),
  };
}

// ---- MATRIZ DE EXPLOTACIÓN POR ZONA ----------------------------------------------------------------------
// El módulo que convierte dos perfiles en un plan de partido: dónde ataca bien uno contra dónde defiende mal
// el otro. Se compara el ACIERTO por zona del ataque contra lo que la defensa rival concede en esa zona, y
// se pesa por el VOLUMEN que el ataque tira ahí — una ventaja en un tiro que casi no usa no es una ventaja.
function exploitMap(offP, defP) {
  if (!offP || !defP) return [];
  const zones = [['rim', 'Aro'], ['short_mid', 'Media corta'], ['long_mid', 'Media larga'], ['corner3', 'Triple esquina'], ['atb3', 'Triple frontal']];
  const out = [];
  for (const [z, label] of zones) {
    const o = offP.shot_profile[z], d = defP.shot_profile_allowed[z];
    if (!o || !d || o.pps == null || d.pps == null || o.n < 20 || d.n < 20) continue;
    const edge = o.pps - d.pps;                    // puntos por tiro por encima de lo que esa defensa concede
    const impact = edge * (o.rate * 100);          // ponderado por cuánto tira ahí, en puntos por 100 tiros
    out.push({ zone: z, label, rate: o.rate, pps: o.pps, allowed_pps: d.pps,
      edge: +edge.toFixed(3), impact: +impact.toFixed(2),
      grade: impact > 3 ? 'ventaja' : impact < -3 ? 'desventaja' : 'neutro' });
  }
  return out.sort((a, b) => b.impact - a.impact);
}

// ---- JUGADORES -------------------------------------------------------------------------------------------
// Medias por partido y por 36 minutos, más el rol (uso aproximado por tiros+pérdidas). Sin datos de tracking
// no se inventa un arquetipo: se describe lo que el box score sostiene.
function playerSeason(C, teamId, { lastN = null } = {}) {
  if (!C) return [];
  let gs = C.games.filter(g => g.home.id === teamId || g.away.id === teamId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (lastN) gs = gs.slice(0, lastN);
  const acc = {};
  for (const g of gs) for (const p of (g.players || [])) {
    if (p.t !== teamId) continue;
    const a = acc[p.id] = acc[p.id] || { id: p.id, name: p.n, pos: p.pos, gp: 0, gs: 0, min: 0, pts: 0, reb: 0, ast: 0, tov: 0, stl: 0, blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, orb: 0, drb: 0, pm: 0 };
    a.gp++; a.gs += p.st; for (const k of ['min', 'pts', 'reb', 'ast', 'tov', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'pm']) a[k] += (p[k] || 0);
  }
  const teamFga = Object.values(acc).reduce((s, a) => s + a.fga, 0) || 1;
  return Object.values(acc).map(a => {
    const per = (v) => +(v / a.gp).toFixed(1), p36 = (v) => a.min > 0 ? +(v / a.min * 36).toFixed(1) : null;
    const meta = C.players[a.id] || {};
    return {
      id: a.id, name: a.name, pos: a.pos || meta.pos || null, headshot: meta.headshot || null,
      jersey: meta.jersey || null, height: meta.height || null, age: meta.age || null, injury: meta.injury || null,
      gp: a.gp, starts: a.gs, min: per(a.min),
      pts: per(a.pts), reb: per(a.reb), ast: per(a.ast), tov: per(a.tov), stl: per(a.stl), blk: per(a.blk),
      p36: { pts: p36(a.pts), reb: p36(a.reb), ast: p36(a.ast) },
      fg: a.fga ? +(a.fgm / a.fga).toFixed(3) : null, tp: a.tpa ? +(a.tpm / a.tpa).toFixed(3) : null,
      ft: a.fta ? +(a.ftm / a.fta).toFixed(3) : null,
      efg: a.fga ? +((a.fgm + 0.5 * a.tpm) / a.fga).toFixed(3) : null,
      usage: +(100 * a.fga / teamFga).toFixed(1),          // cuota de tiro del equipo (proxy de uso)
      pm: per(a.pm), fga: per(a.fga), tpa: per(a.tpa),
      starter: a.gs / a.gp > 0.5,
    };
  }).sort((x, y) => y.min - x.min);
}

// ---- LAS 5 COSAS QUE IMPORTAN -----------------------------------------------------------------------------
// El antídoto contra el terminal Bloomberg: de todo lo calculado, qué mueve ESTE partido. Se generan desde
// los números ya calculados (nada de LLM acá — esto tiene que ser reproducible y auditable).
function whatMatters({ sim, dec, hp, ap, ex, exA, market }) {
  const out = [];
  if (dec) for (const p of dec.parts.slice(0, 2)) {
    if (Math.abs(p.pp) < 1) continue;
    out.push({ w: Math.abs(p.pp), t: `${p.label}: ${p.pp > 0 ? '+' : ''}${p.pp} puntos de margen` });
  }
  const top = (ex || [])[0];
  if (top && top.impact > 3) out.push({ w: top.impact, t: `${hp.team ? hp.team.abbr : 'Local'} saca ventaja en ${top.label.toLowerCase()}: ${top.pps} pts/tiro contra ${top.allowed_pps} que concede el rival` });
  const topA = (exA || [])[0];
  if (topA && topA.impact > 3) out.push({ w: topA.impact, t: `${ap.team ? ap.team.abbr : 'Visitante'} saca ventaja en ${topA.label.toLowerCase()}: ${topA.pps} pts/tiro contra ${topA.allowed_pps}` });
  if (sim) {
    out.push({ w: 4, t: `El 50% central del margen cae entre ${sim.margin_q.p25 > 0 ? '+' : ''}${sim.margin_q.p25} y ${sim.margin_q.p75 > 0 ? '+' : ''}${sim.margin_q.p75}` });
    if (sim.ot_prob > 0.06) out.push({ w: 3, t: `Prórroga con probabilidad ${(100 * sim.ot_prob).toFixed(1)}% — partido de los que se deciden al final` });
    if (sim.poss > 0) out.push({ w: 2.5, t: `Ritmo proyectado ${sim.poss} posesiones${sim.poss > 88 ? ' (rápido)' : sim.poss < 78 ? ' (lento)' : ''}` });
  }
  if (market && market.edge_pp != null && Math.abs(market.edge_pp) >= 3) {
    out.push({ w: 10, t: `El mercado paga al local ${market.market_pct}% y el modelo lo ve ${market.model_pct}% (${market.edge_pp > 0 ? '+' : ''}${market.edge_pp}pp)` });
  }
  if (sim && sim.conf === 'baja') out.push({ w: 9, t: 'Confianza BAJA: alguno de los dos tiene muy pocos partidos en la muestra' });
  return out.sort((a, b) => b.w - a.w).slice(0, 5).map(x => x.t);
}

// ---- EL PANEL COMPLETO DE UN PARTIDO ---------------------------------------------------------------------
function gameIntel(C, game, { sims = 20000, adj = null, injuries = null, marketProb = null, props = false } = {}) {
  if (!C || !C.fit || !game) return null;
  const h = game.home.id, a = game.away.id;
  // LA PILA COMPLETA (16-ago): plantilla × minutos, contexto de calendario y mezcla con el mercado, cada
  // capa aplicada solo si su validación fuera de muestra la respalda. Si el modelo avanzado no está
  // disponible (dataset sin tramos, liga nueva) se cae al simulador base sin romper nada.
  let stack = null;
  try {
    const MD = require('./model');
    const ESPN2 = require('../data-providers/basketball/espn');
    const L2 = ESPN2.LEAGUES[C.league] || {};
    stack = MD.simulateGame(C, game, { injuries, L: L2, sims, seed: 13, market: marketProb });
  } catch (e) { stack = null; }
  const sim = stack || S.simulate(C.fit, h, a, { n: sims, neutral: !!game.neutral, adj });
  if (!sim) return null;
  const dec = R.decompose(C.fit, h, a, { neutral: !!game.neutral });
  const hp = teamProfile(C, h), ap = teamProfile(C, a);
  const ranks = leagueRanks(C);
  const ex = exploitMap(hp, ap), exA = exploitMap(ap, hp);
  const mk = S.markets(sim);
  // mercado real si el partido ya lo trae (ESPN incluye el cierre; en vivo llega por el sweep de cuotas)
  let market = null;
  const o = (game.odds || [])[0];
  if (o && o.hml != null && o.aml != null) {
    const imp = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
    const ih = imp(o.hml), ia = imp(o.aml), p = ih / (ih + ia);
    market = { book: o.b, market_pct: +(100 * p).toFixed(1), model_pct: +(100 * sim.win.home).toFixed(1),
      edge_pp: +(100 * (sim.win.home - p)).toFixed(1), spread: o.sp, total: o.ou };
  }
  return {
    game: { id: game.id, league: game.league, date: game.date, neutral: !!game.neutral, venue: game.venue || null,
      status: game.status || null, completed: !!game.completed,
      home: { ...(C.teams[h] || { id: h }), score: game.home.pts }, away: { ...(C.teams[a] || { id: a }), score: game.away.pts } },
    projection: {
      win: sim.win, win_ci: sim.win_ci, confidence: sim.conf,
      home_pts: sim.home_pts, away_pts: sim.away_pts, poss: sim.poss,
      margin: sim.margin, total: sim.total, ot_prob: sim.ot_prob,
      margin_q: sim.margin_q, total_q: sim.total_q, bands: sim.bands,
      margin_hist: sim.margin_hist, total_hist: sim.total_hist, sims: sim.n,
    },
    why: dec,
    markets: mk,
    market,
    teams: {
      home: { ...hp, rank: ranks.net ? { net: ranks.net[h], off: ranks.off[h], def: ranks.def[h], pace: ranks.pace[h], of: ranks.n } : null },
      away: { ...ap, rank: ranks.net ? { net: ranks.net[a], off: ranks.off[a], def: ranks.def[a], pace: ranks.pace[a], of: ranks.n } : null },
    },
    exploit: { home: ex, away: exA },
    players: { home: playerSeason(C, h), away: playerSeason(C, a) },
    what_matters: whatMatters({ sim, dec, hp, ap, ex, exA, market }),
    model: { league: C.league, games: C.fit.games, teams: C.fit.teams, hca: C.fit.hca, at: C.fit.at },
    // ── LA PILA, VISIBLE ───────────────────────────────────────────────────────────────────────────
    // No basta con que el modelo use estas capas: el panel tiene que poder mostrar de dónde sale cada
    // punto y qué capas están encendidas. Un ajuste que no se puede auditar es un número mágico.
    stack: sim.projection_parts ? {
      parts: sim.projection_parts, layers: sim.layers || null,
      adj: sim.adj || null, adj_margin_pts: sim.adj_margin_pts || 0,
      availability: sim.availability || null, context: sim.context || null,
      blend: sim.blend || null, win_model: sim.win_model || null,
      validation: C.validation ? { skill: C.validation.skill, layers: C.validation.layers, n: C.validation.n, at: C.validation.at } : null,
      rapm: C.rapm ? { players: C.rapm.n_players, stints: C.rapm.n_stints, lambda: C.rapm.lambda } : null,
    } : null,
    props: props ? gameProps(C, game, sim) : null,
  };
}

// ---- PROPS DEL PARTIDO ----------------------------------------------------------------------------------
// Distribuciones por jugador para las líneas que de verdad se cotizan. Usa los MINUTOS PROYECTADOS de la
// pila (ya con las bajas aplicadas), no la media histórica: un prop sobre minutos equivocados es ruido caro.
function gameProps(C, game, sim) {
  try {
    const PR = require('./props');
    const MN = require('./minutes');
    const ESPN2 = require('../data-providers/basketball/espn');
    const L2 = ESPN2.LEAGUES[C.league] || {};
    const av = (sim && sim.availability) || {};
    const mins = (side, teamId) => {
      const a = av[side];
      if (a && a.minutes && a.minutes.map) return a.minutes.map;
      const prof = MN.rotationProfile(C.games, teamId, { lastN: 15 });
      const pj = prof ? MN.projectMinutes(prof, { L: L2 }) : null;
      return pj ? pj.map : null;
    };
    const hm = mins('home', game.home.id), am = mins('away', game.away.id);
    if (!hm || !am) return null;
    // el ritmo proyectado escala las tasas: en un partido de 105 posesiones se anota más que en uno de 92
    const paceFactor = sim && sim.poss && C.fit.lgPace ? sim.poss / C.fit.lgPace : 1;
    const rows = PR.gameProps(C.games, { homeMinutes: hm, awayMinutes: am, homeId: String(game.home.id), awayId: String(game.away.id), paceFactor, top: 7 });
    return rows.map((r) => ({ ...r, name: (C.players[r.player_id] || {}).name || null, headshot: (C.players[r.player_id] || {}).headshot || null,
      team: (C.teams[r.team_id] || {}).abbr || null }));
  } catch (e) { return null; }
}

module.exports = { load, teamProfile, leagueRanks, exploitMap, playerSeason, gameIntel, gameProps, whatMatters, LEAGUES: ESPN.LEAGUES, DIR };
