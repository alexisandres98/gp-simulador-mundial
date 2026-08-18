// esports-engine/lol-data.js — EL CATÁLOGO PROPIO DE LoL (18-ago, blueprint 3.0).
//
// El contrato es el de cs2-data (load / norm / resolveTeam / teamCard / rankingMovement) para que las
// pantallas de la casa — Equipos, Ranking GP, Jugadores, fichas — se enciendan para LoL sin una card
// nueva; y encima lleva lo que SOLO LoL tiene: posterior de campeón por parche×rol, mastery
// jugador×campeón, tempo MEDIDO por liga y la inteligencia de draft (comfort, fragilidad, flex).
//
// LO QUE LoL NO TIENE Y NO SE FINGE: mapas (el objeto de CS2) — `maps` viaja vacío y El circuito lo dice;
// fotos/arte de campeones (LOL-0043: los assets de Riot son un derecho aparte → representación texto-first).
//
// DERECHOS: toda la base es research_attribution_ccbysa (ver data/esports/lol/RIGHTS.md). Alimenta rating,
// catálogo y sombra admin; NINGUNA pick pública puede nacer de aquí (LOL-0038). La probabilidad publicada
// sigue anclada a mercado; esta base solo mueve el PESO del modelo con la evidencia de su validación.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'esports', 'lol');
// la base grande viaja gzip en el repo (games/drafts pesan 28 MB planos): .gz primero, plano después
const rdf = (f) => {
  try { return JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, f + '.gz'))).toString('utf8')); } catch { }
  try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; }
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');
const majorPatch = (p) => { const m = String(p || '').match(/^(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : null; };
const isoWeek = (d) => { const t = new Date(d); const oneJan = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + '-W' + String(Math.ceil((((t - oneJan) / 864e5) + oneJan.getUTCDay() + 1) / 7)).padStart(2, '0'); };

const G = global._loldata = global._loldata || { data: null, at: 0 };

// ── carga + derivación en memoria (45k partidas: ~1s, cache 10 min) ─────────────────────────────────────
function load() {
  if (G.data && Date.now() - G.at < 10 * 60e3) return G.data;
  const gamesRaw = rdf('games.json');
  if (!gamesRaw || !gamesRaw.rows) { const empty = { available: false, teams: {}, players: {}, playerStats: {}, maps: {}, pairs: {}, form: {}, rankings: null }; return empty; }
  const priors = rdf('priors.json') || { constants: { K: 20, patch_decay: 1.5, side_step: 1 }, side_advantage_elo: 0 };
  const PS = rdf('player-stats.json') || { players: {} };
  const CH = rdf('champions.json') || { rows: [], bans: [], games_by_patch: {} };
  const META = rdf('meta.json') || {};
  const AS = rdf('assets.json') || { teams: {}, players: {} };   // escudos y fotos auto-hospedados
  const games = Object.values(gamesRaw.rows).filter((g) => g.t1 && g.t2 && g.win && g.at).sort((a, b) => (a.at < b.at ? -1 : 1));

  // equipos + liga (primer segmento de OverviewPage: "LCK/2026 Season/…" → LCK)
  const teams = {}; const leagueOf = {};
  const leagueKey = (page) => String(page || '').split('/')[0].trim() || null;
  for (const g of games) {
    for (const name of [g.t1, g.t2]) {
      const id = slug(name); if (!id) continue;
      const t = teams[id] = teams[id] || { id, name, logo: null, icon: null, rank: null, country_id: null, n: 0, league: null, _lg: {} };
      t.n++; t.name = name;
      const lk = leagueKey(g.page);
      if (lk) t._lg[lk] = (t._lg[lk] || 0) + 1;
    }
  }
  for (const t of Object.values(teams)) {
    t.league = Object.entries(t._lg).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    delete t._lg;
  }
  // ESCUDO AUTO-HOSPEDADO (19-ago): el manifiesto lo escribe scripts/esports-assets.js. Sin entrada, el
  // equipo cae al monograma tintado — nunca a un hueco.
  for (const t of Object.values(teams)) {
    const f = (AS.teams || {})[t.id];
    if (f) t.logo = '/logos/es/lol/' + f;
  }

  // Elo walk-forward con las constantes VALIDADAS (priors.json) + lado azul + recencia por parche
  const C0 = priors.constants || {};
  const K = C0.K || 20, PD = C0.patch_decay || 1.5, SS = C0.side_step || 1;
  const elo = {}, matches = {}, form = {}, pairs = {};
  let sideElo = 0, lastPatch = null;
  const wrAgg = {};
  for (const g of games) {
    const a = slug(g.t1), b = slug(g.t2);
    elo[a] = elo[a] != null ? elo[a] : 1500; elo[b] = elo[b] != null ? elo[b] : 1500;
    const y = g.win === g.t1 ? 1 : 0;
    const p = 1 / (1 + Math.pow(10, (elo[b] - elo[a] - sideElo) / 400));
    const mp = majorPatch(g.patch);
    let kEff = K; if (mp && lastPatch && mp !== lastPatch) kEff = K * PD;
    if (mp) lastPatch = mp;
    const upd = kEff * (y - p);
    elo[a] += upd; elo[b] -= upd; sideElo += SS * (y - p);
    matches[a] = (matches[a] || 0) + 1; matches[b] = (matches[b] || 0) + 1;
    (wrAgg[a] = wrAgg[a] || { n: 0, w: 0 }); (wrAgg[b] = wrAgg[b] || { n: 0, w: 0 });
    wrAgg[a].n++; wrAgg[b].n++; if (y) wrAgg[a].w++; else wrAgg[b].w++;
    (form[a] = form[a] || []).push({ r: y ? 'W' : 'L', vs: b, at: (g.at || '').slice(0, 10), score: `${g.k1 ?? '—'}-${g.k2 ?? '—'}` });
    (form[b] = form[b] || []).push({ r: y ? 'L' : 'W', vs: a, at: (g.at || '').slice(0, 10), score: `${g.k2 ?? '—'}-${g.k1 ?? '—'}` });
    const pk = [a, b].sort().join('~');
    const P2 = pairs[pk] = pairs[pk] || { n: 0, w_a: 0, last: null };
    P2.n++; if ((pk.split('~')[0] === a) === (y === 1)) P2.w_a++; P2.last = (g.at || '').slice(0, 10);
  }
  for (const id of Object.keys(form)) form[id] = form[id].slice(-10);
  const teamGlobal = {};
  for (const [id, e] of Object.entries(elo)) teamGlobal[id] = { elo: +e.toFixed(0), wr: wrAgg[id] ? +(wrAgg[id].w / wrAgg[id].n).toFixed(3) : null, n: matches[id] || 0 };

  // ranking GP: élite activa (≥10 partidas en 90 días), por Elo
  const lastAt = games.length ? games[games.length - 1].at : new Date().toISOString();
  const cut90 = new Date(Date.parse(String(lastAt).replace(' ', 'T') + 'Z') - 90 * 864e5).toISOString().slice(0, 19).replace(' ', 'T');
  const recentN = {};
  for (const g of games) if ((g.at || '').replace(' ', 'T') >= cut90) { recentN[slug(g.t1)] = (recentN[slug(g.t1)] || 0) + 1; recentN[slug(g.t2)] = (recentN[slug(g.t2)] || 0) + 1; }
  // 18-ago (reporte de Alexis): el Elo se INFLA en piscinas cerradas de tier-2 (ERL/academias juegan solo
  // entre sí y nadie las corrige hacia abajo) → el ranking lo encabezaban Galions/Solary por delante de
  // LCK/LPL. El ranking GP es del CIRCUITO PRINCIPAL: solo equipos con partidas recientes en tier-1.
  const TIER1 = /^(LCK$|LPL$|LEC$|LCS$|LTA|LCP$|LLA$|CBLOL$|Worlds|World Championship|MSI|Mid-Season|First Stand|Esports World Cup)/i;
  const recentT1 = {};
  for (const g of games) if ((g.at || '').replace(' ', 'T') >= cut90 && TIER1.test(leagueKey(g.page) || '')) {
    recentT1[slug(g.t1)] = (recentT1[slug(g.t1)] || 0) + 1; recentT1[slug(g.t2)] = (recentT1[slug(g.t2)] || 0) + 1;
  }
  const t1Ids = Object.keys(teams).filter((id) => (recentT1[id] || 0) >= 6);
  const poolIds = t1Ids.length >= 15 ? t1Ids : Object.keys(teams).filter((id) => (recentN[id] || 0) >= 10);
  const rankRows = poolIds
    .sort((x, y) => (elo[y] || 0) - (elo[x] || 0)).slice(0, 60)
    .map((id, i) => ({ id, rank: i + 1, elo: +elo[id].toFixed(0), wr: teamGlobal[id].wr, n: recentN[id] || 0, team: teams[id] }));
  const rankings = { week: isoWeek(Date.parse(String(lastAt).replace(' ', 'T') + 'Z')), rows: rankRows };

  // jugadores: identidad + stats (del agregado) — quinteto por equipo desde la afiliación más reciente
  const players = {}; const playerStats = {}; const fiveOf = {};
  for (const st of Object.values(PS.players || {})) {
    const tid = st.team ? slug(st.team) : null;
    players[st.id] = { id: st.id, nick: st.nick, name: null, role: st.role, team: tid,
      team_name: st.team || null, photo: null, country_id: null, birthday: null, rating6m: null };
    playerStats[st.id] = st;
    if (tid) (fiveOf[tid] = fiveOf[tid] || []).push(st);
  }
  const ROLE_ORDER = { Top: 0, Jungle: 1, Mid: 2, Bot: 3, Support: 4 };
  const rosters = {};
  for (const [tid, arr] of Object.entries(fiveOf)) {
    const byRole = {};
    for (const st of arr.sort((a, b) => b.n - a.n)) { const r = st.role || 'Flex'; if (!byRole[r]) byRole[r] = st; }
    const five = Object.values(byRole).sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)).slice(0, 5)
      .map((st) => ({ id: st.id, nick: st.nick, role: st.role }));
    rosters[tid] = { five, coach: null, changed_recently: false };
  }

  // PLANTILLA DE IDENTIDAD (19-ago): las caras vienen del catálogo oficial de LoL Esports y se pegan por
  // NICK, no por id — la estadística la lleva Leaguepedia y la foto la lleva Riot, son dos numeraciones
  // distintas para la misma persona. Donde el quinteto YA está medido, la cara se le añade encima; donde
  // no hay medición todavía, el quinteto se sirve igual con nombre y cara, marcado como identidad.
  {
    const face = {};                                             // nick normalizado → {photo, real, role, country}
    for (const rec of Object.values(AS.players || {})) {
      if (!rec || !rec.nick) continue;
      const k = String(rec.nick).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (k && !face[k]) face[k] = rec;
    }
    for (const p of Object.values(players)) {
      const k = String(p.nick || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const f = k && face[k];
      if (!f) continue;
      if (f.photo && !p.photo) p.photo = '/logos/es/lol/players/' + f.photo;
      if (f.real && !p.name) p.name = f.real;
      if (f.country && !p.country) p.country = f.country;
      if (f.role && !p.role) p.role = f.role.replace(/^./, (c) => c.toUpperCase());
    }
    for (const r of Object.values(rosters)) {
      for (const q of (r.five || [])) {
        const src = players[q.id];
        if (src) { if (src.photo) q.photo = src.photo; if (src.name) q.name = src.name; if (src.country) q.country = src.country; }
      }
    }
    const byTeam = {};
    for (const [pid, rec] of Object.entries(AS.players || {})) {
      if (!rec || !rec.team) continue;
      (byTeam[rec.team] = byTeam[rec.team] || []).push({ id: pid, nick: rec.nick || ('#' + pid),
        role: rec.role ? rec.role.replace(/^./, (c) => c.toUpperCase()) : null, name: rec.real || null,
        photo: rec.photo ? '/logos/es/lol/players/' + rec.photo : null, identity_only: true });
    }
    for (const [tid, arr] of Object.entries(byTeam)) {
      if (rosters[tid] && (rosters[tid].five || []).length) continue;
      rosters[tid] = { five: arr.slice(0, 5), coach: null, changed_recently: false, identity_only: true };
    }
    for (const p2 of Object.values(byTeam).flat()) {
      if (!players[p2.id]) players[p2.id] = { id: p2.id, nick: p2.nick, name: p2.name || null, role: p2.role || null,
        team: null, team_name: null, photo: p2.photo, country: p2.country || null, country_id: null,
        birthday: null, rating6m: null, identity_only: true };
    }
  }

  // tempo MEDIDO por liga (últimos 180 días): kills/min y duración — sustituye el perfil de circuito asumido
  const cut180 = new Date(Date.parse(String(lastAt).replace(' ', 'T') + 'Z') - 180 * 864e5).toISOString().slice(0, 19);
  const tempoAgg = {};
  for (const g of games) {
    if ((g.at || '') < cut180 || g.len == null || g.k1 == null) continue;
    const lk = leagueKey(g.page); if (!lk) continue;
    const t = tempoAgg[lk] = tempoAgg[lk] || { n: 0, kills: 0, min: 0 };
    t.n++; t.kills += (g.k1 + g.k2); t.min += g.len;
  }
  const leagueTempo = {};
  for (const [lk, t] of Object.entries(tempoAgg)) if (t.n >= 20)
    leagueTempo[lk] = { league: lk, n: t.n, kpm: +(t.kills / t.min).toFixed(3), mean_min: +(t.min / t.n).toFixed(1) };

  const data = {
    available: games.length > 500,
    games, teams, teamGlobal, rosters, pairs, form, rankings,
    players, playerStats, playerStatsMeta: PS.players ? { at: PS.at, window_days: PS.window_days, population: PS.population } : null,
    champions: CH, leagueTempo,
    side_advantage_elo: priors.side_advantage_elo || +sideElo.toFixed(1),
    priors, maps: {}, pool: [],
    meta: META, at: META.at || new Date().toISOString(),
    byName: new Map(Object.values(teams).map((t) => [norm(t.name), t.id])),
    rights: 'Base propia derivada de Leaguepedia (CC BY-SA) — atribución requerida; research/catálogo/sombra, no picks públicas (RIGHTS.md).',
  };
  G.data = data; G.at = Date.now();
  return data;
}

function resolveTeam(name, { data = null } = {}) {
  const d = data || load();
  const k = norm(name);
  if (!k) return null;
  if (d.byName && d.byName.has(k)) return d.byName.get(k);
  // tolerancia a variantes del libro: "T1" vs "T1 Esports", "Gen.G" vs "GenG" — PERO un prefijo compartido
  // solo es una variante si lo que sobra es palabra de organización. En LoL las academias se llaman como el
  // principal + marcador ("Nongshim RedForce Challengers", "T1 Esports Academy"): darle a la academia el
  // quinteto y el Elo del primer equipo es darle el pasado de otro — mejor no resolver (bug cazado en el
  // smoke-test del 18-ago con datos sintéticos).
  const SQUAD = /(^| )(challengers?|academy|academia|youth|rookies?|prospects?|female|fe|gc|2|ii|b)( |$)/;
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
  return { id, name: t.name, logo: t.logo || null, country_id: null, rank: null,
    elo: g.elo != null ? g.elo : null, wr: g.wr != null ? g.wr : null, n: g.n || 0,
    maps: [],                                          // LoL no tiene mapas: el objeto del juego es el draft
    roster: d.rosters[id] || null };
}

function rankingMovement({ data = null } = {}) {
  const d = data || load();
  if (!d.rankings) return null;
  return { week: d.rankings.week, prev_week: null, min_maps: 10, at: d.at,
    rows: d.rankings.rows.map((r) => ({ ...r, move: null })) };
}

// ── ratings para el motor: Elo propio + muestra por NOMBRE del libro ─────────────────────────────────────
function ratingsFor(nameA, nameB) {
  const d = load();
  if (!d.available) return null;
  const a = resolveTeam(nameA, { data: d }), b = resolveTeam(nameB, { data: d });
  if (!a || !b) return null;
  return {
    elo_a: d.teamGlobal[a] ? d.teamGlobal[a].elo : null, elo_b: d.teamGlobal[b] ? d.teamGlobal[b].elo : null,
    matches_a: d.teamGlobal[a] ? d.teamGlobal[a].n : 0, matches_b: d.teamGlobal[b] ? d.teamGlobal[b].n : 0,
    id_a: a, id_b: b, side_advantage_elo: d.side_advantage_elo,
  };
}

// tempo medido para la competición del libro (por inclusión de nombre: "LCK Challengers" casa con LCK CL primero)
function tempoFor(competition) {
  const d = load();
  if (!d.available || !competition) return null;
  const k = norm(competition);
  let best = null;
  for (const t of Object.values(d.leagueTempo || {})) {
    const lk = norm(t.league);
    if (k === lk || k.includes(lk) || lk.includes(k)) {
      if (!best || t.league.length > best.league.length) best = t;   // el nombre MÁS específico gana
    }
  }
  return best;
}

// ── posterior de campeón por parche×rol (para la vista Campeones y el Draft Room) ────────────────────────
function championsBoard({ role = null } = {}) {
  const d = load();
  if (!d.available || !d.champions) return { available: false };
  const rowsAll = d.champions.rows || [];
  const patches = Object.entries(d.champions.games_by_patch || {}).filter(([, n]) => n >= 150)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const cur = patches[0] ? patches[0][0] : null;
  const prev = patches[1] ? patches[1][0] : null;
  if (!cur) return { available: false };
  const KSH = (d.champions.shrink_k || 25);
  const bansCur = new Map((d.champions.bans || []).filter((b) => b.patch === cur).map((b) => [b.ch, b.n]));
  const gamesCur = d.champions.games_by_patch[cur] || 1;
  const mk = (patch) => {
    const out = {};
    for (const r of rowsAll) {
      if (r.patch !== patch) continue;
      if (role && r.role !== role) continue;
      const o = out[`${r.ch}|${r.role}`] = out[`${r.ch}|${r.role}`] || { ch: r.ch, role: r.role, n: 0, w: 0 };
      o.n += r.n; o.w += r.w;
    }
    return out;
  };
  const curMap = mk(cur), prevMap = mk(prev);
  const rows = Object.values(curMap).map((o) => {
    const wrShrunk = (o.w + 0.5 * KSH) / (o.n + KSH);
    const pv = prevMap[`${o.ch}|${o.role}`];
    const bans = bansCur.get(o.ch) || 0;
    return { ch: o.ch, role: o.role, n: o.n, wr: +(o.w / o.n).toFixed(3), wr_shrunk: +wrShrunk.toFixed(3),
      presence_pct: +((o.n + bans) / gamesCur * 100).toFixed(1), bans,
      delta_wr: pv && pv.n >= 10 ? +((o.w / o.n) - (pv.w / pv.n)).toFixed(3) : null };
  }).sort((a, b) => b.presence_pct - a.presence_pct);
  return { available: true, patch: cur, prev_patch: prev, games_patch: gamesCur, shrink_k: KSH, rows,
    note: `tasa de victoria ajustada por muestra; presencia = participación del campeón (picks y bans) sobre las partidas del parche ${cur}.` };
}

// ── inteligencia de draft para un cruce (Draft Room V1) ──────────────────────────────────────────────────
// Todo MEDIDO desde la base: pools por jugador (mastery con recencia), comfort del quinteto, fragilidad
// (cuánto colapsa el comfort si le quitan sus 3 picks más cómodos — LOL-0207) y flex del parche (campeones
// que se juegan en 2+ roles — LOL-0192). Nada de taxonomías inventadas: eso llega con más capas.
function draftIntel(nameA, nameB) {
  const d = load();
  if (!d.available) return { available: false, why: 'la base propia de LoL no está cargada.' };
  const board = championsBoard({});
  const flexSet = (() => {
    const byCh = {};
    for (const r of (board.rows || [])) if (r.n >= 5) (byCh[r.ch] = byCh[r.ch] || []).push(r.role);
    return new Set(Object.entries(byCh).filter(([, roles]) => roles.length >= 2).map(([ch]) => ch));
  })();
  const side = (name) => {
    const id = resolveTeam(name, { data: d });
    if (!id) return { name, resolved: false };
    const ro = d.rosters[id];
    const five = ((ro && ro.five) || []).map((f) => {
      const st = d.playerStats[f.id] || {};
      const pool = (st.champs || []).slice(0, 6).map((c) => ({ ch: c.ch, n: c.n, wr: c.n ? +(c.w / c.n).toFixed(2) : null,
        rw: c.rw, flex: flexSet.has(c.ch),
        // comfort = peso reciente × señal de rendimiento encogida (K=6): volumen sin rendimiento no es comfort
        comfort: +(c.rw * ((c.w + 3) / (c.n + 6))).toFixed(2) }));
      return { id: f.id, nick: f.nick, role: f.role, rating_gp: st.rating_gp || null, n: st.n || 0, pool,
        photo: f.photo || null, name: f.name || null, country: f.country || null,
        identity_only: !!f.identity_only };
    });
    const comfortTotal = five.reduce((s, p) => s + p.pool.reduce((x, c) => x + c.comfort, 0), 0);
    // fragilidad: quitar los 3 picks más cómodos del equipo y medir cuánto comfort queda (LOL-0207)
    const allPicks = five.flatMap((p) => p.pool.map((c) => c.comfort)).sort((x, y) => y - x);
    const drop3 = allPicks.slice(0, 3).reduce((s, x) => s + x, 0);
    return { name, resolved: true, id, five,
      comfort_total: +comfortTotal.toFixed(1),
      fragility_pct: comfortTotal ? +(100 * drop3 / comfortTotal).toFixed(1) : null };
  };
  return {
    available: true, patch: board.patch || null,
    a: side(nameA), b: side(nameB),
    meta_top: (board.rows || []).slice(0, 10).map((r) => ({ ch: r.ch, role: r.role, presence_pct: r.presence_pct, wr_shrunk: r.wr_shrunk, delta_wr: r.delta_wr })),
    provenance: 'pools, comfort y fragilidad medidos de la base propia de GP sobre el parche vigente.',
    rights_note: 'Datos derivados de Leaguepedia (CC BY-SA).',
  };
}

// ¿estructura propia MEDIDA para este par? (19-ago) Puerta de las familias de mapas: la fuerza del par
// sale de 84k partidas con Elo validado walk-forward; sin muestra de los DOS equipos no se valora.
function datasetFor(nameA, nameB) {
  const d = load();
  if (!d.available) return null;
  const r = ratingsFor(nameA, nameB);
  const pair = r ? Math.min(r.matches_a, r.matches_b) : 0;
  return { available: !!r && pair >= 15, at: d.at, teams: Object.keys(d.teams || {}).length,
    games: (d.games || []).length, pair_sample: pair, unit: 'partidas',
    source: 'base propia de LoL (linaje Leaguepedia), validada walk-forward' };
}

module.exports = { load, norm, resolveTeam, teamCard, rankingMovement, ratingsFor, tempoFor, datasetFor,
  championsBoard, draftIntel, DIR, MODEL_VERSION: 'lol-elo-side-patch-1' };
