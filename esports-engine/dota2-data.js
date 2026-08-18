// esports-engine/dota2-data.js — EL CATÁLOGO PROPIO DE DOTA 2 (18-ago, blueprint 5.0).
//
// El contrato es el de cs2-data (load / norm / resolveTeam / teamCard / rankingMovement) para que las
// pantallas de la casa se enciendan para Dota 2 sin una card nueva; y encima lleva lo que SOLO Dota
// tiene: meta de héroes por PARCHE (el corte temporal más limpio de los cuatro juegos — OpenDota publica
// el parche por partida), doctrina de draft por equipo y jugadores por POSICIÓN 1-5 inferida del oro.
//
// EL PESO PROPIO ES MODESTO Y SE DICE: la validación del 17-ago midió 1,92 % de skill (CS2 da 7,28 %).
// Señal real, cuatro veces menor — el ancla de mercado manda y esta base afina, no sustituye.
//
// DERECHOS: base research_only de OpenDota (data/esports/dota2/RIGHTS.md, D-0038). Rating interno,
// catálogo y sombra admin; NINGUNA pick pública nace de aquí. Texto-first: sin arte de Valve (D-0033).
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'esports', 'dota2');
const rdf = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isoWeek = (d) => { const t = new Date(d); const oneJan = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil((((t - oneJan) / 864e5) + oneJan.getUTCDay() + 1) / 7)).padStart(2, '0'); };

const G = global._dotadata = global._dotadata || { data: null, at: 0 };

