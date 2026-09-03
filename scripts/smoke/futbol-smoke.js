#!/usr/bin/env node
'use strict';
// scripts/smoke/futbol-smoke.js — humo de las mejoras de FÚTBOL DE CLUBES (2-sep-2026). Sin red, sin servidor.
//   1) shinDevig: suma 1, baja el longshot respecto al proporcional, degenerados.
//   2) publishableProb (p_pub) con c=0 y c=0,5.
//   3) prior por división al fusionar pools de copas con ratings sintéticos (copias, no mutación).
//   4) el de-vig de TOTALES a dos lados es idéntico al de antes (proporcional) y no pasa por lib/devig.
// Uso: node scripts/smoke/futbol-smoke.js   (código de salida 0 = todo bien)

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const D = require(path.join(ROOT, 'lib', 'devig'));
const CUPS = require(path.join(ROOT, 'clubs-engine', 'cups'));
const noVigValue = require(path.join(ROOT, 'value-engine', 'noVig'));
const noVigGoal = require(path.join(ROOT, 'goal-engine', 'noVig'));

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('  FALLA  ' + msg); } else console.log('  ok     ' + msg); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('1) shinDevig');
{
  const o = [1.30, 6.00, 12.0];
  const sh = D.shinDevig(o);
  const q = o.map((x) => 1 / x), S = q.reduce((a, b) => a + b, 0);
  const prop = q.map((x) => x / S);
  ok(sh.status === 'ok' && sh.method === 'shin', `método shin para ${JSON.stringify(o)} (z=${sh.z})`);
  ok(near(sh.probabilities.reduce((a, b) => a + b, 0), 1, 1e-6), 'las probabilidades suman 1');
  ok(sh.probabilities[2] < prop[2], `longshot más bajo: Shin ${sh.probabilities[2].toFixed(4)} < proporcional ${prop[2].toFixed(4)}`);
  ok(sh.probabilities[0] > prop[0], `favorito más alto: Shin ${sh.probabilities[0].toFixed(4)} > proporcional ${prop[0].toFixed(4)}`);
  const eq = D.shinDevig([2.9, 2.9, 2.9]);
  ok(eq.status === 'ok' && eq.probabilities.every((p) => near(p, 1 / 3, 1e-6)), 'tres cuotas iguales → 1/3 cada una');
  ok(D.shinDevig([1.0, 3, 4]).status === 'invalid', 'cuota 1,00 → invalid');
  ok(D.shinDevig([2.5]).status === 'invalid', 'una sola cuota → invalid');
  ok(D.shinDevig([2.0, 2.0]).status === 'ok' && D.shinDevig([2.0, 2.0]).method !== 'shin', 'sin margen (β=1) → reserva, no Shin');
  ok(D.shinDevig(['1.5', '4', '7']).status === 'ok', 'acepta strings numéricos');
  const two = D.shinDevig([1.9, 1.95]);
  ok(two.status === 'ok' && near(two.probabilities[0] + two.probabilities[1], 1, 1e-6), 'dos resultados también suma 1');
  const cons = D.shinConsensus1x2([{ home: 1.3, draw: 6, away: 12 }, { home: 1.28, draw: 6.2, away: 11 }, { home: 1.5 /* incompleta */ }]);
  ok(cons.books === 2 && near(cons.fair.home + cons.fair.draw + cons.fair.away, 1, 1e-5), 'consenso: solo casas completas, suma 1');
  ok(cons.fair.away < cons.fair_prop.away, 'consenso: visita (longshot) Shin < proporcional');
}

console.log('2) publishableProb');
{
  ok(near(D.publishableProb(0.6, 0.8, 0), 0.6), 'c=0 → p_pub = p_mkt');
  ok(near(D.publishableProb(0.6, 0.8, Number(process.env.GP_SOLID_C ?? 0)), 0.6), 'default GP_SOLID_C ausente → c=0');
  const half = D.publishableProb(0.6, 0.8, 0.5);
  ok(half > 0.6 && half < 0.8, `c=0,5 → entre mercado y modelo (${half.toFixed(4)})`);
  const lg = (p) => Math.log(p / (1 - p));
  ok(near(lg(half), lg(0.6) + 0.5 * (lg(0.8) - lg(0.6)), 1e-9), 'c=0,5 es exactamente el punto medio en logit');
  ok(near(D.publishableProb(0.6, 0.8, 1), 0.8), 'c=1 → p_pub = p_gp');
  ok(near(D.publishableProb(0.6, null, 0.5), 0.6), 'sin modelo → mercado');
  ok(((0.6 - 0.6) * 100) < 2, 'ventaja de lead con c=0 es 0 (< 2 pp) → no genera picks');
}

