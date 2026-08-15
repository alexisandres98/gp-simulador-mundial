#!/usr/bin/env node
/**
 * BALONCESTO — COSECHA HISTÓRICA (15-ago). El equivalente de combat-backfill.js para el 4º deporte.
 *
 * QUÉ HACE: baja el calendario de una temporada (scoreboard por quincenas) y, por cada partido terminado,
 * pide el summary y lo pasa por basketball-engine/possessions → guarda el DERIVADO compacto.
 *
 * POR QUÉ DERIVADO Y NO CRUDO: el summary de un partido pesa ~1MB (450 jugadas con todo su envoltorio) y una
 * temporada de NBA son 1.239 partidos → 1,2GB que no tiene sentido versionar. El derivado son ~19KB por
 * partido (four factors, tiros con zona, líneas de jugador, garbage time) → ~25MB por temporada, y contiene
 * TODO lo que el modelo y los paneles necesitan. El crudo se puede volver a pedir cuando haga falta.
 *
 * IDEMPOTENTE: relee lo ya cosechado y solo pide los partidos que faltan. Se puede cortar y retomar.
 *
 * Uso:
 *   node scripts/hoops-backfill.js --league=nba --season=2026
 *   node scripts/hoops-backfill.js --league=wnba --season=2026 --max=200
 *   node scripts/hoops-backfill.js --league=nba --season=2026 --schedule-only   (solo calendario, sin summaries)
 *
 * Salida: data/basketball/games-<liga>-<temporada>.json · teams-<liga>.json · players-<liga>.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../data-providers/basketball/espn');
const P = require('../basketball-engine/possessions');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const LEAGUE = String(args.league || 'nba');
const SEASON = +args.season || new Date().getUTCFullYear();
const MAX = +args.max || 0;
const SLEEP = +args.sleep || 130;
const DIR = path.join(__dirname, '..', 'data', 'basketball');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const L = E.LEAGUES[LEAGUE];
if (!L) { console.error('liga desconocida:', LEAGUE, '· disponibles:', Object.keys(E.LEAGUES).join(', ')); process.exit(1); }

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, f), JSON.stringify(o)); };

(async () => {
  const gFile = `games-${LEAGUE}-${SEASON}.json`;
  const store = rd(gFile) || { league: LEAGUE, season: SEASON, at: null, games: {} };

  // ---- 1) equipos y plantillas (baratos, una vez por corrida) ----
  console.log(`[${LEAGUE} ${SEASON}] equipos…`);
  const teams = await E.teams(LEAGUE);
  if (teams.length) wr(`teams-${LEAGUE}.json`, { at: new Date().toISOString(), teams });
  console.log(`  ${teams.length} equipos`);

  if (!args['schedule-only'] || args.rosters) {
    const players = [];
    for (const t of teams) {
      const r = await E.roster(LEAGUE, t.id).catch(() => []);
      players.push(...r);
      await sleep(90);
    }
    if (players.length) wr(`players-${LEAGUE}.json`, { at: new Date().toISOString(), players });
    console.log(`  ${players.length} jugadores en plantilla`);
  }

  // ---- 2) calendario de la temporada ----
  console.log(`[${LEAGUE} ${SEASON}] calendario…`);
  const sched = await E.season(LEAGUE, SEASON);
  const done = sched.filter(g => g.completed);
  console.log(`  ${sched.length} partidos · ${done.length} terminados · ${Object.keys(store.games).length} ya cosechados`);
  if (args['schedule-only']) {
    store.schedule = sched.map(g => ({ id: g.id, date: g.date, h: g.home.id, a: g.away.id, done: g.completed }));
    store.at = new Date().toISOString(); wr(gFile, store);
    console.log('  (solo calendario) guardado.'); return;
  }

  // ---- 3) summaries de los que faltan ----
  const pend = done.filter(g => !store.games[g.id]);
  const todo = MAX ? pend.slice(0, MAX) : pend;
  console.log(`  faltan ${pend.length}${MAX ? ` (se piden ${todo.length})` : ''}`);
  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const g = todo[i];
    try {
      const s = await E.summary(LEAGUE, g.id);
      const d = s ? P.deriveGame(g, s, L) : null;
      if (d) { store.games[g.id] = d; ok++; } else fail++;
    } catch { fail++; }
    if ((i + 1) % 25 === 0 || i === todo.length - 1) {
      store.at = new Date().toISOString(); wr(gFile, store);   // guardado incremental: cortar no pierde nada
      const kb = Math.round(fs.statSync(path.join(DIR, gFile)).size / 1024);
      console.log(`  ${i + 1}/${todo.length} · ok ${ok} · fallos ${fail} · archivo ${kb}KB`);
    }
    await sleep(SLEEP);
  }
  store.at = new Date().toISOString(); wr(gFile, store);
  console.log(`[${LEAGUE} ${SEASON}] listo: ${Object.keys(store.games).length} partidos derivados.`);
})().catch(e => { console.error('fallo:', e.message); process.exit(1); });
