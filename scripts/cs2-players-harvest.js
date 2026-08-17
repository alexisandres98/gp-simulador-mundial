// scripts/cs2-players-harvest.js — LA ESTADÍSTICA PROPIA DE JUGADOR, POR MAPA (17-ago).
//
// Hasta hoy la ficha de un jugador enseñaba el rating de 6 meses DEL PROVEEDOR, etiquetado como suyo porque
// era lo honesto: GP no tenía nada propio que decir de un jugador. Este script es lo que cambia eso. Baja el
// scoreboard real de cada mapa jugado (`/games/{id}/players_stats`: kills, muertes, KAST, ADR, duelos de
// apertura, trades, clutches) y deriva un RATING PROPIO con definición pública y auditable.
//
// ── LA DEFINICIÓN DEL RATING GP DE JUGADOR (v1), escrita aquí porque el número sin su fórmula es humo ────
//   Sobre la ventana (180 días por defecto), por jugador y por ronda jugada:
//     kpr (kills/ronda) · dpr (muertes/ronda) · adr (daño medio/ronda) · kast (% rondas con aporte)
//     open (duelos de apertura: (first_kills − first_deaths)/ronda)
//   Cada componente se estandariza (z-score) contra la POBLACIÓN de jugadores cualificados (≥ MIN_ROUNDS
//   rondas en la ventana) y se combina:
//     z = 0.30·z(adr) + 0.25·z(kast) + 0.20·z(kpr) + 0.15·(−z(dpr)) + 0.10·z(open)
//     rating_gp = 1.00 + 0.15·z   (acotado a [0.60, 1.60])
//   La media del circuito es 1.00 POR CONSTRUCCIÓN — la escala se lee como la de HLTV pero la fórmula es
//   nuestra y está aquí, no en un paper ajeno. El rating del proveedor se sigue guardando al lado: dos
//   varas de medir con procedencia clara valen más que una sola sin ella.
//
// ── CRUDO / AGREGADO, mismo contrato que la cosecha de mapas ─────────────────────────────────────────────
//   · CRUDO     → `<raw>/player-games.json` — un registro por mapa con las 10 filas del scoreboard, slim
//                 (sin daños acumulados por ronda, que pesan 10× y no alimentan nada todavía).
//   · AGREGADO  → `data/esports/cs2/player-map-stats.json` — por jugador: total + por mapa + rating_gp.
//
// Uso:
//   node scripts/cs2-players-harvest.js                    # incremental (juegos sin scoreboard aún, 180d)
//   node scripts/cs2-players-harvest.js --since=2026-02-01 # ventana explícita
//   node scripts/cs2-players-harvest.js --max=2000         # tope de juegos nuevos por pasada
//   node scripts/cs2-players-harvest.js --aggregate-only   # re-deriva sin red
'use strict';

const fs = require('fs');
const path = require('path');
const B3 = require('../data-providers/esports/bo3');

const ROOT = path.join(__dirname, '..');
const AGG_DIR = path.join(ROOT, 'data', 'esports', 'cs2');
const RAW_DIR = (() => {
  const d = path.join(path.dirname(process.env.DB_FILE || path.join(ROOT, 'db.json')), 'esports', 'cs2-raw');
  try { fs.mkdirSync(d, { recursive: true }); return d; } catch { }
  const f = path.join(ROOT, 'data', 'esports', 'cs2-raw');
  try { fs.mkdirSync(f, { recursive: true }); } catch { }
  return f;
})();

const rdRaw = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')); } catch { return null; } };
const wrRaw = (f, o) => fs.writeFileSync(path.join(RAW_DIR, f), JSON.stringify(o));
const wrAgg = (f, o) => fs.writeFileSync(path.join(AGG_DIR, f), JSON.stringify(o));
const log = (...a) => console.log(...a);
const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [s, true];
}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WINDOW_DAYS = +(ARG.days || 180);
const MIN_ROUNDS = 300;      // por debajo, el z-score es ruido con nombre propio
const MIN_MAP_N = 8;         // mínimo de mapas para publicar el desglose de UN mapa