function load() {
  if (G.data && Date.now() - G.at < 10 * 60e3) return G.data;
  const M = rdf('matches.json');
  if (!M || !M.matches) {
    return { available: false, teams: {}, players: {}, playerStats: {}, maps: {}, pairs: {}, form: {}, rankings: null };
  }
  const priors = rdf('priors.json') || { constants: { K: 12, min_n: 8, side_step: 2 }, side_advantage_elo: 0 };
  const PS = rdf('player-stats.json') || { players: {} };
  const HM = rdf('hero-meta.json') || null;
  const TD = rdf('team-doctrine.json') || null;
  const META = rdf('meta.json') || {};
  const matches = Object.values(M.matches).filter((m) => m.r_id && m.d_id && m.r && m.d)
    .sort((a, b) => (a.at || 0) - (b.at || 0));

  // equipos por team_id (estable en OpenDota); el nombre vigente es el último visto
  const teams = {};
  const tidOf = (id) => 't' + id;
  for (const m of matches) {
    for (const [tid0, name, lg] of [[m.r_id, m.r, m.lg_name], [m.d_id, m.d, m.lg_name]]) {
      const id = tidOf(tid0);
      const t = teams[id] = teams[id] || { id, team_id: tid0, name, logo: null, icon: null, rank: null, country_id: null, n: 0, league: null, _lg: {} };
      t.n++; t.name = name;
      if (lg) t._lg[lg] = (t._lg[lg] || 0) + 1;
    }
  }
  for (const t of Object.values(teams)) {
    t.league = Object.entries(t._lg).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    delete t._lg;
  }

  // Elo walk-forward con las constantes VALIDADAS + ventaja de Radiant online (igual que la validación)
  const C0 = priors.constants || {};
  const K = C0.K || 12, SS = C0.side_step || 2;
  const elo = {}, matchesN = {}, form = {}, pairs = {}, wrAgg = {};
  let sideElo = 0;
  for (const m of matches) {
    const a = tidOf(m.r_id), b = tidOf(m.d_id);
    elo[a] = elo[a] != null ? elo[a] : 1500; elo[b] = elo[b] != null ? elo[b] : 1500;
    const y = m.r_win ? 1 : 0;
    const p = 1 / (1 + Math.pow(10, (elo[b] - elo[a] - sideElo) / 400));
    const upd = K * (y - p);
    elo[a] += upd; elo[b] -= upd;
    sideElo += SS * (y - p);   // la ventaja de Radiant se aprende online, paso chico (igual que la validación)
    matchesN[a] = (matchesN[a] || 0) + 1; matchesN[b] = (matchesN[b] || 0) + 1;
    (wrAgg[a] = wrAgg[a] || { n: 0, w: 0 }); (wrAgg[b] = wrAgg[b] || { n: 0, w: 0 });
    wrAgg[a].n++; wrAgg[b].n++; if (y) wrAgg[a].w++; else wrAgg[b].w++;
    const at10 = m.at ? new Date(m.at * 1000).toISOString().slice(0, 10) : null;
    (form[a] = form[a] || []).push({ r: y ? 'W' : 'L', vs: b, at: at10, score: `${m.r_score ?? '—'}-${m.d_score ?? '—'}` });
    (form[b] = form[b] || []).push({ r: y ? 'L' : 'W', vs: a, at: at10, score: `${m.d_score ?? '—'}-${m.r_score ?? '—'}` });
    const pk = [a, b].sort().join('~');
    const P2 = pairs[pk] = pairs[pk] || { n: 0, w_a: 0, last: null, recent: [] };
    P2.n++; if ((pk.split('~')[0] === a) === (y === 1)) P2.w_a++; P2.last = at10;
    P2.recent.push({ at: at10, w: y ? a : b, s: `${m.r_score ?? 0}-${m.d_score ?? 0}` });
    if (P2.recent.length > 6) P2.recent.shift();
  }
  for (const id of Object.keys(form)) form[id] = form[id].slice(-10);
  const teamGlobal = {};
  for (const [id, e] of Object.entries(elo)) teamGlobal[id] = { elo: +e.toFixed(0), wr: wrAgg[id] ? +(wrAgg[id].w / wrAgg[id].n).toFixed(3) : null, n: matchesN[id] || 0 };

  // ranking GP: élite activa (≥15 partidas en 90 días — en Dota se juega mucho), por Elo
  const lastAt = matches.length ? matches[matches.length - 1].at : Math.floor(Date.now() / 1000);
  const cut90 = lastAt - 90 * 86400;
  const recentN = {};
  for (const m of matches) if ((m.at || 0) >= cut90) { recentN[tidOf(m.r_id)] = (recentN[tidOf(m.r_id)] || 0) + 1; recentN[tidOf(m.d_id)] = (recentN[tidOf(m.d_id)] || 0) + 1; }
  const rankRows = Object.keys(teams).filter((id) => (recentN[id] || 0) >= 15)
    .sort((x, y) => (elo[y] || 0) - (elo[x] || 0)).slice(0, 60)
    .map((id, i) => ({ id, rank: i + 1, elo: +elo[id].toFixed(0), wr: teamGlobal[id].wr, n: recentN[id] || 0, team: teams[id] }));
  const rankings = { week: isoWeek(lastAt * 1000), rows: rankRows };

  // jugadores por posición (del agregado)
  const players = {}; const playerStats = {}; const fiveOf = {};
  for (const st of Object.values(PS.players || {})) {
    const tid = st.team_id ? tidOf(st.team_id) : null;
    players[st.id] = { id: st.id, nick: st.nick, name: null, role: 'Pos ' + st.pos, team: tid,
      team_name: tid && teams[tid] ? teams[tid].name : null, photo: null, country_id: null, birthday: null, rating6m: null };
    playerStats[st.id] = st;
    if (tid) (fiveOf[tid] = fiveOf[tid] || []).push(st);
  }
  const rosters = {};
  for (const [tid, arr] of Object.entries(fiveOf)) {
    const byPos = {};
    for (const st of arr.sort((a, b) => b.n - a.n)) if (!byPos[st.pos]) byPos[st.pos] = st;
    const five = Object.values(byPos).sort((a, b) => a.pos - b.pos).slice(0, 5)
      .map((st) => ({ id: st.id, nick: st.nick, role: 'Pos ' + st.pos }));
    rosters[tid] = { five, coach: null, changed_recently: false };
  }

  const data = {
    available: matches.length > 1000,
    matches, teams, teamGlobal, rosters, pairs, form, rankings,
    players, playerStats, playerStatsMeta: PS.players && Object.keys(PS.players).length
      ? { at: PS.at, window_days: PS.window_days, population: PS.population, formula: PS.formula } : null,
    heroMeta: HM, doctrine: TD,
    side_advantage_elo: priors.side_advantage_elo || 0,
    priors, maps: {}, pool: [],
    meta: META, at: META.at || new Date().toISOString(),
    byName: new Map(Object.values(teams).map((t) => [norm(t.name), t.id])),
    rights: 'Base propia derivada de OpenDota (research_only) — rating interno, catálogo admin y sombra; sin picks públicas (RIGHTS.md).',
  };
  G.data = data; G.at = Date.now();
  return data;
}

function resolveTeam(name, { data = null } = {}) {
  const d = data || load();
  const k = norm(name);
  if (!k) return null;
  if (d.byName && d.byName.has(k)) return d.byName.get(k);
  // mismo guard de identidad que LoL/Valorant: los marcadores de segundo equipo no resuelven al principal
  const SQUAD = /(^| )(academy|academia|youth|rookies?|prospects?|female|fe|2|ii|b|junior)( |$)/;
  for (const [n2, id] of d.byName || []) {
    if (n2 === k || n2.replace(/ /g, '') === k.replace(/ /g, '')) return id;
    if ((k.length > 3 && n2.startsWith(k)) || (n2.length > 3 && k.startsWith(n2))) {
      const rest = (k.length > n2.length ? k.slice(n2.length) : n2.slice(k.length)).trim();
      if (!SQUAD.test(' ' + rest + ' ')) return id;
    }
  }
  return null;
}

