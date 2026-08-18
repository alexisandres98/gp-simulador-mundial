// esports-engine/valorant-data.js — EL CATÁLOGO PROPIO DE VALORANT (18-ago, blueprint 4.0).
//
// El contrato es el de cs2-data (load / norm / resolveTeam / teamCard / rankingMovement) para que las
// pantallas de la casa — Equipos, Ranking GP, Jugadores, fichas — se enciendan para Valorant sin una
// card nueva; y encima lleva lo que SOLO Valorant tiene: meta de agentes por ventana (90 días, medido),
// fuerza por mapa con sesgo de lado atacante, y la inteligencia de composición (pools por jugador con
// comfort, clases cubiertas, familiaridad de comp — V-0121/0131 del blueprint en su V1 honesta).
//
// LO QUE NO SE FINGE: sin el detalle cosechado, maps/agents/players viajan vacíos y cada pantalla lo
// dice; sin parche por partido (vlr no lo publica), el meta se corta por VENTANA y se declara así.
// Sin arte de Riot (V-0026): representación texto-first.
//
// DERECHOS: base research_only de vlr.gg (data/esports/valorant/RIGHTS.md). Alimenta rating, catálogo y
// sombra admin; NINGUNA pick pública nace de aquí. La probabilidad publicada sigue anclada a mercado.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'esports', 'valorant');
const rdf = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');
const isoWeek = (d) => { const t = new Date(d); const oneJan = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil((((t - oneJan) / 864e5) + oneJan.getUTCDay() + 1) / 7)).padStart(2, '0'); };
const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());

const G = global._valdata = global._valdata || { data: null, at: 0 };

