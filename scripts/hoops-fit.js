#!/usr/bin/env node
// scripts/hoops-fit.js — AJUSTE FUERA DE LÍNEA DE LA PILA (16-ago).
//
// POR QUÉ EXISTE. Las tres capas caras del modelo —RAPM sobre tramos, coeficientes de contexto y el peso de
// mezcla con el mercado— se ajustaban dentro de `store.load()`, es decir, dentro de la primera petición que
// tocaba la caché. Medido: 4,5 s de RAPM + 1,0 s de mezcla = 5,7 s de CPU BLOQUEANTE cada 30 minutos. En un
// proceso Node de un solo hilo eso no ralentiza baloncesto: congela el sitio entero, Mundial incluido.
//
// LA REGLA. Un ajuste se hace UNA vez, se versiona y se sirve. Igual que los ratings de clubes o los
// veredictos de validación: el servidor LEE un artefacto, no lo entrena. Beneficios además de la latencia:
//   · reproducible — el artefacto dice con cuántos partidos y cuándo se ajustó;
//   · auditable — se puede diffear un fit contra el anterior antes de desplegarlo;
//   · seguro — un fallo del ajuste no puede tumbar una petición de usuario.
//
// Uso:  node scripts/hoops-fit.js [nba] [wnba] ...     (sin argumentos: todas las ligas con datos)
// Sale: data/basketball/fit-<liga>.json
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../basketball-engine/ratings');
const S = require('../basketball-engine/simulate');
const LU = require('../basketball-engine/lineups');
const PLY = require('../basketball-engine/players');
const CX = require('../basketball-engine/context');
const MD = require('../basketball-engine/model');

// BASE DEL REPO + OVERLAY DEL DISCO, igual que el motor (4-sep-2026). Si el ajuste solo mirara el repo,
// re-ajustaría ignorando justo los partidos recién cosechados — el artefacto quedaría viejo el mismo día en
// que se actualizan los datos, que es la peor forma de estar desactualizado: la que no se nota.
const REPO_DIR = path.join(__dirname, '..', 'data', 'basketball');
const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'hoops');
const DIR = process.env.GP_HOOPS_OUT === 'disk' ? DISK_DIR : REPO_DIR;   // dónde se ESCRIBE el artefacto
const rdIn = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const rd = (f) => rdIn(DISK_DIR, f) || rdIn(REPO_DIR, f);
const listar = (dir, pref) => { try { return fs.readdirSync(dir).filter((f) => f.startsWith(pref)); } catch { return []; } };

function leaguesOnDisk() {
  const set = new Set();
  for (const dir of [REPO_DIR, DISK_DIR]) {
    for (const f of listar(dir, 'games-')) { const m = f.match(/^games-([a-z0-9]+)-\d+\.json$/); if (m) set.add(m[1]); }
  }
  return [...set];
}

function loadGames(league) {
  const porId = new Map();
  for (const dir of [REPO_DIR, DISK_DIR]) {
    for (const f of listar(dir, `games-${league}-`)) {
      const st = rdIn(dir, f);
      for (const [k, g] of Object.entries((st && st.games) || {})) if (g) porId.set(String(g.id != null ? g.id : k), g);
    }
  }
  return [...porId.values()];
}

