// darts-engine/modus.js — EL CIRCUITO MODUS COMO SEGUNDA AGENDA DE DARDOS (7-sep-2026).
//
// POR QUÉ. El calendario de la PDC tiene huecos de días enteros (del 7 al 10 de septiembre no hay un solo
// partido con cuadro definido), y Alexis pidió dardos "generando picks y acumulando data". La MODUS Super
// Series juega TODOS los días (15 partidos diarios en Portsmouth), Pinnacle y Cloudbet la cotizan, y
// Flashscore publica sus marcadores. Es el único circuito con volumen diario y mercado, así que entra como
// segunda agenda —con su propia etiqueta, para que nadie la confunda con el circuito PDC.
//
// LO QUE ES Y LO QUE NO ES. La PDC no la publica: los fixtures salen de los eventos de las casas (nombres
// completos), los jugadores se resuelven contra la base propia (muchos son Tour Card, Challenge Tour o
// ex-PDC; el que no resuelve queda sin modelo, no se inventa), el formato es fijo por reglamento (primero
// a 4 legs, sin empates: medido en Flashscore el 7-sep, todos los resultados son 4-x) y la liquidación es
// por el marcador de Flashscore. Sin estadística de partido: 180s y checkout no se liquidan aquí.
'use strict';

const D = require('./data');
const FLASH = require('../data-providers/darts/flashscore');

const ENABLED = () => !/^(0|false|no|off)$/i.test(String(process.env.GP_DARTS_MODUS == null ? 'true' : process.env.GP_DARTS_MODUS).trim());
const TOURNAMENT = 'MODUS Super Series';
const TID = 'modus';
const BEST_OF = 7;                       // primero a 4 legs
const isModus = (s) => /modus/i.test(String(s || ''));
const slug = (s) => D.norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Los eventos de las casas traen el mismo partido varias veces (una por casa); se funde por par de
// apellidos y día, y se prefiere el nombre más largo (Cloudbet trae el nombre completo).
function fixturesFromOdds(odds) {
  if (!ENABLED() || !odds || !Array.isArray(odds.events)) return [];
  const byKey = new Map();
  for (const e of odds.events) {
    if (!isModus(e.competition) || !e.a || !e.b || !e.start_at) continue;
    if (e.book === 'polymarket') continue;
    const day = String(e.start_at).slice(0, 10);
    const la = lastName(e.a), lb = lastName(e.b);
    if (!la || !lb) continue;
    const key = [la, lb].sort().join('~') + ':' + day;
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { a: e.a, b: e.b, start_at: e.start_at, books: new Set([e.book]) });
    else {
      if (String(e.a).length > String(cur.a).length && lastName(e.a) === lastName(cur.a)) { cur.a = e.a; }
      if (String(e.b).length > String(cur.b).length && lastName(e.b) === lastName(cur.b)) { cur.b = e.b; }
      cur.books.add(e.book);
      if (Date.parse(e.start_at) < Date.parse(cur.start_at)) cur.start_at = e.start_at;
    }
  }
  const out = [];
  for (const [key, f] of byKey) {
    const pa = resolve(f.a), pb = resolve(f.b);
    out.push({
      id: `modus:${slug(f.a)}~${slug(f.b)}:${String(f.start_at).slice(0, 10)}`,
      key,
      tournament_id: TID, tournament: TOURNAMENT, stage: 'Liga', circuit: 'modus',
      format: { sets: 1, legs_per_set: BEST_OF, two_clear: false },
      status: 'Fixture', start_at: f.start_at, board: null, televised: false,
      a: { id: pa ? String(pa.id) : null, name: f.a, country: pa ? pa.country || null : null },
      b: { id: pb ? String(pb.id) : null, name: f.b, country: pb ? pb.country || null : null },
      score_a: null, score_b: null, winner_id: null,
      books: [...f.books],
      unresolved: [!pa ? f.a : null, !pb ? f.b : null].filter(Boolean),
    });
  }
  out.sort((x, y) => Date.parse(x.start_at) - Date.parse(y.start_at));
  return out;
}

// el resolutor de la base, con dos candados propios de este circuito: el apellido tiene que coincidir
// exacto y, si el nombre trae inicial o nombre de pila, también la inicial ("Graham Mawson" NO es "Gary
// Mawson" aunque compartan apellido: la base los tiene a los dos)
function resolve(name) {
  const p = D.resolvePlayer(name);
  if (!p) return null;
  const q = D.norm(name).split(' ').filter(Boolean), n = D.norm(p.name).split(' ').filter(Boolean);
  if (!q.length || !n.length) return null;
  if (q[q.length - 1] !== n[n.length - 1]) return null;
  if (q.length > 1 && n.length > 1 && q[0][0] !== n[0][0]) return null;
  return p;
}
function lastName(s) { const p = D.norm(s).replace(/\b[a-z]\.?$/, '').trim().split(' '); return p[p.length - 1] || ''; }

// resumen de torneo con la forma de los de la PDC, para la tira de torneos y la ficha
function summary(fixtures) {
  const fx = fixtures.filter((f) => f.circuit === 'modus');
  if (!fx.length) return null;
  return { id: TID, name: TOURNAMENT, venue: 'MODUS Studio', city: 'Portsmouth', start: fx[0].start_at, end: fx[fx.length - 1].start_at, tv: false, ranked: false, logo: null,
    fixtures: fx.length, results: 0, formats: [{ stage: 'Liga', sets: 1, legs: BEST_OF, two_clear: false, n: fx.length }], double_in: false, winner_id: null,
    certified_format: true, format_source: 'reglamento MODUS Super Series: primero a 4 legs (medido en Flashscore: todos los resultados son 4-x)', circuit: 'modus',
    note: 'circuito diario fuera de la PDC: fixtures de las casas, jugadores resueltos contra la base propia, resultado por Flashscore. Sin estadística de partido: 180s y checkout no se liquidan aquí.' };
}

// resultado de un partido MODUS por Flashscore (el día del saque y el siguiente, por si cruza medianoche)
async function result(p) {
  const t0 = Date.parse(p.start_at || 0);
  if (!Number.isFinite(t0)) return null;
  const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
  const d0 = new Date(t0); d0.setUTCHours(0, 0, 0, 0);
  const off = Math.round((d0 - hoy) / 864e5);
  for (const o of [off, off + 1]) {
    if (o > 0 || o < -7) continue;
    let rows;
    try { rows = await FLASH.feed({ dayOffset: o }); } catch { continue; }
    const hit = FLASH.matchByNames(rows.filter((r) => isModus(r.tournament)), p.a, p.b);
    if (!hit) continue;
    if (hit.state !== 'final') return { pending: true, state: hit.state };
    const sa = hit.swapped ? hit.legs_b : hit.legs_a, sb = hit.swapped ? hit.legs_a : hit.legs_b;
    if (!Number.isFinite(+sa) || !Number.isFinite(+sb)) return null;
    return { score_a: +sa, score_b: +sb, winner: +sa > +sb ? 'a' : 'b', source: 'flashscore', best_of: hit.best_of || BEST_OF };
  }
  return null;
}

module.exports = { ENABLED, TID, TOURNAMENT, BEST_OF, isModus, fixturesFromOdds, summary, result, resolve };