function load() {
  if (G.data && Date.now() - G.at < 10 * 60e3) return G.data;
  const seriesRaw = rdf('series.json');
  if (!seriesRaw || !seriesRaw.rows) {
    return { available: false, teams: {}, players: {}, playerStats: {}, maps: {}, pairs: {}, form: {}, rankings: null };
  }
  const priors = rdf('priors.json') || { constants: { K: 20, margin_boost: 1.35, idle_boost: 1.5 } };
  const PS = rdf('player-stats.json') || { players: {} };
  const AG = rdf('agents.json') || null;
  const MS = rdf('map-stats.json') || null;
  const CO = rdf('comps.json') || null;
  const META = rdf('meta.json') || {};
  const AS = rdf('assets.json') || { teams: {}, players: {} };   // escudos y fotos auto-hospedados
  const series = Object.values(seriesRaw.rows)
    .filter((s) => s.t1 && s.t2 && s.at && s.s1 != null && s.s2 != null && (s.s1 + s.s2) > 0 && s.s1 !== s.s2)
    .sort((a, b) => (a.at + (a.time || '') < b.at + (b.time || '') ? -1 : 1));

  // equipos + circuito (el prefijo del evento antes de ":" agrupa razonablemente: "Champions Tour 2026…")
  const teams = {};
  for (const s of series) {
    for (const name of [s.t1, s.t2]) {
      const id = slug(name); if (!id) continue;
      const t = teams[id] = teams[id] || { id, name, logo: null, icon: null, rank: null, country_id: null, n: 0, league: null, _ev: {} };
      t.n++; t.name = name;
      const ev = String(s.event || '').split(':')[0].replace(/\s*\d{4}\s*/g, ' ').trim();
      if (ev) t._ev[ev] = (t._ev[ev] || 0) + 1;
    }
  }
  for (const t of Object.values(teams)) {
    t.league = Object.entries(t._ev).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    delete t._ev;
  }
  // ESCUDO AUTO-HOSPEDADO (19-ago): manifiesto de scripts/esports-assets.js; sin entrada, monograma tintado.
  for (const t of Object.values(teams)) {
    const f = (AS.teams || {})[t.id];
    if (f) t.logo = '/logos/es/valorant/' + f;
  }

  // Elo walk-forward con las constantes VALIDADAS (priors.json): margen de serie + óxido por inactividad
  const C0 = priors.constants || {};
  const K = C0.K || 20, MB = C0.margin_boost || 1.35, IB = C0.idle_boost || 1.5, IDLE_D = C0.idle_days || 60;
  const elo = {}, matches = {}, form = {}, pairs = {}, lastPlayed = {};
  const wrAgg = {};
  for (const s of series) {
    const a = slug(s.t1), b = slug(s.t2);
    elo[a] = elo[a] != null ? elo[a] : 1500; elo[b] = elo[b] != null ? elo[b] : 1500;
    const y = s.s1 > s.s2 ? 1 : 0;
    const p = 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400));
    const t = Date.parse(s.at + 'T12:00:00Z');
    const idle = (id) => lastPlayed[id] != null && (t - lastPlayed[id]) > IDLE_D * 864e5;
    const margin = Math.abs(s.s1 - s.s2) / Math.max(1, s.s1 + s.s2);
    const scale = 1 + (MB - 1) * margin;
    elo[a] += K * (idle(a) ? IB : 1) * scale * (y - p);
    elo[b] -= K * (idle(b) ? IB : 1) * scale * (y - p);
    lastPlayed[a] = t; lastPlayed[b] = t;
    matches[a] = (matches[a] || 0) + 1; matches[b] = (matches[b] || 0) + 1;
    (wrAgg[a] = wrAgg[a] || { n: 0, w: 0 }); (wrAgg[b] = wrAgg[b] || { n: 0, w: 0 });
    wrAgg[a].n++; wrAgg[b].n++; if (y) wrAgg[a].w++; else wrAgg[b].w++;
    (form[a] = form[a] || []).push({ r: y ? 'W' : 'L', vs: b, at: s.at, score: `${s.s1}-${s.s2}` });
    (form[b] = form[b] || []).push({ r: y ? 'L' : 'W', vs: a, at: s.at, score: `${s.s2}-${s.s1}` });
    const pk = [a, b].sort().join('~');
    const P2 = pairs[pk] = pairs[pk] || { n: 0, w_a: 0, last: null, recent: [] };
    P2.n++; if ((pk.split('~')[0] === a) === (y === 1)) P2.w_a++; P2.last = s.at;
    P2.recent.push({ at: s.at, w: y ? a : b, s: `${Math.max(s.s1, s.s2)}-${Math.min(s.s1, s.s2)}` });
    if (P2.recent.length > 6) P2.recent.shift();
  }
  for (const id of Object.keys(form)) form[id] = form[id].slice(-10);
  const teamGlobal = {};
  for (const [id, e] of Object.entries(elo)) teamGlobal[id] = { elo: +e.toFixed(0), wr: wrAgg[id] ? +(wrAgg[id].w / wrAgg[id].n).toFixed(3) : null, n: matches[id] || 0 };

  // ranking GP: élite activa (≥8 series en 120 días), por Elo
  const lastAt = series.length ? series[series.length - 1].at : new Date().toISOString().slice(0, 10);
  const cut120 = new Date(Date.parse(lastAt + 'T12:00:00Z') - 120 * 864e5).toISOString().slice(0, 10);
  const recentN = {};
  for (const s of series) if (s.at >= cut120) { recentN[slug(s.t1)] = (recentN[slug(s.t1)] || 0) + 1; recentN[slug(s.t2)] = (recentN[slug(s.t2)] || 0) + 1; }
  const rankRows = Object.keys(teams).filter((id) => (recentN[id] || 0) >= 8)
    .sort((x, y) => (elo[y] || 0) - (elo[x] || 0)).slice(0, 60)
    .map((id, i) => ({ id, rank: i + 1, elo: +elo[id].toFixed(0), wr: teamGlobal[id].wr, n: recentN[id] || 0, team: teams[id] }));
  const rankings = { week: isoWeek(Date.parse(lastAt + 'T12:00:00Z')), rows: rankRows };

  // jugadores (identidad + stats del agregado) — quintetos por afiliación más reciente
  const players = {}; const playerStats = {}; const fiveOf = {};
  for (const st of Object.values(PS.players || {})) {
    const tid = st.team ? slug(st.team) : null;
    players[st.id] = { id: st.id, nick: st.nick, name: null, role: cap(st.class), team: tid,
      team_name: st.team || st.team_tag || null, photo: null, country_id: null, birthday: null, rating6m: null };
    playerStats[st.id] = st;
    if (tid) (fiveOf[tid] = fiveOf[tid] || []).push(st);
  }
  const CLASS_ORDER = { duelist: 0, initiator: 1, controller: 2, sentinel: 3 };
  const rosters = {};
  for (const [tid, arr] of Object.entries(fiveOf)) {
    const five = arr.sort((a, b) => b.n - a.n).slice(0, 5)
      .sort((a, b) => (CLASS_ORDER[a.class] ?? 9) - (CLASS_ORDER[b.class] ?? 9))
      .map((st) => ({ id: st.id, nick: st.nick, role: cap(st.class) }));
    rosters[tid] = { five, coach: null, changed_recently: false };
  }

  // mapas del circuito (para la ficha de equipo y el veto): fuerza propia por mapa desde map-stats
  const teamMaps = {};
  if (MS && MS.teams) {
    for (const [name, mm] of Object.entries(MS.teams)) {
      const tid = slug(name); if (!tid) continue;
      const entries = Object.entries(mm).map(([map, v]) => ({ map, n: v.n, w: v.w,
        wr: v.n ? +(v.w / v.n).toFixed(3) : null,
        rounds_share: v.rounds_t ? +(v.rounds_w / v.rounds_t).toFixed(3) : null }));
      teamMaps[tid] = { n: entries.reduce((s2, e) => s2 + e.n, 0), maps: entries.sort((a, b) => b.n - a.n) };
    }
  }

  const data = {
    available: series.length > 500,
    series, teams, teamGlobal, rosters, pairs, form, rankings,
    players, playerStats, playerStatsMeta: PS.players && Object.keys(PS.players).length
      ? { at: PS.at, window_days: PS.window_days, population: PS.population } : null,
    agents: AG, mapStats: MS, comps: CO, teamMaps,
    priors, maps: {}, pool: [],
    meta: META, at: META.at || new Date().toISOString(),
    byName: new Map(Object.values(teams).map((t) => [norm(t.name), t.id])),
    rights: 'Base propia derivada de vlr.gg (research_only) — rating interno, catálogo admin y sombra; sin picks públicas (RIGHTS.md).',
  };
  G.data = data; G.at = Date.now();
  return data;
}