// ── 1) COSECHA ───────────────────────────────────────────────────────────────────────────────────────────
async function harvest() {
  const games = rdRaw('games.json') || {};
  const store = rdRaw('player-games.json') || {};
  const since = ARG.since ? Date.parse(ARG.since) : Date.now() - WINDOW_DAYS * 864e5;
  const max = +(ARG.max || Infinity);
  // pendientes: mapas de la ventana que aún no tienen scoreboard. Los más recientes primero: si la pasada
  // se corta, lo nuevo ya quedó — lo viejo puede esperar a la siguiente.
  const todo = Object.values(games)
    .filter((g) => g.provider_id && Date.parse(g.at || 0) > since && !store[g.provider_id])
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))
    .slice(0, max);
  log(`▸ scoreboards pendientes en la ventana: ${todo.length} (guardados: ${Object.keys(store).length})`);
  let done = 0, empty = 0;
  for (const g of todo) {
    const j = await B3.req(`/games/${g.provider_id}/players_stats`);
    await sleep(B3.THROTTLE_MS);
    if (!Array.isArray(j) || !j.length) {
      // sin scoreboard (partida antigua o sin demo): se marca para no volver a pedirla cada día
      store[g.provider_id] = { at: g.at, map: g.map, empty: 1 };
      empty++;
      continue;
    }
    store[g.provider_id] = {
      at: g.at, map: g.map, rounds: g.rounds != null ? g.rounds : null,
      rows: j.map((r) => ({
        // identidad: el player_id/slug del perfil anidado; sin él la fila no se puede atribuir y se guarda
        // solo con el steam_profile_id por si el perfil aparece después
        pid: r.steam_profile && r.steam_profile.player_id != null ? r.steam_profile.player_id : null,
        slug: r.steam_profile && r.steam_profile.player && r.steam_profile.player.slug ? r.steam_profile.player.slug : null,
        nick: (r.steam_profile && r.steam_profile.nickname) || null,
        sp: r.steam_profile_id,
        clan: r.clan_name || null, win: r.win ? 1 : 0,
        k: r.kills || 0, d: r.death || 0, a: r.assists || 0, hs: r.headshots || 0,
        fk: r.first_kills || 0, fd: r.first_death || 0, tk: r.trade_kills || 0, td: r.trade_death || 0,
        kast: Number.isFinite(r.kast) ? +r.kast.toFixed(4) : null,
        adr: Number.isFinite(r.adr) ? +r.adr.toFixed(2) : null,
        cl: r.clutches || 0,
        mk: r.multikills ? { 3: r.multikills['3'] || 0, 4: r.multikills['4'] || 0, 5: r.multikills['5'] || 0 } : null,
        pr: Number.isFinite(r.player_rating) ? +r.player_rating.toFixed(3) : null,
      })),
    };
    done++;
    if (done % 200 === 0) { wrRaw('player-games.json', store); log(`  ${done}/${todo.length} scoreboards…`); }
  }
  wrRaw('player-games.json', store);
  log(`  listo: ${done} scoreboards nuevos · ${empty} sin datos · total ${Object.keys(store).length}`);
  return store;
}

