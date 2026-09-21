// tests/feed.test.js — EL FEED SIN VEREDICTO (21-sep-2026, orden de Alexis).
//
// Fija tres cosas: que el interruptor está ENCENDIDO por defecto y se apaga con `0`; que dardos y tenis de
// mesa enseñan el ganador como tesis SOLO con el interruptor (la sombra lo sigue marcando `benchmark`); y
// que el ejecutor real no lee este módulo — publicar sin veredicto no mueve dinero.
'use strict';
const fs = require('fs');
const path = require('path');
const FEED = require('../lib/feed');

let fallos = 0;
const t = (nombre, ok) => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}`); };
const envAntes = process.env.GP_FEED_SIN_VEREDICTO;

// ── 1. EL INTERRUPTOR ────────────────────────────────────────────────────────────────────────────────────
delete process.env.GP_FEED_SIN_VEREDICTO;
t('sin la env, el feed publica sin veredicto (encendido por defecto)', FEED.sinVeredicto() === true);
for (const v of ['0', 'false', 'off', 'no', ' 0 ']) { process.env.GP_FEED_SIN_VEREDICTO = v; t(`GP_FEED_SIN_VEREDICTO=${JSON.stringify(v)} lo apaga`, FEED.sinVeredicto() === false); }
for (const v of ['1', 'true', 'on', 'yes', 'cualquier cosa']) { process.env.GP_FEED_SIN_VEREDICTO = v; t(`GP_FEED_SIN_VEREDICTO=${JSON.stringify(v)} lo deja encendido`, FEED.sinVeredicto() === true); }
t('la nota viaja en los dos idiomas y lleva el descargo', /no consejo financiero/.test(FEED.NOTA.es) && /not financial advice/.test(FEED.NOTA.en));

// ── 2. EL GANADOR COMO TESIS EN DARDOS Y TENIS DE MESA ───────────────────────────────────────────────────
// Se comprueba sobre el código, no sobre un tablero vivo: los dos stores filtran con `esTesis`, que deja
// pasar el benchmark SOLO si trae `publicable`, y `publicable` SOLO nace con el interruptor.
const dt = fs.readFileSync(path.join(__dirname, '..', 'darts-engine', 'store.js'), 'utf8');
const tt = fs.readFileSync(path.join(__dirname, '..', 'tt-engine', 'store.js'), 'utf8');
for (const [nombre, src] of [['dardos', dt], ['tenis de mesa', tt]]) {
  t(`${nombre}: la tesis se filtra con esTesis (benchmark o publicable)`, /const esTesis = \(c\) => c\.verdict === 'SHADOW_PICK' && \(!c\.benchmark \|\| !!c\.publicable\)/.test(src));
  t(`${nombre}: publicable nace solo con el interruptor`, /FEED\.sinVeredicto\(\) \? \{ publicable: true, sin_veredicto: true \}/.test(src));
  t(`${nombre}: la sombra sigue anotando benchmark tal cual`, /benchmark: !!c\.benchmark/.test(src));
  t(`${nombre}: ya no queda ningún filtro viejo "&& !c.benchmark" sobre SHADOW_PICK`, !/verdict === 'SHADOW_PICK' && !c\.benchmark/.test(src));
}

// ── 3. EL DINERO NO LEE ESTE MÓDULO ──────────────────────────────────────────────────────────────────────
for (const f of ['store.js', 'tt.js', 'parada.js', 'reconciliar.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'real-executor', f), 'utf8');
  t(`real-executor/${f} no importa lib/feed`, !/lib\/feed/.test(src));
}
t('la vara no importa lib/feed', !/lib\/feed|\.\/feed/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'vara.js'), 'utf8')));

if (envAntes != null) process.env.GP_FEED_SIN_VEREDICTO = envAntes; else delete process.env.GP_FEED_SIN_VEREDICTO;
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
