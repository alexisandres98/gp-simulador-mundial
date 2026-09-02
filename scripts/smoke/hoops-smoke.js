#!/usr/bin/env node
// scripts/smoke/hoops-smoke.js — HUMO DE LOS HELPERS DE BALONCESTO (2-sep). Sin red, sin db, sin coste.
//
// Comprueba con picks SINTÉTICAS lo que el monitor guarda desde la rama impl/hoops:
//   1. CLV justa vs justa: sin movimiento del consenso → clv_pct ≈ 0 y clv_price_pct ≈ −3 (el margen).
//   2. Migración clv_v 2: idempotente y conserva el número viejo como clv_price_pct.
//   3. Una pick por tesis: `Under 171` y `Under 171,5` son la misma tesis; requotes con tope y sin copias.
//   4. Movimiento de línea con signo a favor de nuestro lado.
//   5. Descanso diferencial con calendario sintético y evaluación del preregistro.
//   6. Bajas histórico: filas planas idempotentes en un directorio temporal.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const CLV = require('../../basketball-engine/clv');
const PRC = require('../../basketball-engine/pricing');
const IH = require('../../basketball-engine/injuries-history');

let fails = 0;
const ok = (cond, msg, extra) => { console.log((cond ? '  ok  ' : '  FALLA') + ' ' + msg + (extra != null ? '  → ' + JSON.stringify(extra) : '')); if (!cond) fails++; };
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// mercado sintético de dos lados con margen ~4,5 %: 3 casas por lado, mismas cuotas al nacer y al cierre
const mkt = (line, oOver, oUnder) => ({ ceid: 'ev1', fam: 'match_total', line, sides: ['over', 'under'],
  q: { over: [1.93, 1.91, 1.92].map((o) => ({ o: o * (oOver / 1.92), book: 'x' })), under: [1.93, 1.91, 1.92].map((o) => ({ o: o * (oUnder / 1.92), book: 'y' })) } });

console.log('1) CLV justa vs justa, consenso quieto');
{
  const m0 = mkt(171.5, 1.92, 1.92);
  const fair0 = CLV.fairFromQuotes(m0, 'under', PRC.novig);
  const best = 1.92;                                   // tomamos la mejor cuota CON margen
  const p = { family: 'TOTAL', selection_code: 'under', line: 171.5, best_odds: best, market_prob: fair0, market_fair_at_create: fair0 };
  const fairClose = CLV.fairFromQuotes(m0, 'under', PRC.novig);
  const closeOddsProp = 1 / 0.5;                       // consenso proporcional sin margen de un 50/50
  p.clv_pct = CLV.clvFair(p.market_fair_at_create, fairClose);
  p.clv_price_pct = CLV.clvPrice(best, closeOddsProp);
  ok(near(fair0, 0.5, 0.005), 'prob. justa de un mercado simétrico ≈ 0,5', fair0);
  ok(near(p.clv_pct, 0, 0.01), 'clv_pct ≈ 0 sin movimiento', p.clv_pct);
  ok(near(p.clv_price_pct, -4, 1.2), 'clv_price_pct ≈ −3/−4 (el margen) sin movimiento', p.clv_price_pct);
  // el mercado se mueve hacia nosotros: under pasa a 55 % justo
  const m1 = mkt(171.5, 2.30, 1.65);
  const f1 = CLV.fairFromQuotes(m1, 'under', PRC.novig);
  ok(f1 > 0.53 && f1 < 0.60, 'cierre justo del under sube cuando su cuota baja', f1);
  ok(CLV.clvFair(fair0, f1) > 5, 'clv_pct positivo cuando el mercado viene hacia nosotros', CLV.clvFair(fair0, f1));
}

console.log('2) Migración clv_v 2 idempotente');
{
  const old = { family: 'SPREAD', selection_code: 'home', line: -3.5, best_odds: 1.95, market_prob: 0.5, close_odds: 2.0, clv_pct: -2.5 };
  ok(CLV.applyV2(old) === true, 'primera pasada migra');
  ok(old.clv_v === 2 && old.clv_price_pct === -2.5, 'el CLV viejo queda como clv_price_pct', { v: old.clv_v, price: old.clv_price_pct });
  ok(near(old.clv_pct, 0, 0.01), 'clv_pct justa vs justa ≈ 0 (1/close_odds = market_prob)', old.clv_pct);
  ok(CLV.applyV2(old) === false && CLV.migrateV2([old, { close_odds: null }]) === 0, 'segunda pasada no toca nada');
  const sinCierre = { market_prob: 0.5, close_odds: null, clv_pct: null };
  ok(CLV.applyV2(sinCierre) === false && sinCierre.clv_v === undefined, 'sin cierre no se migra');
}

