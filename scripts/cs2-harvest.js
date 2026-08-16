// scripts/cs2-harvest.js — CONSTRUYE LA BASE HISTÓRICA PROPIA DE CS2 (16-ago).
//
// Esto es lo que separa a GP de un lector de cuotas. Baja el histórico real de partidos y de MAPAS, lo
// normaliza a la identidad de GP y deriva los agregados con los que el motor razona: fuerza por mapa de cada
// equipo, distribución real de rondas por mapa, tasa real de prórroga y Elo por mapa.
//
// ── LA DIVISIÓN CRUDO / AGREGADO, QUE NO ES UN DETALLE ───────────────────────────────────────────────────
// El crudo son ~90.000 mapas y ~25.000 partidos: 25 MB largos. Meterlos en git repetiría el error que ya
// costó builds de 17 minutos con los datos de clubes. Así que:
//   · CRUDO      → disco persistente (`<dir(DB_FILE)>/esports/cs2-raw/`). Sirve para re-derivar sin volver
//                  a pedirle nada al proveedor, que es la razón de guardarlo.
//   · AGREGADOS  → repo (`data/esports/cs2/`), unos pocos MB, versionados, y es lo que el motor lee en
//                  producción. Son NUESTRAS definiciones de features, no las del proveedor.
//
// Uso:
//   node scripts/cs2-harvest.js                      # incremental (desde la última cosecha)
//   node scripts/cs2-harvest.js --full               # todo el histórico disponible
//   node scripts/cs2-harvest.js --since=2024-01-01   # desde una fecha
//   node scripts/cs2-harvest.js --aggregate-only     # recalcula agregados desde el crudo, sin red
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
try { fs.mkdirSync(AGG_DIR, { recursive: true }); } catch { }

const rdRaw = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')); } catch { return null; } };
const wrRaw = (f, o) => fs.writeFileSync(path.join(RAW_DIR, f), JSON.stringify(o));
const wrAgg = (f, o) => fs.writeFileSync(path.join(AGG_DIR, f), JSON.stringify(o));
const log = (...a) => console.log(...a);

const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [s, true];
}));

// ── 1) COSECHA ───────────────────────────────────────────────────────────────────────────────────────────
async function harvest() {
  const prev = rdRaw('meta.json') || {};
  const full = !!ARG.full;
  const since = ARG.since || (full ? null : (prev.last_match_at ? String(prev.last_match_at).slice(0, 10) : null));
  log(`▸ cosecha ${full ? 'COMPLETA' : since ? 'incremental desde ' + since : 'inicial'}`);

  // EQUIPOS PRIMERO: hacen falta para resolver los nombres de clan de cada mapa a un id de GP.
  const teamsPrev = rdRaw('teams.json') || {};
  const teams = { ...teamsPrev };
  let tn = 0;
  await B3.teams({
    onPage: (rows) => {
      for (const t of rows) { const n = B3.normTeam(t); if (n && n.id) { teams[n.id] = n; tn++; } }
      return true;
    },
    log: (m) => log(m),
  });
  wrRaw('teams.json', teams);
  log(`  equipos: ${Object.keys(teams).length} (${tn} vistos)`);

  // PARTIDOS
  const mPrev = rdRaw('matches.json') || {};
  const matches = { ...mPrev };
  let mn = 0, lastAt = prev.last_match_at || null;
  await B3.matches({
    since, log: (m) => log(m),
    onPage: (rows) => {
      for (const m of rows) {
        const n = B3.normMatch(m);
        matches[n.provider_id] = n; mn++;
        if (!lastAt || String(n.at) > String(lastAt)) lastAt = n.at;
      }
      return true;
    },
  });
  wrRaw('matches.json', matches);
  log(`  partidos: ${Object.keys(matches).length} (${mn} nuevos/actualizados)`);

  // MAPAS — la unidad que de verdad importa
  const gPrev = rdRaw('games.json') || {};
  const games = { ...gPrev };
  let gn = 0;
  await B3.games({
    since, log: (m) => log(m),
    onPage: (rows) => { for (const g of rows) { const n = B3.normGame(g); games[n.provider_id] = n; gn++; } return true; },
  });
  wrRaw('games.json', games);
  log(`  mapas: ${Object.keys(games).length} (${gn} nuevos/actualizados)`);

  wrRaw('meta.json', { last_match_at: lastAt, at: new Date().toISOString(), matches: Object.keys(matches).length, games: Object.keys(games).length, teams: Object.keys(teams).length });
  return { teams, matches, games };
}