function resolveTeam(name, { data = null } = {}) {
  const d = data || load();
  const k = norm(name);
  if (!k) return null;
  if (d.byName && d.byName.has(k)) return d.byName.get(k);
  // mismo guard de identidad que LoL: un prefijo compartido solo es variante si lo que sobra es palabra
  // de organización; los marcadores de segundo equipo (GC/academy/challengers…) NO resuelven al principal
  // — en Valorant los Game Changers comparten marca con el equipo principal sistemáticamente (V-0043).
  const SQUAD = /(^| )(gc|game changers?|academy|academia|challengers?|youth|rookies?|prospects?|female|fe|2|ii|b)( |$)/;
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
  const tm = d.teamMaps[id];
  // efecto = wr en el mapa − wr global en mapas (encogido por muestra): dónde gana MÁS de lo que le
  // tocaría por nivel — la misma lectura que la ficha de CS2, medida de la base propia
  const totW = tm ? tm.maps.reduce((s, m) => s + m.w, 0) : 0;
  const totN = tm ? tm.maps.reduce((s, m) => s + m.n, 0) : 0;
  const base = totN ? totW / totN : 0.5;
  const maps = tm ? tm.maps.filter((m) => m.n >= 5).map((m) => ({ map: m.map, n: m.n, w: m.w, wr: m.wr,
    rounds_share: m.rounds_share,
    effect: m.wr != null ? +(((m.w + base * 6) / (m.n + 6)) - base).toFixed(3) : null }))
    .sort((a, b) => (b.effect ?? 0) - (a.effect ?? 0)) : [];
  return { id, name: t.name, logo: t.logo || null, country_id: null, rank: null,
    elo: g.elo != null ? g.elo : null, wr: g.wr != null ? g.wr : null, n: g.n || 0,
    maps, roster: d.rosters[id] || null };
}

