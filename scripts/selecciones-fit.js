#!/usr/bin/env node
'use strict';
// scripts/selecciones-fit.js — el POOL de ratings de selecciones y los datos por competición (26-sep-2026).
//
// Lee data/selecciones/matches.json (scripts/selecciones-harvest.js) y escribe:
//   1. la liga `selecciones` en data/clubs/ratings.json: el pool con UN Elo por selección (ids tm_af<id>),
//      ajustado cronológicamente sobre todos los partidos de selecciones absolutas (K=30, doble K en los seis
//      primeros, factor de margen de eloratings, cancha neutral en torneos). NO toca `_meta.fitted_at`, porque
//      cambiarlo borra los overlays dinámicos de TODAS las ligas (clubEloReconcileFit).
//   2. props-history-<key>.json por competición (tarjetas, córners, faltas, árbitro por partido), con el shape
//      exacto de scripts/clubs-props-backfill.js, para que prop-engine tase tarjetas y córners de selecciones.
//   3. results-<key>.json por competición (goles), para el ajuste de goles y el contexto de descanso.
// Las ligas virtuales (uefanl, concacafnl, amistososel) se construyen en clubs-engine/cups.js copiando el pool.
//
//   node scripts/selecciones-fit.js [--write] [--outdir data/clubs]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WRITE = args.includes('--write');
const OUTDIR = path.resolve(ROOT, arg('--outdir', 'data/clubs'));
const SRC = path.resolve(ROOT, arg('--src', 'data/selecciones/matches.json'));

// competiciones → clave de liga virtual (las demás solo alimentan el pool)
const COMP_KEY = { 5: 'uefanl', 536: 'concacafnl', 10: 'amistososel' };
const TORNEO_NEUTRAL = new Set([1, 4, 9, 22, 6]);   // Mundial, Euro, Copa América, Copa Oro, Copa África: cancha neutral
const JUVENIL = /\bU-?\d{2}\b|\bU\d{2}\b|women|femen|\(w\)|\bW\b$/i;
const CLUB = /\b(fc|cf|sc|ac|afc|united|city|club|athletic|sporting|real|atletico|deportivo|dynamo|dinamo|rovers|wanderers|town|county|olympique|racing|inter|juventus|academy|reserves|xi|select|all[- ]stars)\b/i;

const db = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const all = Object.values(db.matches).filter((m) => ['FT', 'AET', 'PEN'].includes(m.status) && m.hg != null && m.ag != null)
  .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

// ── quiénes son selecciones absolutas ──────────────────────────────────────────────────────────────────
// Todo lo que juega una competición oficial de selecciones es selección. En amistosos (liga 10) API-Football
// mezcla juveniles y hasta clubes: entra solo si el nombre no es juvenil ni de club y si el rival ya es selección.
const seniors = new Set();
const nombre = {};
for (const m of all) { nombre[m.home_id] = m.home; nombre[m.away_id] = m.away; }
for (const m of all) if (m.league !== 10 && !JUVENIL.test(m.home) && !JUVENIL.test(m.away)) { seniors.add(m.home_id); seniors.add(m.away_id); }
for (let pasada = 0; pasada < 2; pasada++) {
  for (const m of all) {
    if (m.league !== 10) continue;
    for (const [id, n, rivalId] of [[m.home_id, m.home, m.away_id], [m.away_id, m.away, m.home_id]]) {
      if (seniors.has(id) || JUVENIL.test(n) || CLUB.test(n)) continue;
      if (seniors.has(rivalId)) seniors.add(id);
    }
  }
}
const esSenior = (m) => seniors.has(m.home_id) && seniors.has(m.away_id) && !JUVENIL.test(m.home) && !JUVENIL.test(m.away);
const partidos = all.filter(esSenior);

// ── Elo cronológico ────────────────────────────────────────────────────────────────────────────────────
const K = 30, BASE = 1500;
const winExp = (d) => 1 / (1 + Math.pow(10, -d / 400));
const margen = (d) => (d <= 1 ? 1 : d === 2 ? 1.5 : (11 + d) / 8);
function ajustar(hfa) {
  const elo = {}, games = {};
  let sumHome = 0, sumExp = 0, nHome = 0;
  for (const m of partidos) {
    const neutral = TORNEO_NEUTRAL.has(m.league);
    const h = m.home_id, a = m.away_id;
    const eh = elo[h] ?? BASE, ea = elo[a] ?? BASE;
    const exp = winExp(eh + (neutral ? 0 : hfa) - ea);
    const hg = m.ft_hg ?? m.hg, ag = m.ft_ag ?? m.ag;
    const s = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    if (!neutral) { sumHome += s; sumExp += exp; nHome++; }
    const kh = (games[h] || 0) < 6 ? 2 * K : K, ka = (games[a] || 0) < 6 ? 2 * K : K;
    const g = margen(Math.abs(hg - ag));
    elo[h] = eh + kh * g * (s - exp);
    elo[a] = ea + ka * g * ((1 - s) - (1 - exp));
    games[h] = (games[h] || 0) + 1; games[a] = (games[a] || 0) + 1;
  }
  return { elo, games, home_score_avg: nHome ? sumHome / nHome : null, expected_home_avg: nHome ? sumExp / nHome : null, n_home: nHome };
}
// hfa: el que iguala el promedio de puntos del local con el esperado (misma regla que clubs-engine/ratings.js)
let mejor = null;
for (let hfa = 0; hfa <= 200; hfa += 5) {
  const r = ajustar(hfa);
  const err = Math.abs(r.home_score_avg - r.expected_home_avg);
  if (!mejor || err < mejor.err) mejor = { hfa, err, r };
}
const HFA = mejor.hfa;
const fit = mejor.r;

