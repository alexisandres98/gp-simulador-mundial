// tests/arbitro-servido.test.js — EL ÁRBITRO QUE SE ENTRENA ES EL QUE SE SIRVE (T2.2 / A19, 15-sep-2026)
//
// POR QUÉ ESTE TEST EXISTE. Durante meses `prop-engine/model.js` estimó un multiplicador de árbitro, la
// validación leave-one-out lo usó para decidir que el modelo servía, y la llamada de producción lo omitió.
// Nadie se dio cuenta porque no falla nada: `project()` sin `referee` devuelve un modelo perfectamente
// válido — solo que no es el que se validó. Un desajuste así no se detecta leyendo, se detecta midiendo, y
// costó meses de validación sobre un modelo que no existía en producción.
//
// La auditoría externa lo encontró (A19) y el challenger lo cuantificó: el árbitro aislado gana 0,00309 de
// log-score con t −3,80 sobre racimos de partido. Este test fija las dos mitades del arreglo para que no se
// deshaga: que el motor lo aplique, y que la llamada de producción se lo pase.
'use strict';
const fs = require('fs');
const path = require('path');
const PE = require('../prop-engine/model');
const C = require('../lib/conteos');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// ── 1. EL MOTOR LO APLICA ────────────────────────────────────────────────────────────────────────────────
// Dataset sintético: una liga con media conocida y un árbitro que pita muy por encima de ella.
const partidos = [];
const mk = (h, a, hy, ay, ref) => ({ date: '2026-01-01', round: 'Regular Season - 1', referee: ref, et: false,
  home: { code: h, name: h, goals: 1, corners: 5, yellows: hy, reds: 0 },
  away: { code: a, name: a, goals: 1, corners: 5, yellows: ay, reds: 0 } });
for (let i = 0; i < 120; i++) partidos.push(mk('t' + (i % 8), 't' + ((i + 3) % 8), 2, 2, 'normal_' + (i % 20)));
for (let i = 0; i < 30; i++) partidos.push(mk('t' + (i % 8), 't' + ((i + 5) % 8), 5, 5, 'estricto'));

const fit = PE.fit(partidos);
t('el fit estima un multiplicador para el árbitro estricto', !!(fit.refs && fit.refs.estricto));
t('y ese multiplicador es mayor que 1', fit.refs.estricto.mult > 1, `mult ${fit.refs.estricto.mult.toFixed(4)}`);
t('y está topado en +20 % (con 30 partidos muy por encima, el tope muerde)',
  Math.abs(fit.refs.estricto.mult - 1.2) < 1e-9, `mult ${fit.refs.estricto.mult}`);

const sin = PE.project(fit, { home: 't0', away: 't1' });
const con = PE.project(fit, { home: 't0', away: 't1', referee: 'estricto' });
t('project SIN árbitro deja el multiplicador en 1', sin.cards.ref_mult === 1);
t('project CON árbitro lo aplica al total', con.cards.total > sin.cards.total,
  `${sin.cards.total.toFixed(3)} → ${con.cards.total.toFixed(3)}`);
t('un árbitro desconocido no rompe nada y no mueve la proyección',
  PE.project(fit, { home: 't0', away: 't1', referee: 'no-existe' }).cards.total === sin.cards.total);

// Y el desplazamiento se nota EN LA LÍNEA QUE SE APUESTA, que es lo único que importa: un multiplicador que
// no mueve la probabilidad de la línea no cambia ninguna pick por mucho que cambie una media interna.
const pSin = C.pOver(C.nb(sin.cards.total, sin.cards.r_total), 5.5);
const pCon = C.pOver(C.nb(con.cards.total, con.cards.r_total), 5.5);
t('y mueve P(over 5,5) de forma apreciable', Math.abs(pCon - pSin) > 0.01,
  `${(100 * pSin).toFixed(2)} % → ${(100 * pCon).toFixed(2)} %`);

// ── 2. LA LLAMADA DE PRODUCCIÓN SE LO PASA ───────────────────────────────────────────────────────────────
// Esta es la mitad que faltaba y la que nadie vigilaba. Se comprueba sobre el código fuente porque el
// síntoma de A19 era exactamente una llamada a la que le faltaba un argumento: no hay forma de detectarlo
// ejecutando el motor, que funciona igual de bien sin él.
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const llamada = server.match(/projCache2\[ceid\] = require\('\.\/prop-engine'\)\.project\([^;]*\);/);
t('existe la llamada de producción al prop-engine para props de clubes', !!llamada);
if (llamada) {
  t('y le pasa el árbitro', /referee\s*:/.test(llamada[0]),
    'si esto falla, se ha vuelto a validar un modelo que no es el que se sirve (A19)');
}
t('existe el interruptor GP_CARDS_REF para apagarlo sin desplegar', /function cardsRefOn\s*\(/.test(server));
t('y está ENCENDIDO por defecto', /GP_CARDS_REF \|\| '1'/.test(server));

// ── 3. EL ÁRBITRO SE BUSCA ANTES DE PROYECTAR ────────────────────────────────────────────────────────────
// Si se buscara después, se podría anotar en la pick pero jamás entrar a la probabilidad — que es
// literalmente lo que pasaba antes: el nombre viajaba en `refCache2` y la proyección ya estaba hecha.
const iRef = server.indexOf('const riPre = await clubRefereeFor(meta)');
const iProj = llamada ? server.indexOf(llamada[0]) : -1;
t('el árbitro se resuelve ANTES de construir la proyección', iRef > 0 && iProj > 0 && iRef < iProj,
  'buscarlo después solo sirve para anotarlo, no para usarlo');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
