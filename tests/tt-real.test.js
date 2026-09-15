// tests/tt-real.test.js — UNA POSICIÓN POR PARTIDO EN EL CANAL DE TENIS DE MESA (T0.4, 15-sep-2026)
//
// Por qué existe. El canal de dinero real de tenis de mesa tenía su propia copia de la regla "una posición
// por partido" y le exigía además que coincidiera la LÍNEA. Con eso, `over 73,5` y `over 75,5` del mismo
// partido podían llevar dinero a la vez: si el partido acaba largo, las dos pierden. Es el mismo patrón que
// en tarjetas costó −17,63 % de ROI con dos líneas y −45,83 % con tres, medido sobre 139 liquidadas.
//
// Qué fija: dos totales del mismo partido y el mismo lado son UNA posición; lados opuestos y partidos
// distintos siguen siendo posiciones distintas; y el interruptor de reversión funciona en los dos canales.
'use strict';
const RE = require('../real-executor/store');

const CON_DINERO = 'PLACED';
const fila = (o) => Object.assign({ status: CON_DINERO, side: 'over', line: 73.5, cb_event_id: '9001',
  match: 'A vs B', kickoff_at: '2026-09-16T10:00:00.000Z', pick_id: 'p' + Math.random() }, o);

let fallos = 0;
const comprueba = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};

// ── el fallo que motivó el test ──────────────────────────────────────────────────────────────────────────
const puesta = fila({ pick_id: 'ya-puesta' });
const otraLinea = fila({ pick_id: 'segunda', line: 75.5 });
const L = { bets: [puesta] };
comprueba('over 73,5 y over 75,5 del mismo partido son la MISMA posición',
  !!RE.posicionOcupada(L, otraLinea), true);

// ── lo que sí son posiciones distintas ───────────────────────────────────────────────────────────────────
comprueba('el lado contrario del mismo partido es otra posición',
  !!RE.posicionOcupada(L, fila({ pick_id: 'contraria', side: 'under' })), false);
comprueba('otro partido es otra posición',
  !!RE.posicionOcupada(L, fila({ pick_id: 'otro-partido', cb_event_id: '9002', match: 'C vs D' })), false);

// ── una fila sin dinero no ocupa nada ────────────────────────────────────────────────────────────────────
comprueba('una fila DESCARTADA no ocupa la posición',
  !!RE.posicionOcupada({ bets: [fila({ pick_id: 'muerta', status: 'DESCARTADA' })] }, otraLinea), false);
comprueba('una fila EN_ACEPTACION sí ocupa (puede haber dinero puesto)',
  !!RE.posicionOcupada({ bets: [fila({ pick_id: 'en-aire', status: 'EN_ACEPTACION' })] }, otraLinea), true);

// ── la misma fila no se ocupa a sí misma ─────────────────────────────────────────────────────────────────
comprueba('una fila no se bloquea a sí misma', !!RE.posicionOcupada({ bets: [puesta] }, puesta), false);

// ── el interruptor de reversión ──────────────────────────────────────────────────────────────────────────
const antes = process.env.GP_REAL_UNA_POR_PARTIDO;
process.env.GP_REAL_UNA_POR_PARTIDO = 'off';
comprueba('con GP_REAL_UNA_POR_PARTIDO=off vuelven a ser dos posiciones',
  !!RE.posicionOcupada(L, otraLinea), false);
comprueba('con el interruptor apagado, la MISMA línea sigue ocupada',
  !!RE.posicionOcupada(L, fila({ pick_id: 'misma-linea' })), true);
if (antes == null) delete process.env.GP_REAL_UNA_POR_PARTIDO; else process.env.GP_REAL_UNA_POR_PARTIDO = antes;

// ── el canal de TT usa la regla común, no una copia ──────────────────────────────────────────────────────
const TT = require('../real-executor/tt');
comprueba('el canal de TT expone su familia', TT.FAMILIA, 'TT_POINTS');
comprueba('el canal de TT expone su mercado', TT.MARKET_KEY, 'table_tennis.totals');
const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'real-executor', 'tt.js'), 'utf8');
comprueba('tt.js ya no compara líneas por su cuenta', /Number\(b\.line\) === Number\(fila\.line\)/.test(fuente), false);
comprueba('tt.js llama a la regla común', /RE\.posicionOcupada/.test(fuente), true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