// ── 2) AGREGADOS: AQUÍ ES DONDE ESTO SE VUELVE DE GP ─────────────────────────────────────────────────────
// El proveedor da filas. Estas son NUESTRAS definiciones: qué es "fuerza en un mapa", cómo se encoge una
// muestra corta, qué cuenta como reciente y cómo se separa el mapa elegido del decisivo.

const HALF_LIFE_DAYS = 180;          // un partido de hace medio año pesa la mitad que uno de hoy
const PRIOR_MAPS = 12;               // encogimiento: con 3 mapas no hay "fuerza en Nuke", hay una anécdota
const TIER_W = { s: 1.0, a: 0.95, b: 0.8, c: 0.5, d: 0.35 };
const RECENT_DAYS = 100;             // ventana para deducir el pool activo y el ritmo del parche en curso
const MAP_EFFECT_PRIOR = 20;         // encogimiento del efecto de mapa (ajustado en la ventana interna
                                     // y confirmado en 2026 sin tocar: ver scripts/cs2-validate.js)
const C_eloExp = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

function decay(at, now) {
  const d = (now - Date.parse(at || 0)) / 864e5;
  if (!Number.isFinite(d) || d < 0) return 1;
  return Math.pow(0.5, d / HALF_LIFE_DAYS);
}
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// RESOLVER A QUÉ EQUIPO PERTENECE CADA MAPA es el paso que decide si la fuerza por mapa vale algo. El
// proveedor guarda en cada mapa el NOMBRE DEL CLAN dentro del juego, no el id del equipo, y ese nombre no
// coincide con el del equipo casi un tercio de las veces: "Gamdom Imperial" es "Imperial", "NAVI Junior" no
// es "Natus Vincere", y los patrocinadores entran y salen del tag cada temporada.
//
// Buscar ese nombre en un índice global de 8.359 equipos es a la vez frágil y peligroso: falla en un tercio
// de los casos y, cuando acierta por casualidad, le puede asignar el mapa al equipo equivocado — que es peor
// que perderlo. La solución correcta es no buscar en global: **el mapa pertenece a uno de los DOS equipos de
// su partido**, y eso lo sabe el propio partido. Así el problema pasa de "encontrar entre 8.359" a "elegir
// entre 2", que es un problema distinto y se resuelve casi siempre.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(esports?|gaming|team|club|cs2?|academy|junior)\b/g, '').replace(/[^a-z0-9]/g, '');

function pickSide(clanName, a, b) {
  const c = norm(clanName), na = norm(a && a.name), nb = norm(b && b.name);
  if (!c) return null;
  if (c === na) return 'a';
  if (c === nb) return 'b';
  // contención en cualquier dirección: cubre "Gamdom Imperial" ⊃ "Imperial" y "NAVI" ⊂ "Natus Vincere" no,
  // pero sí "FaZe" ⊂ "FaZe Clan". Se exige 3 caracteres para no casar por ruido.
  const hitA = na.length >= 3 && (c.includes(na) || na.includes(c));
  const hitB = nb.length >= 3 && (c.includes(nb) || nb.includes(c));
  if (hitA && !hitB) return 'a';
  if (hitB && !hitA) return 'b';
  return null;   // ambiguo: se descarta antes que adivinar
}