// hfa por competición (para CLUB_CUPS): mismo criterio, con los Elo finales fijos
function hfaDe(league) {
  const ms = partidos.filter((m) => m.league === league);
  let best = null;
  for (let hfa = 0; hfa <= 200; hfa += 5) {
    let sH = 0, sE = 0, n = 0;
    for (const m of ms) { const hg = m.ft_hg ?? m.hg, ag = m.ft_ag ?? m.ag; sH += hg > ag ? 1 : hg < ag ? 0 : 0.5; sE += winExp((fit.elo[m.home_id] ?? BASE) + hfa - (fit.elo[m.away_id] ?? BASE)); n++; }
    const err = n ? Math.abs(sH / n - sE / n) : 1;
    if (!best || err < best.err) best = { hfa, err, n };
  }
  return best;
}

// ── salidas ───────────────────────────────────────────────────────────────────────────────────────────
const ratings = {};
for (const id of seniors) {
  if (!(id in fit.elo)) continue;
  ratings[`tm_af${id}`] = { elo: Math.round(fit.elo[id]), name: nombre[id], games: fit.games[id] || 0 };
}
const filaProps = (m) => {
  const s = m.stats || { home: {}, away: {} };
  const lado = (id, n, goals, st) => ({ code: `tm_af${id}`, name: n, goals, corners: st.corners ?? null, yellows: st.yc ?? null, reds: st.rc ?? null, fouls: st.fouls ?? null, shots: st.shots ?? null, shots_on: st.sot ?? null, possession: st.poss ?? null, xg: st.xg ?? null });
  return { fixture_id: +m.id, date: m.date, round: m.round || null, referee: m.referee || null, status: m.status, et: m.status !== 'FT',
    home: lado(m.home_id, m.home, m.ft_hg ?? m.hg, s.home || {}), away: lado(m.away_id, m.away, m.ft_ag ?? m.ag, s.away || {}) };
};
const salidas = {};
for (const [lg, key] of Object.entries(COMP_KEY)) {
  const ms = partidos.filter((m) => m.league === +lg);
  const conStats = ms.filter((m) => m.stats && !m.stats.vacio && m.stats.home && m.stats.home.yc != null);
  salidas[key] = {
    props: { league: key, af_league: +lg, season: 2026, done: Object.fromEntries(conStats.map((m) => [m.id, 1])), matches: conStats.map(filaProps) },
    results: { league: key, rows: ms.map((m) => ({ id: `af${m.id}`, date: m.date, home_id: `tm_af${m.home_id}`, away_id: `tm_af${m.away_id}`, hg: m.ft_hg ?? m.hg, ag: m.ft_ag ?? m.ag, winner: (m.ft_hg ?? m.hg) > (m.ft_ag ?? m.ag) ? `tm_af${m.home_id}` : (m.ft_ag ?? m.ag) > (m.ft_hg ?? m.hg) ? `tm_af${m.away_id}` : null, src: 'af' })) },
    hfa: hfaDe(+lg),
    n: ms.length, con_stats: conStats.length,
    tarjetas_media: conStats.length ? +(conStats.reduce((a, m) => a + (m.stats.home.yc || 0) + (m.stats.away.yc || 0) + 2 * ((m.stats.home.rc || 0) + (m.stats.away.rc || 0)), 0) / conStats.length).toFixed(2) : null,
    corners_media: conStats.length ? +(conStats.reduce((a, m) => a + (m.stats.home.corners || 0) + (m.stats.away.corners || 0), 0) / conStats.length).toFixed(2) : null,
  };
}