console.log('3) Una pick por tesis + requotes');
{
  const picks = [{ id: 'a', family: 'TOTAL', selection_code: 'under', game_id: '401', line: 171, status: 'SETTLED' }];
  ok(CLV.thesisOf(picks[0]) === 'match_total|under|401', 'tesis derivada de una pick vieja sin campo thesis', CLV.thesisOf(picks[0]));
  ok(CLV.findByThesis(picks, 'match_total|under|401') === picks[0], 'Under 171,5 encuentra la tesis de Under 171');
  ok(CLV.findByThesis(picks, 'match_total|over|401') === null, 'el over es otra tesis');
  ok(CLV.findByThesis(picks, 'match_total|under|402') === null, 'otro partido es otra tesis');
  const rq = { at: '2026-09-17T00:00:00Z', line: 171.5, best_odds: 1.9, model_prob: 0.56, edge_pp: 6.1 };
  ok(CLV.addRequote(picks[0], rq) === true && picks[0].requotes.length === 1, 'primera re-cotización se anota');
  ok(CLV.addRequote(picks[0], rq) === false && picks[0].requotes.length === 1, 'la misma línea y cuota no se repite');
  for (let i = 0; i < 40; i++) CLV.addRequote(picks[0], { ...rq, line: 172 + i * 0.5 });
  ok(picks[0].requotes.length === 20, 'tope de 20 re-cotizaciones', picks[0].requotes.length);
}

console.log('4) Movimiento de línea con signo');
{
  // under 171,5 y el mercado cierra en 169,5: ahora espera MENOS puntos, nuestro under es más fácil → a favor
  ok(CLV.lineMoved({ family: 'TOTAL', side: 'under', lineAtCreate: 171.5, closeLine: 169.5 }) === 2, 'under 171,5 → cierra 169,5: a favor (+2)');
  ok(CLV.lineMoved({ family: 'TOTAL', side: 'under', lineAtCreate: 171.5, closeLine: 173 }) === -1.5, 'under 171,5 → cierra 173: en contra (−1,5)');
  ok(CLV.lineMoved({ family: 'TOTAL', side: 'over', lineAtCreate: 171.5, closeLine: 173 }) === 1.5, 'over 171,5 → cierra 173: a favor (+1,5)');
  ok(CLV.lineMoved({ family: 'SPREAD', side: 'home', lineAtCreate: 3, closeLine: 1 }) === 2, 'local +3 → cierra +1: a favor (+2)');
  ok(CLV.lineMoved({ family: 'SPREAD', side: 'away', lineAtCreate: 3, closeLine: 1 }) === -2, 'visitante −3 → cierra −1: en contra (−2)');
  ok(CLV.lineMoved({ family: 'MONEYLINE', side: 'home', lineAtCreate: null, closeLine: null }) === null, 'ganador: sin línea');
  const mk = [{ ceid: 'e', fam: 'match_total', line: 170.5, sides: ['over', 'under'], q: { over: [{ o: 1.9 }], under: [{ o: 1.9 }] } },
    { ceid: 'e', fam: 'match_total', line: 171.5, sides: ['over', 'under'], q: { over: [{ o: 1.9 }, { o: 1.9 }, { o: 1.9 }], under: [{ o: 1.9 }, { o: 1.9 }, { o: 1.9 }] } }];
  ok(CLV.mainLine(mk, { ceid: 'e', fam: 'match_total', near: 170.5 }) === 171.5, 'línea principal = la que más casas cotizan');
}