// ── 2) AGREGADO + RATING GP ──────────────────────────────────────────────────────────────────────────────
function aggregate(store) {
  const since = Date.now() - WINDOW_DAYS * 864e5;
  const P = {};   // slug → acumuladores
  for (const g of Object.values(store)) {
    if (g.empty || !g.rows || Date.parse(g.at || 0) < since) continue;
    const rounds = g.rounds != null ? g.rounds : g.rows.reduce((m, r) => Math.max(m, r.k + r.d), 0) || null;
    if (!rounds || !g.map) continue;
    for (const r of g.rows) {
      if (!r.slug) continue;                          // sin identidad no hay atribución
      const p = P[r.slug] = P[r.slug] || { slug: r.slug, pid: r.pid, nick: r.nick, n: 0, rounds: 0,
        k: 0, d: 0, a: 0, hs: 0, fk: 0, fd: 0, cl: 0, m3: 0, kast_w: 0, adr_w: 0, pr_w: 0, pr_n: 0, win: 0, maps: {}, recent: [] };
      // BITÁCORA (v3, ficha de jugador): los últimos mapas con rival, K-D, ADR y resultado
      const enemy = (g.rows.find((x) => x.clan !== r.clan) || {}).clan || null;
      // `hs` entró el 17-ago para poder LIQUIDAR props de headshots desde el log propio; el crudo ya lo
      // traía por mapa, así que la pasada diaria repuebla la bitácora entera con el campo.
      p.recent.push({ at: (g.at || '').slice(0, 10), map: g.map, vs: enemy, k: r.k, d: r.d, hs: r.hs,
        adr: r.adr, kast: r.kast, win: r.win });
      if (p.recent.length > 12) p.recent.shift();
      p.nick = r.nick || p.nick;
      p.n++; p.rounds += rounds; p.win += r.win;
      p.k += r.k; p.d += r.d; p.a += r.a; p.hs += r.hs; p.fk += r.fk; p.fd += r.fd; p.cl += r.cl;
      p.m3 += r.mk ? (r.mk[3] + r.mk[4] + r.mk[5]) : 0;
      if (r.kast != null) p.kast_w += r.kast * rounds;
      if (r.adr != null) p.adr_w += r.adr * rounds;
      if (r.pr != null) { p.pr_w += r.pr; p.pr_n++; }
      const M = p.maps[g.map] = p.maps[g.map] || { n: 0, rounds: 0, k: 0, d: 0, kast_w: 0, adr_w: 0, win: 0 };
      M.n++; M.rounds += rounds; M.k += r.k; M.d += r.d; M.win += r.win;
      if (r.kast != null) M.kast_w += r.kast * rounds;
      if (r.adr != null) M.adr_w += r.adr * rounds;
    }
  }
  // features por ronda de los cualificados → media y desviación de la población
  const qual = Object.values(P).filter((p) => p.rounds >= MIN_ROUNDS);
  const feats = qual.map((p) => ({ slug: p.slug,
    kpr: p.k / p.rounds, dpr: p.d / p.rounds, adr: p.adr_w / p.rounds, kast: p.kast_w / p.rounds,
    open: (p.fk - p.fd) / p.rounds }));
  const stat = (key) => {
    const xs = feats.map((f) => f[key]);
    const mu = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (xs.length || 1)) || 1;
    return { mu, sd };
  };
  const S = { kpr: stat('kpr'), dpr: stat('dpr'), adr: stat('adr'), kast: stat('kast'), open: stat('open') };
  const z = (v, s) => (v - s.mu) / s.sd;
  const out = {};
  for (const f of feats) {
    const p = P[f.slug];
    const zc = 0.30 * z(f.adr, S.adr) + 0.25 * z(f.kast, S.kast) + 0.20 * z(f.kpr, S.kpr)
      - 0.15 * z(f.dpr, S.dpr) + 0.10 * z(f.open, S.open);
    const rating = Math.max(0.60, Math.min(1.60, 1 + 0.15 * zc));
    const maps = {};
    for (const [mk, M] of Object.entries(p.maps)) {
      if (M.n < MIN_MAP_N) continue;
      maps[mk] = { n: M.n, wr: +(M.win / M.n).toFixed(3), kpr: +(M.k / M.rounds).toFixed(3),
        dpr: +(M.d / M.rounds).toFixed(3), adr: +(M.adr_w / M.rounds).toFixed(1), kast: +(M.kast_w / M.rounds).toFixed(3) };
    }
    out[f.slug] = {
      slug: f.slug, pid: p.pid, nick: p.nick,
      rating_gp: +rating.toFixed(3),
      n: p.n, rounds: p.rounds, wr: +(p.win / p.n).toFixed(3),
      kpr: +f.kpr.toFixed(3), dpr: +f.dpr.toFixed(3), apr: +(p.a / p.rounds).toFixed(3),
      adr: +f.adr.toFixed(1), kast: +f.kast.toFixed(3), open_pr: +f.open.toFixed(4),
      fk: p.fk, fd: p.fd, clutches: p.cl, multi3plus: p.m3,
      hs_pct: p.k ? +(p.hs / p.k).toFixed(3) : null,
      provider_rating_avg: p.pr_n ? +(p.pr_w / p.pr_n).toFixed(3) : null,
      maps,
      recent: (p.recent || []).slice().reverse(),
    };
  }
  wrAgg('player-map-stats.json', {
    at: new Date().toISOString(), window_days: WINDOW_DAYS, min_rounds: MIN_ROUNDS, min_map_n: MIN_MAP_N,
    players: out, n: Object.keys(out).length, population: qual.length,
    formula: 'z = 0.30·adr + 0.25·kast + 0.20·kpr − 0.15·dpr + 0.10·open(fk−fd por ronda); rating_gp = 1 + 0.15·z, acotado [0.60, 1.60]. Media del circuito = 1.00 por construcción. Población: jugadores con ≥' + MIN_ROUNDS + ' rondas en la ventana.',
    note: 'RATING PROPIO DE GP, derivado del scoreboard real por mapa. El del proveedor se conserva al lado (provider_rating_avg, escala 0-10) — dos varas con procedencia clara.',
  });
  log(`▸ agregado: ${Object.keys(out).length} jugadores cualificados (≥${MIN_ROUNDS} rondas) de ${Object.keys(P).length} vistos`);
}

(async () => {
  const t0 = Date.now();
  let store;
  if (ARG['aggregate-only']) { store = rdRaw('player-games.json') || {}; log('▸ solo agregados (sin red)'); }
  else store = await harvest();
  aggregate(store);
  log(`▸ listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