function teamCard(id, { data = null } = {}) {
  const d = data || load();
  const t = d.teams[id] || { id, name: id };
  const g = d.teamGlobal[id] || {};
  return { id, name: t.name, logo: null, country_id: null, rank: null,
    elo: g.elo != null ? g.elo : null, wr: g.wr != null ? g.wr : null, n: g.n || 0,
    maps: [],                                          // Dota no tiene mapas: el objeto del juego es el draft
    roster: d.rosters[id] || null };
}

function rankingMovement({ data = null } = {}) {
  const d = data || load();
  if (!d.rankings) return null;
  return { week: d.rankings.week, prev_week: null, min_maps: 15, at: d.at,
    rows: d.rankings.rows.map((r) => ({ ...r, move: null })) };
}

function ratingsFor(nameA, nameB) {
  const d = load();
  if (!d.available) return null;
  const a = resolveTeam(nameA, { data: d }), b = resolveTeam(nameB, { data: d });
  if (!a || !b) return null;
  const ga = d.teamGlobal[a] || {}, gb = d.teamGlobal[b] || {};
  return { elo_a: ga.elo != null ? ga.elo : 1500, elo_b: gb.elo != null ? gb.elo : 1500,
    matches_a: ga.n || 0, matches_b: gb.n || 0, id_a: a, id_b: b,
    side_advantage_elo: d.side_advantage_elo };
}

// meta de héroes por parche (contrato del tablero de la casa)
function heroesBoard({ role = null } = {}) {
  const d = load();
  if (!d.available || !d.heroMeta || !(d.heroMeta.rows || []).length) return { available: false };
  const rows = (d.heroMeta.rows || [])
    .filter((r) => !role || r.role === role)
    .map((r) => ({ ch: r.name, role: r.role, n: r.n, wr: r.wr, wr_shrunk: r.wr_shrunk,
      presence_pct: r.presence_pct, bans: r.bans, delta_wr: r.delta_wr }));
  return { available: true, patch: d.heroMeta.patch, prev_patch: d.heroMeta.prev_patch,
    games_patch: d.heroMeta.games_patch, shrink_k: d.heroMeta.shrink_k, rows, note: d.heroMeta.note };
}

// inteligencia de draft para un cruce (la forma del Draft Room, con la doctrina de equipo de Dota)
function draftIntel(nameA, nameB) {
  const d = load();
  if (!d.available) return { available: false, why: 'la base propia de Dota 2 no está cargada.' };
  const board = heroesBoard({});
  const side = (name) => {
    const id = resolveTeam(name, { data: d });
    if (!id) return { name, resolved: false };
    const ro = d.rosters[id];
    const five = ((ro && ro.five) || []).map((f) => {
      const st = d.playerStats[f.id] || {};
      const pool = (st.pool || []).slice(0, 6).map((c) => ({ ch: c.name, n: c.n,
        wr: c.n ? +(c.w / c.n).toFixed(2) : null, rw: c.rw, flex: false,
        comfort: +(c.rw * ((c.w + 3) / (c.n + 6))).toFixed(2) }));
      return { id: f.id, nick: f.nick, role: f.role, rating_gp: st.rating_gp || null, n: st.n || 0, pool };
    });
    const comfortTotal = five.reduce((s, p) => s + p.pool.reduce((x, c) => x + c.comfort, 0), 0);
    const allPicks = five.flatMap((p) => p.pool.map((c) => c.comfort)).sort((x, y) => y - x);
    const drop3 = allPicks.slice(0, 3).reduce((s, x) => s + x, 0);
    // la doctrina del EQUIPO (pools con recencia del draft real) complementa a los jugadores
    const doc = d.doctrine && d.doctrine.teams && d.teams[id] ? d.doctrine.teams[d.teams[id].team_id] : null;
    return { name, resolved: true, id, five,
      comfort_total: +comfortTotal.toFixed(1),
      fragility_pct: comfortTotal ? +(100 * drop3 / comfortTotal).toFixed(1) : null,
      doctrine_top: doc ? doc.pool.slice(0, 5).map((e) => ({ ch: e.name, n: e.n, wr: e.n ? +(e.w / e.n).toFixed(2) : null })) : null };
  };
  return {
    available: true, patch: (d.heroMeta && d.heroMeta.patch) || null,
    a: side(nameA), b: side(nameB),
    meta_top: (board.rows || []).slice(0, 10).map((r) => ({ ch: r.ch, role: r.role, presence_pct: r.presence_pct, wr_shrunk: r.wr_shrunk, delta_wr: r.delta_wr })),
    provenance: 'pools y comfort: recencia jugador×héroe (medio-vida 40 partidas) × señal encogida; doctrina de equipo del draft real (medio-vida 60 picks); meta del parche vigente. El modelo secuencial de draft (D-0448+) llega con más capas.',
    rights_note: 'Datos derivados de OpenDota.',
  };
}

module.exports = { load, norm, resolveTeam, teamCard, rankingMovement, ratingsFor,
  heroesBoard, championsBoard: heroesBoard, draftIntel, DIR, MODEL_VERSION: 'dota-elo-side-1' };
