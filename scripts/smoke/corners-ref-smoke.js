#!/usr/bin/env node
'use strict';
// scripts/smoke/corners-ref-smoke.js — humo de la capa CÓRNERS × ÁRBITRO (3-sep-2026). Sin red, sin servidor.
//   1) efecto encogido: n=0 → 0; n grande → media del árbitro − 1; K=0 → media cruda; clamp.
//   2) índice: dedup por clave, cocientes contra la media de liga del momento, nombres normalizados.
//   3) proyección: con la variable APAGADA la proyección es byte-idéntica (mismo objeto; JSON igual) y con la
//      variable ENCENDIDA solo cambia corners.total (tarjetas y córners por equipo intactos; sin mutar la original).
//   4) server.js: la lectura del flag (misma función, extraída del fuente) y que applyToProjection solo se
//      llama bajo cornersRefOn(); CARDS no lleva campos de árbitro.
// Uso: node scripts/smoke/corners-ref-smoke.js   (código de salida 0 = todo bien)

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const REF = require(path.join(ROOT, 'clubs-engine', 'referees'));
const PE = require(path.join(ROOT, 'prop-engine', 'model'));

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('  FALLA  ' + msg); } else console.log('  ok     ' + msg); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('1) efecto encogido');
{
  ok(REF.shrunkMult(0, 0, 400) === 1, 'n=0 → multiplicador 1 (efecto 0)');
  const idx = REF.emptyIndex();
  const e0 = REF.effectFor(idx, 'M Oliver');
  ok(e0.n === 0 && e0.mult === 1 && e0.effect === 0, 'árbitro desconocido → n=0, effect=0');
  ok(REF.effectFor(idx, null).effect === 0 && REF.effectFor(idx, '').effect === 0, 'sin nombre → effect=0');
  // n grande → media del árbitro: 5000 partidos con cociente 1,10
  for (let i = 0; i < 5000; i++) REF.addMatch(idx, { referee: 'M Oliver', total: 11, leagueMean: 10, league: 'x' });
  const eBig = REF.effectFor(idx, 'M Oliver', { REF_PRIOR: 400, REF_CLAMP: 0 });
  ok(near(eBig.mean_ratio, 1.1, 1e-9), `media de cocientes = 1,10 (${eBig.mean_ratio.toFixed(4)})`);
  ok(near(eBig.mult, (400 + 5500) / (400 + 5000)) && Math.abs(eBig.effect - 0.1) < 0.008, `n=5000, K=400 → mult ${eBig.mult.toFixed(4)} ≈ media del árbitro (0,10 de efecto)`);
  ok(near(REF.shrunkMult(5500, 5000, 0), 1.1), 'K=0 → media cruda');
  ok(near(REF.shrunkMult(11, 10, 400) - 1, (400 + 11) / 410 - 1), 'n=10, K=400: (K+Σr)/(K+n)');
  ok(near(REF.shrunkMult(11, 10, 400), 1.0024390243902439), 'n=10, cociente 1,10 → mult 1,0024 (encogido casi del todo)');
  const eCl = REF.effectFor(idx, 'M Oliver', { REF_PRIOR: 0, REF_CLAMP: 0.05 });
  ok(near(eCl.mult, 1.05), `clamp ±5 %: media 1,10 → mult ${eCl.mult}`);
  ok(REF.DEFAULTS.REF_PRIOR === 400 && REF.DEFAULTS.REF_CLAMP === 0.05, 'DEFAULTS: K=400, clamp 0,05 (los del backtest)');
  ok(REF.effectFor(idx, 'm. óliver ').n === 5000, 'nombre normalizado (mayúsculas, acentos, puntuación, espacios)');
}

console.log('2) índice');
{
  const idx = REF.emptyIndex();
  ok(REF.addMatch(idx, { referee: 'A Taylor', total: 12, leagueMean: 10, league: 'premier', date: '2026-08-20', key: 'k1' }), 'alta con clave');
  ok(!REF.addMatch(idx, { referee: 'A Taylor', total: 12, leagueMean: 10, league: 'premier', date: '2026-08-20', key: 'k1' }), 'misma clave → dedup');
  ok(REF.addMatch(idx, { referee: 'A Taylor', total: 8, leagueMean: 8, league: 'championship', date: '2026-08-27', key: 'k2' }), 'otra liga, otra media');
  const r = idx.refs[REF.normalizeName('A Taylor')];
  ok(r.n === 2 && near(r.sum_ratio, 1.2 + 1.0) && r.sum_total === 20 && r.last === '2026-08-27' && r.leagues.premier === 1 && r.leagues.championship === 1, 'cocientes contra la media de liga del momento; ligas y última fecha');
  ok(!REF.addMatch(idx, { referee: null, total: 9, leagueMean: 10 }) && !REF.addMatch(idx, { referee: 'X', total: null, leagueMean: 10 }) && !REF.addMatch(idx, { referee: 'X', total: 9, leagueMean: 0 }), 'sin árbitro / sin total / sin media → no entra');
  ok(idx.matches === 2, 'contador de partidos');
  const tmp = path.join(require('os').tmpdir(), 'gp-referees-smoke-' + process.pid + '.json');
  ok(REF.saveIndex(tmp, idx) && REF.loadIndex(tmp).refs[REF.normalizeName('A Taylor')].n === 2, 'guardar/cargar');
  try { fs.unlinkSync(tmp); } catch { /* */ }
  ok(REF.loadIndex('/no/existe.json').matches === 0, 'fichero ausente → índice vacío, sin lanzar');
}