function fitLeague(league) {
  const t0 = Date.now();
  const games = loadGames(league);
  if (!games.length) return { league, error: 'sin partidos en disco' };
  const teams = {}; const tl = rd(`teams-${league}.json`); for (const t of ((tl && tl.teams) || [])) teams[t.id] = t;
  const validTeams = Object.keys(teams).length ? Object.keys(teams) : null;
  const fit = R.fitRatings(games, { validTeams });

  // 1) RAPM sobre tramos (sin garbage time). Es la capa cara: conjugate gradient + CV temporal de lambda.
  const withStints = games.filter((g) => g.stints && g.stints.length).map((g) => ({ ...g, stints: LU.unpackStints(g.stints) }));
  const rapm = withStints.length >= 40 ? PLY.fitRAPM(withStints, { halfLifeDays: 240, dropGarbage: true }) : null;

  // 2) Contexto de calendario sobre los residuos del propio rating.
  const sched = CX.scheduleState(games);
  const expMargin = fit ? (g) => {
    if (!fit.off[g.home.id] || !fit.off[g.away.id]) return null;
    const poss = fit.lgPace + (fit.pace[g.home.id] || 0) + (fit.pace[g.away.id] || 0);
    return (((fit.off[g.home.id] - fit.def[g.away.id]) - (fit.off[g.away.id] - fit.def[g.home.id])) + fit.hca) * poss / 100;
  } : null;
  const ctx = expMargin ? CX.fitContext(games, sched, expMargin) : null;

  // 3) Peso de mezcla con el mercado, con VALIDACIÓN ANIDADA: el rating que genera las probabilidades del
  // modelo se ajusta con el 70% más antiguo y el peso se estima sobre el 30% que ese rating no vio. Con el
  // rating completo el peso salía 1 por construcción — el modelo ya conocía los resultados que se le pedía
  // predecir. Es el error que más infla un backtest y el más fácil de cometer sin darse cuenta.
  const imp = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
  const ordered = games.filter((g) => g.home.pts != null && g.away.pts != null)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const innerCut = Math.floor(ordered.length * 0.7);
  const fitInner = fit && innerCut > 60 ? R.fitRatings(ordered.slice(0, innerCut), { validTeams }) : null;
  const rows = [];
  if (fitInner) {
    for (const g of ordered.slice(innerCut)) {
      if (!fitInner.off[g.home.id] || !fitInner.off[g.away.id]) continue;
      const o = (g.odds || [])[0];
      if (!o || o.hml == null || o.aml == null) continue;
      const ih = imp(o.hml), ia = imp(o.aml);
      const sim = S.simulate(fitInner, g.home.id, g.away.id, { n: 2000, seed: 31, neutral: !!g.neutral });
      if (!sim) continue;
      rows.push({ p_model: sim.win.home, p_market: ih / (ih + ia), won: g.home.pts > g.away.pts ? 1 : 0 });
    }
  }
  const blend = MD.fitBlend(rows);

  // 4) INTELIGENCIA DERIVADA DE LIGA: valor por zona de tiro (la base del eFG esperado) y los ajustes por
  // rival de cada four factor. Son deterministas y cuestan ~200 ms en NBA: exactamente el tipo de cálculo
  // que pertenece al artefacto y no a la petición de un usuario.
  const ADV = require('../basketball-engine/advanced');
  const zone = ADV.zoneBaseline(games);
  const adjust = ADV.leagueAdjustments(games);

  return {
    league,
    at: new Date().toISOString(),
    games_n: games.length,
    stint_games: withStints.length,
    stint_coverage: games.length ? +(withStints.length / games.length).toFixed(3) : 0,
    ms: Date.now() - t0,
    rapm, ctx, blend, zone, adjust,
  };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const leagues = args.length ? args : leaguesOnDisk();
  if (!leagues.length) { console.log('[hoops-fit] no hay ligas con datos en', DIR); return; }
  for (const lg of leagues) {
    try {
      const out = fitLeague(lg);
      if (out.error) { console.log(`[hoops-fit] ${lg}: ${out.error}`); continue; }
      fs.writeFileSync(path.join(DIR, `fit-${lg}.json`), JSON.stringify(out));
      console.log(`[hoops-fit] ${lg}: ${out.games_n} partidos · tramos ${(out.stint_coverage * 100).toFixed(1)}% · ` +
        `rapm ${out.rapm ? out.rapm.n_players + ' jugadores λ=' + out.rapm.lambda : 'no'} · ` +
        `contexto ${out.ctx && out.ctx.ok ? 'ok' : 'no'} · mezcla w=${out.blend && out.blend.ok ? out.blend.w : 'n/d'} (n=${out.blend ? out.blend.n : 0}) · ${out.ms} ms`);
    } catch (e) {
      console.error(`[hoops-fit] ${lg} falló:`, e.message);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) main();
module.exports = { fitLeague };
