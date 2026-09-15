// tests/parada.test.js — LAS LÍNEAS DE PARADA (T1.8, 15-sep-2026)
//
// Tres cosas que la auditoría externa señaló y este test fija para que no vuelvan:
//   1. el suelo estaba en dólares de un stake concreto, así que con otro stake significaba otra cosa;
//   2. solo miraba tarjetas, y hay dinero real en tenis de mesa;
//   3. una condición de parada que no para no es un control.
'use strict';
const P = require('../real-executor/parada');

let fallos = 0;
const cerca = (nombre, real, esperado, tol = 0.5) => {
  const ok = real != null && Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};
const igual = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};

// ── 1. EL SUELO EN UNIDADES, NO EN DÓLARES ───────────────────────────────────────────────────────────────
// Monte Carlo del 13-sep: 100 apuestas, cuota 1,81, p = 1/1,81 + 0,07 → percentil 1 = 51 victorias
//   P&L = stake × (1,81 × 51 − 100) = stake × (−7,69)
cerca('suelo a 100 apuestas con stake 30', P.lineaDe(100, 30), -230.7, 1.5);
cerca('suelo a 100 apuestas con stake 40', P.lineaDe(100, 40), -307.6, 2.0);
cerca('suelo a 100 apuestas con stake 5 (tenis de mesa)', P.lineaDe(100, 5), -38.45, 0.5);
igual('con 59 apuestas todavía no se juzga', P.lineaDe(59, 30), null);
igual('el suelo escala linealmente con el stake', Math.abs(P.lineaDe(100, 40) / P.lineaDe(100, 30) - 40 / 30) < 1e-9, true);

// ── 2. UNA LÍNEA POR CANAL ───────────────────────────────────────────────────────────────────────────────
const bet = (o) => Object.assign({ status: 'SETTLED', resultado: 'LOSS', pnl: -30, placed_at: '2026-09-14T10:00:00.000Z',
  settled_at: '2026-09-14T22:00:00.000Z', model_prob: 0.6, edge_pp: 5, odds_real: 1.81 }, o);
const cartera = [];
for (let i = 0; i < 100; i++) cartera.push(bet({ pnl: -9 }));                                   // tarjetas: −900
for (let i = 0; i < 100; i++) cartera.push(bet({ familia: 'TT_POINTS', pnl: 0.1 }));            // tenis de mesa: +10
const ev = P.evaluar({ bets: cartera, saldo: { amount: 400, at: new Date().toISOString() }, memoria: {} });
const del = (id, canal) => ev.lineas.find((x) => x.id === id && x.canal === canal);
igual('hay línea de núcleo para tarjetas', !!del('nucleo', 'cards'), true);
igual('y también para tenis de mesa', !!del('nucleo', 'tt'), true);
igual('y para CS2, aunque hoy no tenga filas', !!del('nucleo', 'cs2'), true);
igual('tarjetas salta con −900 acumulado', del('nucleo', 'cards').salta, true);
igual('tenis de mesa no salta con +10', del('nucleo', 'tt').salta, false);
igual('el estado global es FUERA en cuanto salta una', ev.estado, 'FUERA');

// ── 3. LAS LÍNEAS 2 Y 3 MIDEN APUESTAS COLOCADAS, NO PICKS ───────────────────────────────────────────────
igual('la línea de mercado tiene muestra de apuestas colocadas', del('mercado', 'cards').n, 100);
igual('la línea de calibración también', del('calibracion', 'cards').n, 100);

// ── 4. EL BLOQUEO ────────────────────────────────────────────────────────────────────────────────────────
const estado = { lineas: ev.lineas.map((x) => ({ id: x.id, canal: x.canal, nombre: x.nombre, salta: x.salta, lectura: x.lectura })) };
const antes = process.env.GP_PARADA_BLOQUEA;
process.env.GP_PARADA_BLOQUEA = 'on';
igual('con la línea de tarjetas saltada, tarjetas queda bloqueada', !!P.bloqueo(estado, 'CARDS'), true);
igual('y tenis de mesa NO se bloquea por la de tarjetas', !!P.bloqueo(estado, 'TT_POINTS'), false);
const conCaja = { lineas: [{ id: 'caja', canal: null, nombre: 'caja', salta: true, lectura: 'saldo bajo' }] };
igual('la caja bloquea todos los canales', !!P.bloqueo(conCaja, 'TT_POINTS') && !!P.bloqueo(conCaja, 'CARDS'), true);
process.env.GP_PARADA_BLOQUEA = 'off';
igual('GP_PARADA_BLOQUEA=off levanta el bloqueo sin desplegar', P.bloqueo(estado, 'CARDS'), null);
if (antes == null) delete process.env.GP_PARADA_BLOQUEA; else process.env.GP_PARADA_BLOQUEA = antes;

// ── 5. VERDE CUANDO NO HAY NADA QUE PARAR ────────────────────────────────────────────────────────────────
const sano = P.evaluar({ bets: [], saldo: { amount: 400, at: new Date().toISOString() }, memoria: {} });
igual('sin muestra el estado es VERDE', sano.estado, 'VERDE');
igual('y ninguna línea salta', sano.saltan.length, 0);
igual('el informe dice si está bloqueando o no', typeof sano.bloquea === 'boolean', true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