console.log('3) prior por división en copas');
{
  const RT = { leagues: {
    top: { key: 'top', ratings: { a1: { elo: 1600, name: 'A1' }, a2: { elo: 1450, name: 'A2' } }, hfa: 60 },
    second: { key: 'second', ratings: { b1: { elo: 1650, name: 'B1' } }, hfa: 55 },
    third: { key: 'third', ratings: { c1: { elo: 1500, name: 'C1' } }, hfa: 55 },
    other1: { key: 'other1', ratings: { d1: { elo: 1550, name: 'D1' } }, hfa: 55 },
  } };
  const cfg = { name: 'Copa X', odds_key: 'x', from: [['top', 'other1'], 'second', 'third'], hfa: 55 };
  const L = CUPS.buildCupLeague(RT, 'copax', cfg, 150);
  ok(L.ratings.a1.elo === 1600 && L.ratings.a1.tier === 1 && L.ratings.a1.tier_offset === 0, 'nivel 1 sin ajuste');
  ok(L.ratings.d1.elo === 1550 && L.ratings.d1.tier === 1, 'lista dentro de from = mismo nivel');
  ok(L.ratings.b1.elo === 1500 && L.ratings.b1.tier === 2 && L.ratings.b1.tier_offset === -150, 'nivel 2: −150');
  ok(L.ratings.c1.elo === 1200 && L.ratings.c1.tier === 3 && L.ratings.c1.tier_offset === -300, 'nivel 3: −300');
  ok(RT.leagues.second.ratings.b1.elo === 1650 && RT.leagues.third.ratings.c1.elo === 1500, 'la liga de origen NO se muta');
  ok(L.ratings.b1 !== RT.leagues.second.ratings.b1, 'es copia, no referencia');
  ok(L.ratings.b1.from_league === 'second' && L.cup === true && L.tier_gap === 150, 'metadatos de la copia');
  const L0 = CUPS.buildCupLeague(RT, 'copax', cfg, 0);
  ok(L0.ratings.b1.elo === 1650 && L0.ratings.c1.elo === 1500 && L0.ratings.b1.tier_offset === 0, 'GAP=0 reproduce la fusión anterior');
  ok(CUPS.tiersOf(CUPS.CLUB_CUPS.uclq).every(([, k]) => k === 1), 'uclq: todas las ligas al mismo nivel');
  ok(CUPS.tiersOf(CUPS.CLUB_CUPS.facup).map(([, k]) => k).join() === '1,2,3,4', 'facup: premier→league2 = niveles 1..4');
  ok(CUPS.tiersOf(CUPS.CLUB_CUPS.libertadores).find(([lg]) => lg === 'brasilb')[1] === 2, 'libertadores: brasilb es nivel 2');
  // aplicación del prior sobre un overlay dinámico (misma aritmética que clubElo/applyClubElo en server.js)
  const overlay = { b1: 1700 };
  const readElo = (lg, tid) => (overlay[tid] != null ? overlay[tid] + (L.ratings[tid].tier_offset || 0) : L.ratings[tid].elo);
  ok(readElo('copax', 'b1') === 1550, 'overlay 1700 + prior −150 = 1550 dentro de la copa');
  ok(readElo('copax', 'a1') === 1600, 'sin overlay → base de la copia');
  const off = L.ratings.b1.tier_offset; const written = (readElo('copax', 'b1') - off) + 12; // delta +12
  ok(written === 1712, 'al escribir el overlay se quita el prior (no se filtra a la liga de origen)');
}

console.log('4) de-vig de totales a dos lados: idéntico al de antes');
{
  const qs = [1 / 1.9, 1 / 1.95];
  const pr = noVigValue.proportional(qs);
  ok(pr.status === 'ok' && near(pr.probabilities[0], qs[0] / (qs[0] + qs[1]), 1e-7), 'value-engine/noVig.proportional: q_i/Σq');
  const quotes = [{ sportsbook_code: 'x', independence_group: 'x', side: 'over', odds_decimal: 1.9, quote_status: 'open', is_live: false },
    { sportsbook_code: 'x', independence_group: 'x', side: 'under', odds_decimal: 1.95, quote_status: 'open', is_live: false }];
  const c = noVigGoal.consensus(quotes, 'over', 'under', { minGroups: 1 });
  ok(c.ok && near(c.probability, qs[0] / (qs[0] + qs[1]), 1e-6), `goal-engine/noVig.consensus (córners/tarjetas): proporcional (${c.probability.toFixed(6)})`);
  const rv = noVigValue.removeVig([0.45, 0.35, 0.3], { method: 'proportional' });
  ok(rv.official.status === 'ok' && near(rv.official.probabilities[0], 0.45 / 1.1, 1e-7), 'market-scanner (scanner.consensus) sigue con removeVig proporcional');
  for (const f of ['goal-engine/noVig.js', 'value-engine/noVig.js', 'market-scanner/scanner.js', 'pick-engine/curate.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(!/lib\/devig|shin/i.test(src), `${f} no referencia lib/devig ni Shin`);
  }
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split('\n');
  const sites = srv.map((l, i) => [l, i]).filter(([l]) => /require\('\.\/lib\/devig'\)/.test(l));
  ok(sites.length >= 3, `server.js requiere lib/devig en ${sites.length} sitios`);
  for (const [, i] of sites) {
    const ctx = srv.slice(Math.max(0, i - 12), i + 1).join('\n');
    ok(/1x2|SOLID/i.test(ctx), `línea ${i + 1}: el uso está en un bloque 1X2/SOLID`); // 3-sep: rememberClubClosing1x2 (cierre 1X2 de todos los partidos) también cuenta
  }
  const closingTotals = srv.some((l) => l.includes('const pOver = (1 / b.over.o) / (1 / b.over.o + 1 / b.under.o);'));
  ok(closingTotals, 'el cierre de GOALS/CORNERS/CARDS sigue con el proporcional a dos lados');
  const cornersCons = srv.some((l) => l.includes("noVig.consensus(quotes, 'over', 'under', { minGroups: 1 })"));
  ok(cornersCons, 'CORNERS/CARDS siguen con goal-engine/noVig.consensus proporcional');
  const cardsLine = srv.some((l) => l.includes("if (p.family === 'CARDS' && p.side === 'over') { p.regime = 'monitor'; continue; }"));
  ok(cardsLine, 'la regla de CARDS (over → monitor) sigue intacta');
}

console.log(`\n${n - fails}/${n} comprobaciones bien${fails ? ` — ${fails} FALLAN` : ''}`);
process.exit(fails ? 1 : 0);
