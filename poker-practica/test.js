// Prueba la lógica pura de index.html (bloque LOGIC-START … LOGIC-END): node poker-practica/test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const src = html.slice(html.indexOf('// LOGIC-START'), html.indexOf('</script>', html.indexOf('// LOGIC-START')));
const m = { exports: {} }; new Function('module', src)(m); const L = m.exports;
const c = s => ({ r: { A: 14, K: 13, Q: 12, J: 11, T: 10 }[s[0]] || +s[0], s: s[1] });
const cs = str => str.split(' ').map(c);
const near = (x, y, tol) => assert(Math.abs(x - y) < tol, `${x} no está cerca de ${y}`);

// Outs del libro: color 9, escalera abierta 8, gutshot 4, color + abierta 15, rueda 4.
assert.strictEqual(L.outsFor(cs('Ah Kh'), cs('2h 7h 9c')).length, 9);
assert.strictEqual(L.outsFor(cs('8c 9d'), cs('Ts Jh 2c')).length, 8);
assert.strictEqual(L.outsFor(cs('8c 9d'), cs('Js Qh 2c')).length, 4);
assert.strictEqual(L.outsFor(cs('8h 9h'), cs('Th Jh 2c')).length, 15);
assert.strictEqual(L.outsFor(cs('Ac 2d'), cs('3s 4h 9c')).length, 4);
near(L.exactEquity(9, 47, 2), 0.3497, 0.001);

// Evaluador: orden de categorías y desempates.
const E = s => L.evalHand(cs(s));
const ladder = ['2c 5d 9h Jc Ks 3c 4h', '2c 2d 9h Jc Ks 3c 4h', '2c 2d 9h 9c Ks 3c 4h', '2c 2d 2h 9c Ks 3c 4h',
  'Ac 2d 3h 4c 5s Jc Kh', '2c 7c 9c Jc Kc 3d 4h', '2c 2d 2h 9c 9s 3c 4h', '2c 2d 2h 2s Ks 3c 4h', '5h 6h 7h 8h 9h 2c 2d', 'Th Jh Qh Kh Ah 2c 2d'];
for (let i = 1; i < ladder.length; i++) assert(E(ladder[i]) > E(ladder[i - 1]), `escalón ${i}`);
assert(E('Ac Kd 7h 7c 2s 3d 9h') > E('Qc Jd 7h 7c 2s 3d 9h'));    // kicker
assert.strictEqual(E('Ac 2d 5h 5c 9s 9d Kh'), E('Kc 3d 5h 5c 9s 9d Ah')); // misma mano jugada
assert(E('6c 2d 3h 4c 5s Jc Kh') > E('Ac 2d 3h 4c 5s Jc Kh'));    // 6-alta gana a la rueda
assert(E('2c 2d 2h 3c 3s 3d Kh') > E('2c 2d 2h Ac As 4d 9h'));  // full 333-22 gana a 222-AA
assert(E('2c 2d 2h 3c 3s Ad Kh') < E('2c 2d 2h Kc Ks 4d 9h'));   // 222-33 pierde con 222-KK

// Equities preflop conocidas.
near(L.equityMC(cs('Ah As'), cs('Kh Ks'), 30000), 0.82, 0.015);
near(L.equityMC(cs('7h 7s'), cs('Ac Kd'), 30000), 0.55, 0.015);
near(L.equityMC(cs('Ah Kc'), cs('Ad Qs'), 30000), 0.74, 0.015);
let t = Date.now(); L.equityMC(cs('Ah Kc'), cs('Qd Js')); console.log('simulación 15k:', Date.now() - t, 'ms');

// Pot odds: la respuesta reconstruye (bote + apuestas)/apuesta y siempre está entre las opciones.
for (let lvl = 1; lvl <= 4; lvl++) for (let i = 0; i < 2000; i++) {
  const g = L.genPotOdds(lvl);
  assert(g.options.includes(g.odds));
  assert(Math.abs((g.pot + g.bet * (1 + g.calls)) / g.bet - g.odds) < 1e-9);
  if (lvl === 1) assert(Number.isInteger(g.bet));
}
for (const b of [3, 4]) for (let i = 0; i < 300; i++) {
  const d = L.dealDraw(b); const all = [...d.hole, ...d.board];
  assert.strictEqual(new Set(all.map(x => x.r)).size, all.length);
  assert(d.outs.length >= 4);
}
for (let i = 0; i < 2000; i++) { const s = L.spotSpr(); assert.strictEqual(L.sprZone(s.spr), s.zone); assert.strictEqual(Math.min(s.hero, s.villain), s.eff); }
for (let i = 0; i < 2000; i++) { const s = L.spotDecision(); assert.strictEqual(s.call, s.eq > s.need); }

// Implied: con el extra calculado el EV del call es cero.
for (let i = 0; i < 2000; i++) { const s = L.spotImplied(); assert(s.extra > 0); near(s.e * (s.pot + s.bet + s.extra) - (1 - s.e) * s.bet, 0, 1e-9); }
// EV: 50 % de equity, bote 20, apuesta 10 → 0,5·30 − 0,5·10 = +10.
for (let i = 0; i < 500; i++) { const s = L.spotEV(); near(s.ev, s.e * (s.pot + s.bet) - (1 - s.e) * s.bet, 1e-9); }
// Farol y MDF suman 1.
const b = L.spotBluff('bluff'); const md = { ...b, ans: b.pot / (b.pot + b.bet) }; near(b.ans + md.ans, 1, 1e-9);
near(L.spotBluff('bluff').ans > 0 ? 1 : 0, 1, 0.1);

// Combos.
assert.strictEqual(L.countCombos(12, 12, 'pair', []).n, 6);
assert.strictEqual(L.countCombos(14, 13, 's', []).n, 4);
assert.strictEqual(L.countCombos(14, 13, 'o', []).n, 12);
assert.strictEqual(L.countCombos(14, 13, 'any', []).n, 16);
assert.strictEqual(L.countCombos(14, 13, 'any', cs('Ah 7c 2d')).n, 12);
assert.strictEqual(L.countCombos(14, 13, 's', cs('Ah 7c 2d')).n, 3);
assert.strictEqual(L.countCombos(12, 12, 'pair', cs('Qh 7c 2d')).n, 3);
assert.strictEqual(L.countCombos(12, 12, 'pair', cs('Qh Qc 2d')).n, 1);
for (let i = 0; i < 500; i++) { const s = L.spotCombos(); assert(s.n >= 0 && s.board.length % 3 === 0); }

// Preflop: el arquetipo cuadra con la equity simulada.
const band = { par_overs: [0.48, 0.6], par_unders: [0.75, 0.9], par_par: [0.76, 0.85], par_mix: [0.62, 0.76], dominada: [0.57, 0.78], overs_unders: [0.56, 0.72] };
for (let i = 0; i < 300; i++) {
  const s = L.spotPreflop(4000); const e = Math.max(s.eq, 1 - s.eq); const [lo, hi] = band[s.arch];
  assert(e >= lo - 0.03 && e <= hi + 0.03, `${s.arch} ${e}`);
}
console.log('ok');
