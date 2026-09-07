#!/usr/bin/env node
// scripts/smoke/darts-smoke.js — invariantes del motor de dardos (blueprint 8.0 §14.2). Sin red, sin coste.
//   node scripts/smoke/darts-smoke.js
'use strict';
const R = require('../../darts-engine/rules');
const K = require('../../darts-engine/kernel');
const C = require('../../darts-engine/compiler');

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sum = (p) => p.reduce((s, [, v]) => s + v, 0);

console.log('reglas');
ok(R.NOT_FINISHABLE_3.join(',') === '159,162,163,165,166,168,169', 'sin salida en tres dardos: 159 162 163 165 166 168 169');
ok(R.canFinish(170, 3) && R.canFinish(110, 2) && !R.canFinish(111, 2) && R.canFinish(50, 1) && !R.canFinish(51, 1), 'techos 170/110/50');
ok(R.applyDart(32, R.outcome('D', 16)).type === 'FINISH', '32 con D16 cierra');
ok(R.applyDart(32, R.outcome('S', 16)).r === 16, '32 con S16 deja 16');
ok(R.applyDart(3, R.outcome('D', 1)).type === 'BUST' && R.applyDart(2, R.outcome('S', 1)).type === 'BUST', 'dejar 1 o pasarse es bust');
ok(R.applyDart(40, R.outcome('T', 20)).type === 'BUST', 'llegar a 0 sin doble es bust');
ok(R.applyDart(501, R.outcome('T', 20), { doubleIn: true, opened: false }).type === 'NOOPEN', 'double-in: T20 sin abrir consume dardo y no puntúa');
ok(R.applyDart(501, R.outcome('D', 20), { doubleIn: true, opened: false }).r === 461, 'double-in: el doble de apertura puntúa (501→461)');
ok(R.neighbours(20).join(',') === '5,1' && R.neighbours(1).join(',') === '20,18', 'vecinos de la diana');
ok(R.formatFor('2026 World Grand Prix', 'Quarter-final').format.double_in === true && R.formatFor('World Grand Prix').format.kind === 'sets', 'Grand Prix → sets con double-in');
ok(R.formatFor('World Matchplay', 'Final').format.two_clear === true, 'Matchplay → dos de diferencia');
ok(R.formatFor('Players Championship 21').format.best_of === 11, 'Players Championship → BO11');

console.log('kernel');
const sk = K.skills({ pT: 0.4, pD: 0.4, rho: 0.3 });
for (const aim of [{ kind: 'T', n: 20 }, { kind: 'D', n: 16 }, { kind: 'S', n: 17 }, { kind: 'DB', n: 25 }]) {
  const kk = K.dartKernel(aim, sk, false);
  ok(near(kk.reduce((s, [, p]) => s + p, 0), 1, 1e-9), `kernel ${aim.kind}${aim.n} suma 1`);
}
const pol = K.policyFor(sk);
ok(pol.best[32][1].kind === 'D' && pol.best[32][1].n === 16, 'política: 32 con un dardo → D16');
ok(pol.best[50][1].kind === 'DB', 'política: 50 con un dardo → bull');
ok(pol.best[40][3].kind === 'D' && pol.best[40][3].n === 20, 'política: 40 → D20');
ok(pol.best[2][1].kind === 'D' && pol.best[2][1].n === 1, 'política: 2 → D1');
const leg = K.soloLeg(sk);
let finTot = 0; for (let k = 1; k <= leg.kmax; k++) for (let nn = 0; nn <= K.N180MAX; nn++) finTot += leg.fin[k][nn];
ok(near(finTot + leg.residual, 1, 1e-6), 'solo: masa cerrada + residual = 1');
ok(leg.residual < 1e-6, 'solo: residual tras KMAX visitas despreciable');
ok(leg.visits[1] === 0 && leg.visits[2] === 0 && leg.visits[3] > 0 && leg.visits[3] < 3e-3 && leg.visits[4] > 0, `solo: nadie cierra 501 en menos de 3 visitas; el 9-darter existe y es raro (${(100 * leg.visits[3]).toFixed(3)} % — el kernel regional lo sobreestima ~3× frente a la tasa real de élite; pendiente de un kernel de cierre medido)`);
ok(near(sum(leg.checkout), 1, 1e-6), 'solo: la PMF del checkout suma 1');
ok(leg.checkout.every(([c]) => R.canFinish(c, 3)), 'solo: todos los checkouts son alcanzables en ≤3 dardos');
ok(leg.exp180 < 2 && leg.exp180 > 0.05, 'solo: 180s por leg en rango');
const c100 = K.calibrate({ avg: 100, per180: 0.5, checkoutPct: 0.42 });
ok(near(c100.fitted.avg3, 100, 0.6), `calibración: media 100 → ${c100.fitted.avg3.toFixed(2)}`);
ok(near(c100.fitted.exp180, 0.5, 0.05), `calibración: 180/leg 0,5 → ${c100.fitted.exp180.toFixed(3)}`);
const c80 = K.calibrate({ avg: 80, checkoutPct: 0.3 });
ok(c80.sk.pT < c100.sk.pT, 'calibración: menos media → menos precisión al triple');
const di = K.soloLeg(sk, { doubleIn: true });
ok(di.expDarts > leg.expDarts, 'double-in: más dardos para cerrar que straight-in');