console.log('3) proyección idéntica con la variable apagada');
{
  // fit sintético: 60 partidos, 6 equipos
  const teams = ['a', 'b', 'c', 'd', 'e', 'f'];
  const matches = []; let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < 60; i++) {
    const h = teams[i % 6], a = teams[(i * 5 + 1) % 6 === i % 6 ? (i + 1) % 6 : (i * 5 + 1) % 6];
    matches.push({ date: '2026-0' + (1 + (i % 8)) + '-10', referee: i % 3 ? 'R Uno' : 'R Dos', home: { code: h, corners: 3 + Math.floor(rnd() * 6), yellows: Math.floor(rnd() * 4), reds: 0 }, away: { code: a, corners: 2 + Math.floor(rnd() * 6), yellows: Math.floor(rnd() * 4), reds: 0 } });
  }
  const fit = PE.fit(matches, { TOTALS_DAMP: 0 });
  const base = PE.project(fit, { home: 'a', away: 'b', lambdas: { home: 1.6, away: 1.1 }, closeness1x2: { home: 0.5, draw: 0.25, away: 0.25 } });
  const baseJson = JSON.stringify(base);
  const idx = REF.emptyIndex();
  for (let i = 0; i < 200; i++) REF.addMatch(idx, { referee: 'R Uno', total: 12, leagueMean: 10 });
  const eff = REF.effectFor(idx, 'R Uno');           // mult > 1 (encogido y con clamp)
  const effNone = REF.effectFor(idx, 'Desconocido'); // mult 1
  // APAGADO: el servidor no llama a applyToProjection (guarda cornersRefOn()); y aunque lo llamara con un
  // árbitro desconocido, devuelve el MISMO objeto.
  ok(REF.applyToProjection(base, effNone) === base, 'árbitro desconocido (mult 1) → mismo objeto, ni una copia');
  ok(JSON.stringify(base) === baseJson, 'la proyección original no se muta');
  const on = REF.applyToProjection(base, eff);
  ok(on !== base && JSON.stringify(base) === baseJson, 'encendido: devuelve copia; la original sigue byte-idéntica');
  ok(near(on.corners.total, base.corners.total * eff.mult) && on.corners.ref_mult === eff.mult, `encendido: corners.total × ${eff.mult.toFixed(4)}`);
  ok(on.corners.home === base.corners.home && on.corners.away === base.corners.away && on.corners.r_total === base.corners.r_total, 'córners por equipo y dispersión intactos');
  ok(JSON.stringify(on.cards) === JSON.stringify(base.cards), 'tarjetas byte-idénticas (el árbitro de tarjetas sigue siendo el del prop-engine)');
  ok(eff.mult <= 1.05 && eff.mult > 1, `clamp de producción: mult ${eff.mult.toFixed(4)} ≤ 1,05`);
  // P(over) del total: sube con el multiplicador, no cambia sin él
  ok(PE.overProbNB(on.corners.total, on.corners.r_total, 9.5) > PE.overProbNB(base.corners.total, base.corners.r_total, 9.5), 'P(over 9,5) sube con el árbitro "de muchos córners"');
}

console.log('4) server.js: guarda del flag y anotación');
{
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = src.match(/function cornersRefOn\(\) \{[^\n]*\}/);
  ok(!!m, 'cornersRefOn existe en server.js');
  if (m) {
    const fn = new Function('process', m[0] + '; return cornersRefOn;')({ env: {} });
    const withEnv = (v) => new Function('process', m[0] + '; return cornersRefOn;')({ env: v === undefined ? {} : { GP_CORNERS_REF: v } })();
    ok(fn() === false && withEnv('') === false && withEnv('0') === false && withEnv('false') === false && withEnv('off') === false, 'sin variable / 0 / false / off → apagado');
    ok(withEnv('1') === true && withEnv('true') === true && withEnv('on') === true, '1 / true / on → encendido');
  }
  const calls = src.split('\n').filter((l) => /REFS\.applyToProjection\(/.test(l));
  ok(calls.length === 1 && /cornersRefOn\(\)/.test(calls[0]), 'applyToProjection se llama en UN sitio y bajo cornersRefOn()');
  ok(/ref_applied: false/.test(src) && /g\.family === 'CORNERS' && pm2\.ref_name !== undefined/.test(src), 'la anotación de la pick es solo para CORNERS');
  ok(/const refInfo = fam === 'corners_total' \? refCache2\[ceid\] : null/.test(src), 'cards_total no recibe campos de árbitro en propMarkets');
  ok(!/cards_under_v1[^\n]*ref_/.test(src), 'cards_under_v1 no se toca');
  const prov = fs.readFileSync(path.join(ROOT, 'data-providers', 'apiFootballProvider.js'), 'utf8');
  ok(/async function getFixtureReferee\(fixtureId\)/.test(prov) && /if \(!fixtureId \|\| !KEY\) return null;/.test(prov), 'getFixtureReferee: sin key → null');
}

console.log(`\n${n - fails}/${n} comprobaciones OK`);
process.exit(fails ? 1 : 0);
