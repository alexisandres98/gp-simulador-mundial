#!/usr/bin/env node
'use strict';
// scripts/selecciones-harvest.js — base propia de partidos de SELECCIONES desde API-Football (26-sep-2026).
//
// Para qué. El motor de clubes necesita, por equipo, goles a favor/en contra, tarjetas y córners recientes para
// tasar 1X2/goles/hándicap y, sobre todo, TARJETAS. Entre Mundial y Mundial no teníamos nada de selecciones.
// Esto baja los partidos jugados (con estadísticas por partido: amarillas, rojas, córners, faltas) de las
// competiciones de selecciones con cobertura de estadísticas en API-Football y los deja en un compacto.
//
//   API_FOOTBALL_KEY=… node scripts/selecciones-harvest.js [--out data/selecciones/matches.json] [--rps 4]
//
// Coste: 1 llamada por liga-temporada (calendario) + 1 por partido jugado (estadísticas). ~1.800 llamadas.
// Reanudable: si el compacto ya tiene estadísticas de un partido, no se vuelven a pedir.
const fs = require('fs');
const path = require('path');

const KEY = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
if (!KEY) { console.error('falta API_FOOTBALL_KEY'); process.exit(2); }
const HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = arg('--out', path.join(__dirname, '..', 'data', 'selecciones', 'matches.json'));
const RPS = +arg('--rps', 4);
const SOLO = arg('--solo', '');   // p.ej. "5:2026" para bajar solo una liga-temporada

// liga API-Football : temporadas. Solo competiciones con `statistics_fixtures` (comprobado el 26-sep).
const LIGAS = {
  1: { nombre: 'Mundial', seasons: [2026] },
  5: { nombre: 'UEFA Nations League', seasons: [2024, 2026] },
  4: { nombre: 'Eurocopa', seasons: [2024] },
  9: { nombre: 'Copa América', seasons: [2024] },
  22: { nombre: 'Copa Oro', seasons: [2025] },
  536: { nombre: 'CONCACAF Nations League', seasons: [2024, 2025] },
  32: { nombre: 'Eliminatorias Europa', seasons: [2024, 2025] },
  34: { nombre: 'Eliminatorias CONMEBOL', seasons: [2024, 2026] },
  31: { nombre: 'Eliminatorias CONCACAF', seasons: [2024, 2025, 2026] },
  30: { nombre: 'Eliminatorias Asia', seasons: [2024, 2026] },
  29: { nombre: 'Eliminatorias África', seasons: [2023] },
  6: { nombre: 'Copa África', seasons: [2025] },
  10: { nombre: 'Amistosos', seasons: [2024, 2025, 2026] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ultimo = 0;
async function api(pathq) {
  const gap = 1000 / RPS;
  const wait = ultimo + gap - Date.now(); if (wait > 0) await sleep(wait);
  ultimo = Date.now();
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://${HOST}/${pathq}`, { headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(15000); continue; }
      const j = await r.json();
      if (j.errors && Object.keys(j.errors).length) { console.error('api error', pathq, JSON.stringify(j.errors)); if (/request/i.test(JSON.stringify(j.errors))) await sleep(20000); else return null; continue; }
      return j.response || [];
    } catch (e) { await sleep(3000 * (i + 1)); }
  }
  return null;
}

function leer() { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return { built_at: null, matches: {} }; } }
function guardar(db) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); db.built_at = new Date().toISOString(); fs.writeFileSync(OUT, JSON.stringify(db)); }

const num = (v) => { if (v == null) return null; const n = Number(String(v).replace('%', '')); return Number.isFinite(n) ? n : null; };
function statsDe(arr) {
  const out = {};
  for (const s of arr || []) {
    const t = String(s.type || '');
    if (/yellow/i.test(t)) out.yc = num(s.value) || 0;
    else if (/red/i.test(t)) out.rc = num(s.value) || 0;
    else if (/corner/i.test(t)) out.corners = num(s.value) || 0;
    else if (/^fouls$/i.test(t)) out.fouls = num(s.value) || 0;
    else if (/total shots/i.test(t)) out.shots = num(s.value);
    else if (/shots on goal/i.test(t)) out.sot = num(s.value);
    else if (/ball possession/i.test(t)) out.poss = num(s.value);
    else if (/expected_goals|xg/i.test(t)) out.xg = num(s.value);
  }
  return out;
}

(async () => {
  const db = leer();
  db.matches = db.matches || {};
  let nuevos = 0, stats = 0;
  for (const [lg, cfg] of Object.entries(LIGAS)) {
    for (const season of cfg.seasons) {
      if (SOLO && SOLO !== `${lg}:${season}`) continue;
      const fx = await api(`fixtures?league=${lg}&season=${season}`);
      if (!fx) { console.error('sin calendario', lg, season); continue; }
      let ft = 0;
      for (const f of fx) {
        const st = f.fixture.status.short;
        const fin = ['FT', 'AET', 'PEN'].includes(st);
        const id = String(f.fixture.id);
        const prev = db.matches[id];
        const row = prev || { id, league: +lg, league_name: cfg.nombre, season, round: f.league.round, date: f.fixture.date, venue_country: f.fixture.venue && f.fixture.venue.city || null,
          home: f.teams.home.name, away: f.teams.away.name, home_id: f.teams.home.id, away_id: f.teams.away.id, neutral: false };
        row.status = st; row.hg = f.goals.home; row.ag = f.goals.away; row.ht_hg = f.score.halftime && f.score.halftime.home; row.ht_ag = f.score.halftime && f.score.halftime.away;
        row.ft_hg = f.score.fulltime && f.score.fulltime.home; row.ft_ag = f.score.fulltime && f.score.fulltime.away;
        if (!prev) nuevos++;
        db.matches[id] = row;
        if (fin) ft++;
        if (fin && !row.stats) {
          const s = await api(`fixtures/statistics?fixture=${id}`);
          if (s && s.length >= 2) {
            const h = s.find((x) => x.team.id === row.home_id) || s[0], a = s.find((x) => x.team.id === row.away_id) || s[1];
            row.stats = { home: statsDe(h.statistics), away: statsDe(a.statistics) };
            stats++;
            if (stats % 50 === 0) { guardar(db); console.error(`  … ${stats} estadísticas bajadas`); }
          } else if (s && s.length === 0) row.stats = { home: {}, away: {}, vacio: true };
        }
      }
      console.error(`${cfg.nombre} ${season}: ${fx.length} partidos, ${ft} jugados`);
      guardar(db);
    }
  }
  guardar(db);
  const total = Object.keys(db.matches).length, con = Object.values(db.matches).filter((m) => m.stats && !m.stats.vacio).length;
  console.log(JSON.stringify({ partidos: total, con_estadisticas: con, nuevos, stats_bajadas: stats, out: OUT }));
})();
