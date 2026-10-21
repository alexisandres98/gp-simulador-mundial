// Prueba la lógica pura de index.html (bloque LOGIC-START … LOGIC-END): node poker-practica/test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const src = html.slice(html.indexOf('// LOGIC-START'), html.indexOf('</script>', html.indexOf('// LOGIC-START')));
const m = { exports: {} }; new Function('module', src)(m); const L = m.exports;
const c = s => ({ r: { A: 14, K: 13, Q: 12, J: 11, T: 10 }[s[0]] || +s[0], s: s[1] });
const cs = str => str.split(' ').map(c);

// Libro: color 9, escalera abierta 8, gutshot 4, color + abierta 15.
assert.strictEqual(L.outsFor(cs('Ah Kh'), cs('2h 7h 9c')).length, 9);
assert.strictEqual(L.outsFor(cs('8c 9d'), cs('Ts Jh 2c')).length, 8);
assert.strictEqual(L.outsFor(cs('8c 9d'), cs('Js Qh 2c')).length, 4);
assert.strictEqual(L.outsFor(cs('8h 9h'), cs('Th Jh 2c')).length, 15);
// Rueda: A-2-3-4 → solo el 5.
assert.strictEqual(L.outsFor(cs('Ac 2d'), cs('3s 4h 9c')).length, 4);

// Equity exacta: 9 outs del flop a river ≈ 35 %.
assert(Math.abs(L.exactEquity(9, 47, 2) - 0.3497) < 0.001);

// Pot odds: la respuesta reconstruye (bote + apuestas)/apuesta y siempre está entre las opciones.
for (let lvl = 1; lvl <= 4; lvl++) for (let i = 0; i < 2000; i++) {
  const g = L.genPotOdds(lvl);
  assert(g.options.includes(g.odds));
  assert(Math.abs((g.pot + g.bet * (1 + g.calls)) / g.bet - g.odds) < 1e-9);
  if (lvl === 1) assert(Number.isInteger(g.bet));
}
// Manos de outs generadas: sin pareja, sin mano hecha, >= 4 outs.
for (const b of [3, 4]) for (let i = 0; i < 300; i++) {
  const d = L.dealDraw(b); const all = [...d.hole, ...d.board];
  assert.strictEqual(new Set(all.map(x => x.r)).size, all.length);
  assert(d.outs.length >= 4 && d.outs.length <= 15 + 6);
}
for (let i = 0; i < 2000; i++) { const s = L.spotSpr(); assert.strictEqual(L.sprZone(s.spr), s.zone); assert.strictEqual(Math.min(s.hero, s.villain), s.eff); }
for (let i = 0; i < 2000; i++) { const s = L.spotDecision(); assert.strictEqual(s.call, s.eq > s.need); }
console.log('ok');