console.log('5) Descanso diferencial con calendario sintético');
{
  const d = (day, h = 0) => `2026-09-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00Z`;
  const G = (id, day, home, away, pts) => ({ id, date: d(day), home: { id: home, pts: pts ? pts[0] : null }, away: { id: away, pts: pts ? pts[1] : null }, odds: [{ ou: 160.5 }] });
  const cal = [G('1', 10, 'A', 'B', [80, 79]), G('2', 12, 'A', 'C', [90, 80]), G('3', 13, 'B', 'D', [70, 60]), G('4', 14, 'A', 'B', [95, 70])];
  const gm = cal[3];                                   // A jugó el 12 (2 días), B jugó el 13 (1 día)
  ok(CLV.restDays(cal, 'A', gm.date) === 2 && CLV.restDays(cal, 'B', gm.date) === 1, 'días de descanso por equipo', [CLV.restDays(cal, 'A', gm.date), CLV.restDays(cal, 'B', gm.date)]);
  const f = CLV.restFeatures(cal, gm);
  ok(f.rest_diff === -1 && f.prereg_rest_over === false, 'rest_diff = away − home = −1: la regla NO dispara', f);
  const gm2 = G('5', 16, 'B', 'A', null);              // B descansó desde el 14 (2 d), A también (2 d) → 0
  ok(CLV.restFeatures(cal.concat(gm2), gm2).rest_diff === 0, 'mismo descanso → 0');
  const gm3 = G('6', 16, 'D', 'A', null);              // D jugó el 13 (3 d), A el 14 (2 d) → away − home = −1
  ok(CLV.restFeatures(cal.concat(gm3), gm3).rest_diff === -1, 'D descansó más que A: −1');
  const gm4 = G('7', 16, 'C', 'A', null);              // C jugó el 12 (4 d), A el 14 (2 d) → −2; visitante A
  ok(CLV.restFeatures(cal.concat(gm4), gm4).rest_diff === -2, 'C con 4 días de casa: −2');
  const gm5 = G('8', 17, 'B', 'C', null);              // B jugó 14 (3 d), C jugó 12 (5 d) → away − home = +2 → dispara
  const f5 = CLV.restFeatures(cal.concat(gm5), gm5);
  ok(f5.rest_diff === 2 && f5.prereg_rest_over === true, 'visitante más descansado (> 0,9): la regla dispara', f5);
  ok(CLV.restFeatures(cal, G('9', 30, 'Z', 'Y', null)).home_rest_known === false, 'sin partido previo → descanso por defecto (3) y marcado como desconocido');
  ok(CLV.restDays(cal, 'A', d(30)) === 7, 'saturado a 7 días');
  // evaluación del preregistro: en el calendario completado, ¿dónde disparó y qué pasó con el over?
  const pr = CLV.restPrereg(cal, { closeLineOf: (g) => (g.odds || [])[0].ou });
  ok(pr.n_disparos === 1 && pr.rows[0].game_id === '2' && pr.rows[0].result === 'OVER', 'partido 2: C sin previo (3 d) vs A (2 d) → +1 dispara; 170 > 160,5 = OVER', { n: pr.n_disparos, r: pr.rows[0] });
  ok(CLV.restPrereg(cal, { since: '2026-09-13' }).n_disparos === 0, 'el corte por fecha filtra');
}

console.log('6) Bajas histórico idempotente');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoops-smoke-'));
  const obs = { 'wnba:401': { at: Date.parse('2026-09-17T15:00:00Z'), league: 'wnba', game_id: '401', teams: [
    { team_id: '9', items: [{ id: '1', name: 'X', status: 'Out', detail: 'rodilla' }, { id: '2', name: 'Y', status: 'Questionable' }, { id: '3', name: 'Z', status: 'Doubtful' }] },
    { team_id: '18', items: [{ id: '4', name: 'W', status: 'day-to-day' }] }] } };
  const rows = IH.rowsFromObs(obs);
  ok(rows.length === 2 && rows[0].players_out.length === 1 && rows[0].players_doubtful.length === 1 && rows[1].players_out.length === 0, 'una fila por equipo con fuera y dudas separados', rows.map((r) => [r.team, r.players_out.length, r.players_doubtful.length]));
  const r1 = IH.record(tmp, rows), r2 = IH.record(tmp, rows);
  ok(r1.appended === 2 && r2.appended === 0 && r2.skipped === 2, 'segunda pasada no duplica', [r1, r2]);
  ok(IH.readAll(tmp).length === 2 && IH.readAll(tmp)[0].date === '2026-09-17', 'se lee de vuelta con la fecha del parte');
  obs['wnba:401'].teams[1].items[0].status = 'Out';
  ok(IH.record(tmp, IH.rowsFromObs(obs)).appended === 1, 'si cambian los fuera del día se añade otra fila');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporal */ }
}

console.log(fails ? `\n${fails} comprobaciones FALLARON` : '\nTodo en orden');
process.exit(fails ? 1 : 0);