function rankingMovement({ data = null } = {}) {
  const d = data || load();
  if (!d.rankings) return null;
  return { week: d.rankings.week, prev_week: null, min_maps: 8, at: d.at,
    rows: d.rankings.rows.map((r) => ({ ...r, move: null })) };
}

// fuerza propia para el motor: Elo de la base + muestra (el anclaje a mercado lo decide el store)
function ratingsFor(nameA, nameB) {
  const d = load();
  if (!d.available) return null;
  const a = resolveTeam(nameA, { data: d }), b = resolveTeam(nameB, { data: d });
  if (!a || !b) return null;
  const ga = d.teamGlobal[a] || {}, gb = d.teamGlobal[b] || {};
  return { elo_a: ga.elo != null ? ga.elo : 1500, elo_b: gb.elo != null ? gb.elo : 1500,
    matches_a: ga.n || 0, matches_b: gb.n || 0, id_a: a, id_b: b };
}

// ── meta de agentes (contrato del tablero de la casa; ventana en lugar de parche, y se declara) ─────────
function agentsBoard({ role = null } = {}) {
  const d = load();
  if (!d.available || !d.agents || !(d.agents.rows || []).length) return { available: false };
  const rows = (d.agents.rows || [])
    .filter((r) => !role || r.class === String(role).toLowerCase())
    .map((r) => ({ ch: cap(r.agent), role: cap(r.class || '—'), n: r.n, wr: r.wr, wr_shrunk: r.wr_shrunk,
      presence_pct: r.presence_pct, bans: null, delta_wr: r.delta_wr }));
  return { available: true, window: d.agents.window, maps_cur: d.agents.maps_cur,
    rows, note: 'tasa de victoria ajustada por muestra; presencia = picks del agente sobre los huecos de la ventana de 90 días.' };
}

// ── inteligencia de composición para un cruce (la forma del Draft Room, con semántica de Valorant) ──────
function compIntel(nameA, nameB) {
  const d = load();
  if (!d.available) return { available: false, why: 'la base propia de Valorant no está cargada.' };
  const board = agentsBoard({});
  const side = (name) => {
    const id = resolveTeam(name, { data: d });
    if (!id) return { name, resolved: false };
    const ro = d.rosters[id];
    const five = ((ro && ro.five) || []).map((f) => {
      const st = d.playerStats[f.id] || {};
      const pool = (st.pool || []).slice(0, 6).map((c) => ({ ch: cap(c.agent), n: c.n,
        wr: c.n ? +(c.w / c.n).toFixed(2) : null, rw: c.rw,
        flex: (st.classes_played || 1) >= 3,
        comfort: +(c.rw * ((c.w + 3) / (c.n + 6))).toFixed(2) }));
      return { id: f.id, nick: f.nick, role: f.role, rating_gp: st.rating_gp || null, n: st.n || 0, pool };
    });
    const comfortTotal = five.reduce((s, p) => s + p.pool.reduce((x, c) => x + c.comfort, 0), 0);
    const allPicks = five.flatMap((p) => p.pool.map((c) => c.comfort)).sort((x, y) => y - x);
    const drop3 = allPicks.slice(0, 3).reduce((s, x) => s + x, 0);
    return { name, resolved: true, id, five,
      comfort_total: +comfortTotal.toFixed(1),
      fragility_pct: comfortTotal ? +(100 * drop3 / comfortTotal).toFixed(1) : null };
  };
  return {
    available: true, patch: null, window: (d.agents && d.agents.window) || null,
    a: side(nameA), b: side(nameB),
    meta_top: (board.rows || []).slice(0, 10).map((r) => ({ ch: r.ch, role: r.role, presence_pct: r.presence_pct, wr_shrunk: r.wr_shrunk, delta_wr: r.delta_wr })),
    provenance: 'pools, comfort y fragilidad medidos de la base propia de GP sobre la ventana vigente.',
    rights_note: 'Datos derivados de vlr.gg.',
  };
}

