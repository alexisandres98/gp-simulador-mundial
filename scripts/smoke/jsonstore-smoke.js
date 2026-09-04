#!/usr/bin/env node
'use strict';
// scripts/smoke/jsonstore-smoke.js — humo de lib/jsonstore.js. Sin red, sin coste, escribe en un temporal.
//
// POR QUÉ EXISTE. El 4-sep-2026 desapareció el track de esports de CS2, LoL y Valorant (207, 77 y 14 picks
// liquidadas el 21-ago → CERO) sin que nadie tocara un borrado. El mecanismo era este:
//
//     const st = rd(FICHERO) || { picks: {} };   // rd() se tragaba CUALQUIER error y devolvía null
//     wr(FICHERO, st);                           // y guardaba el almacén VACÍO encima del bueno
//
// "No pude leer" tratado igual que "no hay nada". Este humo reproduce ese escenario exacto —lectura que
// falla por E/S sobre un fichero que SÍ tiene histórico— y comprueba que hoy el guardado se rechaza.
//
//   node scripts/smoke/jsonstore-smoke.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const D = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-jsonstore-'));
let ok = 0, ko = 0;
const t = (n, c) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n); } };
const silencio = () => { const e = console.error; console.error = () => {}; return () => { console.error = e; }; };

const JS = require('../../lib/jsonstore');

// ── 1. Vida normal ───────────────────────────────────────────────────────────────────────────────────
t('un fichero que no existe se lee como null', JS.readJson(D, 'a.json', 'humo') === null);
t('se escribe y se relee igual', JS.writeJson(D, 'a.json', { picks: { x: 1 } }, 'humo') === true
  && JSON.stringify(JS.readJson(D, 'a.json', 'humo')) === '{"picks":{"x":1}}');
t('la escritura no deja temporales', fs.readdirSync(D).every((f) => !f.endsWith('.tmp')));

// ── 2. Fichero roto: se aparta con sus bytes, no se destruye ─────────────────────────────────────────
fs.writeFileSync(path.join(D, 'b.json'), '{"picks":{"y":1');   // JSON truncado, como lo deja un SIGKILL
{
  const fin = silencio();
  t('un JSON truncado se lee como null', JS.readJson(D, 'b.json', 'humo') === null);
  fin();
}
const apartados = fs.readdirSync(D).filter((f) => f.startsWith('b.json.roto-'));
t('el JSON truncado queda apartado en disco', apartados.length === 1);
t('los bytes del roto se conservan enteros',
  fs.readFileSync(path.join(D, apartados[0]), 'utf8') === '{"picks":{"y":1');
t('tras apartarlo se puede empezar de cero', JS.writeJson(D, 'b.json', { picks: {} }, 'humo') === true);

// ── 3. EL ESCENARIO QUE BORRÓ EL TRACK ───────────────────────────────────────────────────────────────
// El fichero bueno existe y tiene histórico; la lectura falla por E/S (ni falta el fichero ni está roto).
// Se intercepta readFileSync porque es la única forma fiable de forzarlo: corriendo como root, un chmod 000
// no impide leer y el escenario no se reproduciría.
const BUENO = { picks: { a: 1, b: 2, c: 3 } };
fs.writeFileSync(path.join(D, 'picks-cs2.json'), JSON.stringify(BUENO));
const realRead = fs.readFileSync;
fs.readFileSync = function (p, ...r) {
  if (String(p).endsWith('picks-cs2.json')) { const e = new Error('EIO: i/o error'); e.code = 'EIO'; throw e; }
  return realRead.call(fs, p, ...r);
};
const fin = silencio();
const leido = JS.readJson(D, 'picks-cs2.json', 'humo');
const guardado = JS.writeJson(D, 'picks-cs2.json', leido || { picks: {} }, 'humo');
fin();
fs.readFileSync = realRead;
t('una lectura con EIO devuelve null', leido === null);
t('guardar el almacén VACÍO se RECHAZA', guardado === false);
t('el histórico sigue intacto en disco',
  Object.keys(JSON.parse(fs.readFileSync(path.join(D, 'picks-cs2.json'), 'utf8')).picks).length === 3);
t('en cuanto la lectura vuelve a ir, se desbloquea',
  JS.readJson(D, 'picks-cs2.json', 'humo') !== null
  && JS.writeJson(D, 'picks-cs2.json', { picks: { a: 1, b: 2, c: 3, d: 4 } }, 'humo') === true
  && Object.keys(JS.readJson(D, 'picks-cs2.json', 'humo').picks).length === 4);

// ── 4. Los almacenes de verdad usan esta capa ────────────────────────────────────────────────────────
for (const m of ['esports-engine/store.js', 'esports-engine/props.js', 'nfl-engine/store.js',
  'amfoot-engine/store.js', 'propfirm/scan.js', 'propfirm/polyshadow.js', 'real-executor/store.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', m), 'utf8');
  t(`${m} pasa por jsonstore`, /require\(['"]\.\.\/lib\/jsonstore['"]\)/.test(src));
  t(`${m} ya no escribe JSON a pelo`, !/fs\.writeFileSync\([^)]*JSON\.stringify/.test(src));
}

try { fs.rmSync(D, { recursive: true, force: true }); } catch { /* da igual */ }
console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
process.exit(ko ? 1 : 0);