console.log('compilador');
const E = K.calibrate({ avg: 95, per180: 0.4, checkoutPct: 0.4 }).leg;
const A = c100.leg, B = K.calibrate({ avg: 90, per180: 0.3, checkoutPct: 0.36 }).leg;
const m0 = C.compileMatch(E, E, R.legsFormat(11));
ok(near(m0.p_a, 0.5, 1e-9), 'iguales con bull-off desconocido → 50,0 %');
ok(near(m0.mass, 1, 1e-6) && near(sum(m0.legs.total), 1, 1e-6) && near(sum(m0.legs.margin), 1, 1e-6), 'BO11: masas suman 1');
ok(m0.legs.total.every(([k]) => k >= 6 && k <= 11), 'BO11: entre 6 y 11 legs');
ok(near(sum(m0.x180.total), 1, 1e-6) && near(m0.x180.most_a + m0.x180.most_b + m0.x180.tie, 1, 1e-6), '180s: total y most suman 1 (con empate)');
ok(near(m0.x180.most_a, m0.x180.most_b, 1e-9), 'iguales: most 180s simétrico');
const m1 = C.compileMatch(A, B, R.legsFormat(11)), m2 = C.compileMatch(B, A, R.legsFormat(11));
ok(near(m1.p_a + m2.p_a, 1, 1e-9), 'intercambiar jugadores invierte la probabilidad');
ok(m1.p_a > 0.6, `el de 100 de media gana al de 90 más del 60 % (${(100 * m1.p_a).toFixed(1)} %)`);
ok(m1.scenarios.a_starts.p_a > m1.scenarios.b_starts.p_a, 'salir primero vale algo');
const ou = [8.5, 9.5, 10.5].map((l) => C.overUnder(m1.legs.total, l).over);
ok(ou[0] >= ou[1] && ou[1] >= ou[2], 'over de legs decrece con la línea');
const scoreSum = m1.legs.score.filter(([k]) => k.startsWith('6-')).reduce((s, [, v]) => s + v, 0);
ok(near(scoreSum, m1.p_a, 1e-9), 'Σ marcadores exactos con 6 de A = P(A gana)');
const mp = C.compileMatch(A, B, R.legsFormat(19, { twoClear: true, maxLegs: 25 }), { starter: 'a' });
ok(mp.legs.total.every(([k]) => k !== 19 && k !== 21 && k !== 23) && mp.legs.total.some(([k]) => k === 25), 'Matchplay: 10-9 no acaba, muerte súbita en el 25');
ok(mp.p_a > m1.p_a, 'formato largo amplifica al favorito');
const ws = C.compileMatch(A, B, R.setsFormat(13, 5, { finalSetTwoClear: true, finalSetMaxLegs: 11 }));
ok(near(ws.mass, 1, 1e-6) && near(sum(ws.sets.score), 1, 1e-6), 'WC final BO13 sets: masas suman 1');
ok(ws.sets.score.every(([k]) => { const [a, b] = k.split('-').map(Number); return Math.max(a, b) === 7 && Math.min(a, b) <= 6; }), 'sets: el ganador llega exactamente a 7');
ok(ws.p_a > mp.p_a, 'BO13 sets amplifica aún más');
const gp = C.compileMatch(K.calibrate({ avg: 100, per180: 0.5, checkoutPct: 0.42 }, { doubleIn: true }).leg, K.calibrate({ avg: 90, per180: 0.3, checkoutPct: 0.36 }, { doubleIn: true }).leg, R.setsFormat(3));
ok(gp.p_a > 0.5 && gp.p_a < m1.p_a + 0.05, 'Grand Prix double-in BO3 sets: favorito, formato corto');
ok(C.checkoutOver(m1.checkout_max.a, 0) > 0.95, 'checkout máximo: A cierra al menos un leg casi siempre');
ok(C.checkoutOver(m1.checkout_max.match, 100) >= C.checkoutOver(m1.checkout_max.a, 100), 'máximo del partido ≥ máximo de A');

console.log(`\n${n - fails}/${n} verdes${fails ? ' — ' + fails + ' ROJAS' : ''}`);
process.exit(fails ? 1 : 0);
