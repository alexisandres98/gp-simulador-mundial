// tests/line-intel.test.js — Movimiento de línea (line-intel/engine). PURO.
// moveForPick (baseline de publicación vs consenso actual) y summarize (serie completa: dirección/steam).
'use strict';
const path = require('path');
const L = require(path.join(__dirname, '..', 'line-intel', 'engine'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

console.log('\n§ moveForPick');
{
  const w = L.moveForPick(0.50, 0.535);
  ok('sube 3.5pp → with', w.direction === 'with' && w.pp === 3.5);
  const a = L.moveForPick(0.50, 0.47);
  ok('baja 3pp → against', a.direction === 'against' && a.pp === -3);
  ok('ruido <1pp → flat', L.moveForPick(0.50, 0.506).direction === 'flat');
  ok('sin baseline → null', L.moveForPick(null, 0.5) === null);
  ok('sin consenso → null', L.moveForPick(0.5, null) === null);
}

console.log('\n§ summarize');
{
  const t0 = Date.parse('2026-07-09T10:00:00Z');
  const at = (h) => new Date(t0 + h * 3600e3).toISOString();
  const drift = [
    { fair: 0.50, at: at(0) }, { fair: 0.505, at: at(3) }, { fair: 0.512, at: at(6) }, { fair: 0.52, at: at(9) },
  ];
  const s = L.summarize(drift);
  ok('drift up: move +2pp', s.move_pp === 2 && s.direction === 'up');
  ok('drift sin steam (saltos <2pp)', s.steam === false);
  ok('points', s.points === 4);

  const steam = [
    { fair: 0.50, at: at(0) }, { fair: 0.50, at: at(1) }, { fair: 0.53, at: at(2) }, // +3pp en 1h = steam
  ];
  ok('salto 3pp en 1h → steam', L.summarize(steam).steam === true);

  const slowJump = [{ fair: 0.50, at: at(0) }, { fair: 0.53, at: at(5) }]; // +3pp pero en 5h
  ok('salto 3pp en 5h → NO steam', L.summarize(slowJump).steam === false);

  ok('1 punto → move 0 flat', L.summarize([{ fair: 0.5, at: at(0) }]).direction === 'flat');
  ok('serie vacía → null', L.summarize([]) === null);
  const dirty = L.summarize([{ fair: 0.5, at: at(1) }, { fair: null, at: at(2) }, { fair: 0.52, at: at(3) }]);
  ok('filas sin fair se filtran', dirty.points === 2 && dirty.move_pp === 2);
  // desorden temporal se reordena
  const unordered = L.summarize([{ fair: 0.52, at: at(3) }, { fair: 0.50, at: at(0) }]);
  ok('serie desordenada se ordena', unordered.open === 0.5 && unordered.close === 0.52);
}

console.log(`\nline-intel: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