function aggregate({ teams, matches, games }) {
  const now = Date.now();
  // índice por id del proveedor: el partido guarda ids, y de ahí salen los dos candidatos de cada mapa
  const byProv = {};
  for (const t of Object.values(teams)) if (t.provider_id != null) byProv[t.provider_id] = t;
  // índice por nombre, que sigue sirviendo de último recurso
  const byName = {};
  for (const t of Object.values(teams)) {
    const k = norm(t.name); if (k) byName[k] = t.id;
  }
  const nameOf = (n) => byName[norm(n)] || null;

  const mapStats = {};        // mapa → distribución de rondas, prórroga, ventaja del que elige
  const teamMap = {};         // equipo → mapa → jugados/ganados/rondas
  const teamAll = {};         // equipo → acumulador GLOBAL (todos los mapas juntos)
  const elo = {};             // equipo → mapa → Elo por mapa (diagnóstico)
  const eloAll = {};          // equipo → Elo GLOBAL ← la columna vertebral del modelo validado
  const ELO0 = 1500, K = 26;
  let matched = 0, unmatched = 0;

  const rows = Object.values(games)
    .filter((g) => g.map && g.w_score != null && g.l_score != null)
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));   // cronológico: el Elo lo exige

  for (const g of rows) {
    const M = matches[g.match_id] || null;
    const tierW = TIER_W[(M && M.tier) || 'c'] || 0.5;

    // 1º: elegir entre los DOS equipos del partido (lo fiable). 2º: el índice global (último recurso).
    let w = null, l = null;
    if (M) {
      const A = byProv[M.t1], B = byProv[M.t2];
      const sw = pickSide(g.w_name, A, B);
      const sl = pickSide(g.l_name, A, B);
      if (sw && sl && sw !== sl) { w = (sw === 'a' ? A : B); l = (sl === 'a' ? A : B); }
      else if (sw && !sl) { w = (sw === 'a' ? A : B); l = (sw === 'a' ? B : A); }
      else if (sl && !sw) { l = (sl === 'a' ? A : B); w = (sl === 'a' ? B : A); }
      w = w && w.id; l = l && l.id;
    }
    if (!w || !l) { w = w || nameOf(g.w_name); l = l || nameOf(g.l_name); }
    if (!w || !l || w === l) { w = l = null; unmatched++; } else { matched++; }

    // --- distribución de rondas del mapa (nuestra base para el modelo de totales) ---
    const S = mapStats[g.map] = mapStats[g.map] || {
      map: g.map, n: 0, recent_n: 0, ot: 0, recent_ot: 0, recent_rounds_sum: 0, rounds_sum: 0, loser: {}, total: {},
      by_number: { 1: { n: 0, rounds_sum: 0 }, 2: { n: 0, rounds_sum: 0 }, 3: { n: 0, rounds_sum: 0 } },
      decider_n: 0, decider_rounds_sum: 0, blowout: 0,
    };
    const total = g.rounds != null ? g.rounds : (g.w_score + g.l_score);
    S.n++; S.ot += g.ot; S.rounds_sum += total;
    // LO RECIENTE SE CUENTA APARTE, y no es un adorno: el pool activo de Valve cambia, y deducirlo del
    // total histórico metía Overpass —fuera del pool desde hace meses— y dejaba fuera a Cache. Un tablero
    // de veto con el mapa equivocado lo detecta cualquiera que vea CS2, y con razón.
    if (now - Date.parse(g.at || 0) < RECENT_DAYS * 864e5) { S.recent_n++; S.recent_ot += g.ot; S.recent_rounds_sum += total; }
    S.loser[g.l_score] = (S.loser[g.l_score] || 0) + 1;
    S.total[total] = (S.total[total] || 0) + 1;
    if (g.l_score <= 4) S.blowout++;
    if (g.number && S.by_number[g.number]) { S.by_number[g.number].n++; S.by_number[g.number].rounds_sum += total; }
    // el mapa decisivo es el último de la serie: en un BO3 el 3º, en un BO5 el 5º
    if (M && M.bo && g.number === M.bo) { S.decider_n++; S.decider_rounds_sum += total; }

    if (!w || !l) continue;

    // --- fuerza por mapa de cada equipo, con decaimiento y peso por tier ---
    const wt = decay(g.at, now) * tierW;
    for (const [id, won, rf, ra] of [[w, 1, g.w_score, g.l_score], [l, 0, g.l_score, g.w_score]]) {
      const T = teamMap[id] = teamMap[id] || {};
      const E = T[g.map] = T[g.map] || { n: 0, w: 0, wn: 0, ww: 0, rf: 0, ra: 0, last: null };
      E.n++; E.w += won; E.wn += wt; E.ww += wt * won; E.rf += rf; E.ra += ra;
      if (!E.last || String(g.at) > String(E.last)) E.last = g.at;
      const G = teamAll[id] = teamAll[id] || { n: 0, w: 0, wn: 0, ww: 0, last: null };
      G.n++; G.w += won; G.wn += wt; G.ww += wt * won;
      if (!G.last || String(g.at) > String(G.last)) G.last = g.at;
    }

    // --- ELO ---
    // El Elo por mapa se conserva como DIAGNÓSTICO, no como motor. La validación walk-forward demostró que
    // predice peor que el global (3,04 % de skill frente a 6,88 %): partir el historial de un equipo en
    // siete mapas deja cada trozo con un séptimo de la muestra y el ruido se come la señal específica.
    const ew = elo[w] = elo[w] || {}, el = elo[l] = elo[l] || {};
    ew[g.map] = ew[g.map] != null ? ew[g.map] : ELO0;
    el[g.map] = el[g.map] != null ? el[g.map] : ELO0;
    // el margen de rondas informa: ganar 13-2 dice más que ganar 13-11
    const margin = Math.min(1.5, 1 + Math.log1p(Math.abs(g.w_score - g.l_score)) / 4);
    const k = K * tierW * margin;
    const expM = C_eloExp(ew[g.map], el[g.map]);
    ew[g.map] += k * (1 - expM); el[g.map] -= k * (1 - expM);
    // ELO GLOBAL: la columna vertebral del modelo validado.
    eloAll[w] = eloAll[w] != null ? eloAll[w] : ELO0;
    eloAll[l] = eloAll[l] != null ? eloAll[l] : ELO0;
    const expA = C_eloExp(eloAll[w], eloAll[l]);
    eloAll[w] += k * (1 - expA); eloAll[l] -= k * (1 - expA);
  }

  // --- cierre de los agregados de mapa ---
  const maps = {};
  for (const [k, S] of Object.entries(mapStats)) {
    const loserRows = Object.entries(S.loser).map(([r, n]) => ({ rounds: +r, p: r4(n / S.n), n }))
      .sort((a, b) => a.rounds - b.rounds);
    const totalRows = Object.entries(S.total).map(([r, n]) => ({ total: +r, p: r4(n / S.n), n }))
      .sort((a, b) => a.total - b.total);
    maps[k] = {
      map: k, n: S.n, recent_n: S.recent_n,
      in_pool: S.recent_n >= 60,                 // se juega de verdad ahora mismo
      mean_rounds: r2(S.rounds_sum / S.n),
      // con muestra reciente suficiente manda lo reciente: el parche cambia el ritmo de un mapa
      recent_mean_rounds: S.recent_n >= 120 ? r2(S.recent_rounds_sum / S.recent_n) : null,
      recent_overtime_p: S.recent_n >= 120 ? r4(S.recent_ot / S.recent_n) : null,
      overtime_p: r4(S.ot / S.n),
      blowout_p: r4(S.blowout / S.n),           // 13-4 o peor: cuánto se rompe este mapa
      loser_distribution: loserRows,
      total_distribution: totalRows,
      decider_mean_rounds: S.decider_n >= 30 ? r2(S.decider_rounds_sum / S.decider_n) : null,
      decider_n: S.decider_n,
      by_order: Object.fromEntries(Object.entries(S.by_number).filter(([, v]) => v.n >= 30)
        .map(([num, v]) => [num, { n: v.n, mean_rounds: r2(v.rounds_sum / v.n) }])),
    };
  }

  // --- FUERZA GLOBAL Y EFECTO DE MAPA (el modelo validado del blueprint 2.0, módulo 9) ---
  // El mapa deja de ser un rating independiente y pasa a ser una CORRECCIÓN sobre la fuerza global del
  // equipo, encogida por su propia muestra. La validación walk-forward lo zanjó: el jerárquico calibrado
  // da 7,28 % de skill de Brier sobre 2026 sin tocar, contra el 2,12 % del modelo anterior.
  const shrunk = (ww, wn, nn) => {
    const pbar = wn / Math.max(1, nn);
    const v = (ww + PRIOR_MAPS * 0.5 * pbar) / (wn + PRIOR_MAPS * pbar);
    return Number.isFinite(v) ? v : 0.5;
  };
  const teamGlobal = {};
  for (const [id, G] of Object.entries(teamAll)) {
    teamGlobal[id] = { n: G.n, wr: r3(shrunk(G.ww, G.wn, G.n)), elo: eloAll[id] != null ? r2(eloAll[id]) : null, last: G.last };
  }

  const teamMaps = {};
  for (const [id, byMap] of Object.entries(teamMap)) {
    const o = {};
    let tot = 0;
    const wrGlobal = teamGlobal[id] ? teamGlobal[id].wr : 0.5;
    for (const [m, E] of Object.entries(byMap)) {
      const wr = shrunk(E.ww, E.wn, E.n);
      o[m] = {
        n: E.n, w: E.w, raw_wr: r3(E.w / E.n), wr: r3(wr),
        // EFECTO DE MAPA: cuánto mejor o peor es este equipo en ESTE mapa que en su propio promedio,
        // encogido por la muestra del mapa. Con tres mapas en Nuke el efecto es casi cero; con cuarenta, suyo.
        effect: r3((wr - wrGlobal) * (E.n / (E.n + MAP_EFFECT_PRIOR))),
        rd: r2((E.rf - E.ra) / E.n),
        last: E.last, elo: elo[id] && elo[id][m] != null ? r2(elo[id][m]) : null,
      };
      tot += E.n;
    }
    if (tot >= 5) teamMaps[id] = { maps: o, n: tot, wr: wrGlobal, elo: teamGlobal[id] ? teamGlobal[id].elo : null };
  }

  return {
    maps, teamMaps, teamGlobal,
    coverage: { games: rows.length, matched, unmatched, teams: Object.keys(teamMaps).length, maps: Object.keys(maps).length },
  };
}