// ── LAS PUERTAS DE LA CASA (clubs-gate-1 y clubs-goals-gate-1), con el MISMO backtest walk-forward que
// cualquier liga de clubes. Sin `backtest.status = 'approved'` el motor no crea picks 1X2, y sin
// `goals_backtest.status = 'approved'` no crea picks de goles: la disciplina es la misma para selecciones.
// Se mide sobre el pool entero y por competición; cada liga virtual usa la suya si llega a 120 partidos y,
// si no, la del pool (comparten Elo, así que el pool es su backtest natural).
const { backtest, goalsBacktest } = require('../clubs-engine/ratings');
const { matchProbs } = require('../engine');
const fila = (m) => ({ utc: m.date, home: { id: `tm_af${m.home_id}`, goals: m.ft_hg ?? m.hg }, away: { id: `tm_af${m.away_id}`, goals: m.ft_ag ?? m.ag } });
const puertas = (ms) => {
  let bt = null, gbt = null;
  try { bt = backtest(ms.map(fila), { probs: matchProbs }); } catch (e) { bt = { status: 'shadow', error: e.message }; }
  try { gbt = goalsBacktest(ms.map(fila)); } catch (e) { gbt = { status: 'shadow', error: e.message }; }
  return { backtest: bt, goals_backtest: gbt };
};
const puertasPool = puertas(partidos);
const porCompeticion = {};
for (const [lg, key] of Object.entries(COMP_KEY)) {
  const ms = partidos.filter((m) => m.league === +lg);
  // la puerta propia solo si el walk-forward de la competición llega a los 120 partidos calentados que exige
  // la política; si no, la del pool, que es donde de verdad se calientan los Elo de estas selecciones
  let propia = ms.length >= 120 ? puertas(ms) : null;
  if (propia && !(propia.backtest && propia.backtest.n >= 120)) propia = null;
  porCompeticion[key] = { n: ms.length, hfa: salidas[key].hfa.hfa, fuente: propia ? 'competicion' : 'pool',
    backtest: propia ? propia.backtest : puertasPool.backtest, goals_backtest: propia ? propia.goals_backtest : puertasPool.goals_backtest };
}
const resumenPuerta = (p) => ({ status: p.backtest.status, n: p.backtest.n, brier: p.backtest.brier, cal_err: p.backtest.cal_err, goals: p.goals_backtest.status, goals_n: p.goals_backtest.n, goals_skill: p.goals_backtest.over25 && p.goals_backtest.over25.skill, goals_cal: p.goals_backtest.over25 && p.goals_backtest.over25.cal_err });
console.log(JSON.stringify({ puertas_pool: resumenPuerta(puertasPool), por_competicion: Object.fromEntries(Object.entries(porCompeticion).map(([k, v]) => [k, { fuente: v.fuente, n: v.n, ...resumenPuerta(v) }])) }, null, 1));

const top = Object.entries(ratings).sort((a, b) => b[1].elo - a[1].elo).slice(0, 15).map(([id, r]) => `${r.name} ${r.elo} (${r.games})`);
console.log(JSON.stringify({ partidos_total: all.length, partidos_selecciones: partidos.length, selecciones: Object.keys(ratings).length, hfa_pool: HFA,
  home_score_avg: +fit.home_score_avg.toFixed(3), expected_home_avg: +fit.expected_home_avg.toFixed(3), top15: top,
  por_competicion: Object.fromEntries(Object.entries(salidas).map(([k, v]) => [k, { n: v.n, con_stats: v.con_stats, hfa: v.hfa, tarjetas_media: v.tarjetas_media, corners_media: v.corners_media }])) }, null, 1));

if (WRITE) {
  const rp = path.join(ROOT, 'data', 'clubs', 'ratings.json');
  const RT = JSON.parse(fs.readFileSync(rp, 'utf8'));
  const prev = RT.leagues.selecciones || {};
  RT.leagues.selecciones = {
    key: 'selecciones', name: 'Selecciones (pool)', country: 'Internacional', comp: null, season: null,
    ratings_from: [...new Set(partidos.map((m) => `af_${m.league}_${m.season}`))], fit_src: 'api-football', af_league: null, odds_key: null,
    pool: true, hidden: true, hfa: HFA, n_matches: partidos.length, home_score_avg: +fit.home_score_avg.toFixed(3), expected_home_avg: +fit.expected_home_avg.toFixed(3),
    backtest: puertasPool.backtest, goals_backtest: puertasPool.goals_backtest, por_competicion: porCompeticion,
    fitted_at: new Date().toISOString(), engine: 'selecciones-elo-1.0.0', standings: prev.standings || [],
    ratings,
  };
  fs.writeFileSync(rp, JSON.stringify(RT, null, 0));
  fs.mkdirSync(OUTDIR, { recursive: true });
  for (const [key, v] of Object.entries(salidas)) {
    fs.writeFileSync(path.join(OUTDIR, `props-history-${key}.json`), JSON.stringify(v.props));
    fs.writeFileSync(path.join(OUTDIR, `results-${key}.json`), JSON.stringify(v.results));
  }
  console.log('escrito:', rp, 'y', Object.keys(salidas).map((k) => `props-history-${k}.json / results-${k}.json`).join(', '), 'en', OUTDIR);
}