// fuerza por mapa de un cruce (alimenta el árbol de veto del motor cuando ambos resuelven)
function mapsFor(nameA, nameB) {
  const d = load();
  if (!d.available || !d.mapStats) return null;
  const a = resolveTeam(nameA, { data: d }), b = resolveTeam(nameB, { data: d });
  if (!a || !b) return null;
  const A = d.teamMaps[a], B = d.teamMaps[b];
  if (!A || !B) return null;
  const rot = new Set((d.mapStats.rows || []).filter((m) => m.in_rotation).map((m) => m.map));
  const out = {};
  for (const map of rot) {
    const ma = (A.maps || []).find((m) => m.map === map), mb = (B.maps || []).find((m) => m.map === map);
    out[map] = { a: ma ? { n: ma.n, wr: ma.wr, rounds_share: ma.rounds_share } : null,
      b: mb ? { n: mb.n, wr: mb.wr, rounds_share: mb.rounds_share } : null,
      circuit: (d.mapStats.rows || []).find((m) => m.map === map) || null };
  }
  return out;
}

// entrada del árbol de veto del motor (map_strength + agent_depth por clave de mapa del pool).
// La fuerza por mapa es la WR propia encogida hacia 0,5 (K=8 mapas) enfrentada entre los dos; la
// profundidad es la familiaridad de composición (cuota de la comp más usada en ese mapa). Mapas nuevos
// que el pool del motor no lista aún quedan fuera y el veto lo dice con menos ramas — no se inventan.
function vetoInput(nameA, nameB) {
  const d = load();
  const mf = mapsFor(nameA, nameB);
  if (!mf) return null;
  const clamp = (x) => Math.max(0.05, Math.min(0.95, x));
  const sh = (wr, n, k = 8) => (wr == null ? null : (wr * n + 0.5 * k) / (n + k));
  const ms = { a: {}, b: {} }, depth = { a: {}, b: {} };
  const depthOf = (name, map) => {
    if (!d.comps || !d.comps.teams) return null;
    const t = d.comps.teams[name]; if (!t || !t[map]) return null;
    const entries = Object.values(t[map]);
    const total = entries.reduce((s, c) => s + c.n, 0);
    const top = entries.reduce((m, c) => Math.max(m, c.n), 0);
    return total >= 3 ? +(top / total).toFixed(2) : null;
  };
  for (const [map, v] of Object.entries(mf)) {
    const key = map.toLowerCase();
    const wa = v.a ? sh(v.a.wr, v.a.n) : null, wb = v.b ? sh(v.b.wr, v.b.n) : null;
    if (wa == null || wb == null) continue;
    ms.a[key] = +clamp(0.5 + (wa - wb) / 2).toFixed(3);
    ms.b[key] = +(1 - ms.a[key]).toFixed(3);
    const da = depthOf(nameA, map), db = depthOf(nameB, map);
    if (da != null) depth.a[key] = da;
    if (db != null) depth.b[key] = db;
  }
  if (Object.keys(ms.a).length < 3) return null;
  return { map_strength: ms, agent_depth: (Object.keys(depth.a).length || Object.keys(depth.b).length) ? depth : null };
}

// ¿estructura propia MEDIDA para este par? (19-ago) 33k series de vlr.gg con Elo validado walk-forward.
function datasetFor(nameA, nameB) {
  const d = load();
  if (!d.available) return null;
  const r = ratingsFor(nameA, nameB);
  const pair = r ? Math.min(r.matches_a, r.matches_b) : 0;
  return { available: !!r && pair >= 15, at: d.at, teams: Object.keys(d.teams || {}).length,
    games: (d.series || []).length, pair_sample: pair, unit: 'series',
    source: 'base propia de Valorant (vlr.gg), validada walk-forward' };
}

module.exports = { load, norm, resolveTeam, teamCard, rankingMovement, ratingsFor, datasetFor,
  agentsBoard, championsBoard: agentsBoard, compIntel, mapsFor, vetoInput, DIR, MODEL_VERSION: 'val-elo-series-1' };