// ── 3) SALIDA ────────────────────────────────────────────────────────────────────────────────────────────
function writeAggregates(teams, agg) {
  // solo los equipos que aparecen en el histórico útil, con su logo — el resto son ruido de 8.000 filas
  const slim = {};
  for (const id of Object.keys(agg.teamMaps)) {
    const t = teams[id]; if (!t) continue;
    slim[id] = { id: t.id, name: t.name, logo: t.logo, icon: t.icon, rank: t.rank, country_id: t.country_id, n: agg.teamMaps[id].n };
  }
  wrAgg('teams.json', { teams: slim, at: new Date().toISOString(), n: Object.keys(slim).length });
  wrAgg('maps.json', { maps: agg.maps, at: new Date().toISOString() });
  wrAgg('team-maps.json', { teams: agg.teamMaps, at: new Date().toISOString() });
  wrAgg('team-global.json', { teams: agg.teamGlobal, at: new Date().toISOString() });
  wrAgg('meta.json', {
    at: new Date().toISOString(),
    source: 'bo3.gg (adaptador reemplazable; ver la nota de condiciones en data-providers/esports/bo3.js)',
    coverage: agg.coverage,
    definitions: {
      half_life_days: HALF_LIFE_DAYS, prior_maps: PRIOR_MAPS, tier_weights: TIER_W,
      map_effect_prior: MAP_EFFECT_PRIOR,
      model: 'jerárquico calibrado: Elo GLOBAL como columna vertebral + corrección por mapa encogida. Validado walk-forward sobre 14.297 mapas de 2026 no vistos: skill de Brier 7,28 %, AUC 0,652, ECE 0,008, pendiente de calibración 0,999.',
      note: 'el Elo POR MAPA se conserva como diagnóstico pero NO manda: la validación demostró que predice peor que el global (3,04 % contra 6,88 % de skill) porque parte la muestra del equipo en siete trozos y el ruido se come la señal.',
    },
  });
  const sizes = ['teams.json', 'maps.json', 'team-maps.json', 'team-global.json', 'meta.json']
    .map((f) => `${f} ${(fs.statSync(path.join(AGG_DIR, f)).size / 1024).toFixed(0)} KB`).join(' · ');
  log(`▸ agregados escritos en data/esports/cs2/: ${sizes}`);
}

(async () => {
  const t0 = Date.now();
  let data;
  if (ARG['aggregate-only']) {
    log('▸ solo agregados (sin red)');
    data = { teams: rdRaw('teams.json') || {}, matches: rdRaw('matches.json') || {}, games: rdRaw('games.json') || {} };
    if (!Object.keys(data.games).length) { log('  no hay crudo en ' + RAW_DIR); process.exit(1); }
  } else {
    data = await harvest();
  }
  log('▸ derivando agregados…');
  const agg = aggregate(data);
  log(`  ${agg.coverage.games} mapas · ${agg.coverage.matched} con los dos equipos resueltos · ${agg.coverage.unmatched} sin resolver`);
  log(`  ${agg.coverage.teams} equipos con fuerza por mapa · ${agg.coverage.maps} mapas distintos`);
  writeAggregates(data.teams, agg);
  log(`▸ listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · crudo en ${RAW_DIR}`);
})();
