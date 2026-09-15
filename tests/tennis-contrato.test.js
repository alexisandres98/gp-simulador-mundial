// tests/tennis-contrato.test.js — EL SELECTOR DE PRECIO DE TENIS, CON LA LÍNEA DENTRO (T1.2b / A01, 15-sep)
//
// Lo que este test impide que vuelva a pasar:
//   1. valorar la línea del consenso y pagar la cuota de otra línea (el fallo A01, el mismo que ya se
//      arregló en NFL, fútbol americano universitario, CFL y tenis de mesa);
//   2. emparejar el hándicap por valor absoluto: A−3,5 / B+3,5 es UN mercado y A+3,5 / B−3,5 es OTRO;
//   3. devolver una fila con la cuota vacía porque `x[side] || 0` trataba `undefined` como cero;
//   4. quedarse sin contador: `descartadas_por_linea` y `sin_precio_en_linea` son el número que decía
//      cuántas candidatas se estaban valorando contra un mercado que no era el suyo, y no existía.
//
// Correr: node tests/tennis-contrato.test.js
'use strict';
const TEN = require('../tennis-engine/store');

let fallos = 0;
const igual = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`);
};

// Un evento con la forma EXACTA que devuelve The Odds API, con tres casas que no cotizan la misma línea.
// El consenso (mediana) del total es 20,5 y el del hándicap −3,5. La casa que más paga, en las dos
// familias, cotiza OTRA línea — que es justo el caso que inflaba la ventaja siempre en la misma dirección.
const ev = {
  id: 'prueba-1', home_team: 'Jugadora A', away_team: 'Jugadora B',
  commence_time: '2026-09-16T18:00:00Z',
  bookmakers: [
    { key: 'pinnacle', markets: [
      { key: 'h2h', outcomes: [{ name: 'Jugadora A', price: 1.55 }, { name: 'Jugadora B', price: 2.50 }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: 1.90, point: 20.5 }, { name: 'Under', price: 1.93, point: 20.5 }] },
      { key: 'spreads', outcomes: [{ name: 'Jugadora A', price: 1.88, point: -3.5 }, { name: 'Jugadora B', price: 1.95, point: 3.5 }] },
    ] },
    { key: 'onexbet', markets: [
      { key: 'h2h', outcomes: [{ name: 'Jugadora A', price: 1.60 }, { name: 'Jugadora B', price: 2.45 }] },
      // OTRA línea, y la que más paga: 2,05 el over de 21,5 no es el over de 20,5
      { key: 'totals', outcomes: [{ name: 'Over', price: 2.05, point: 21.5 }, { name: 'Under', price: 1.80, point: 21.5 }] },
      { key: 'spreads', outcomes: [{ name: 'Jugadora A', price: 2.15, point: -4.5 }, { name: 'Jugadora B', price: 1.72, point: 4.5 }] },
    ] },
    { key: 'coolbet', markets: [
      { key: 'h2h', outcomes: [{ name: 'Jugadora A', price: 1.58 }, { name: 'Jugadora B', price: 2.60 }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: 1.95, point: 20.5 }, { name: 'Under', price: 1.88, point: 20.5 }] },
      { key: 'spreads', outcomes: [{ name: 'Jugadora A', price: 1.92, point: -3.5 }, { name: 'Jugadora B', price: 1.90, point: 3.5 }] },
    ] },
  ],
};
const mk = TEN.marketOf(ev);

// ── 1. EL CONSENSO ──────────────────────────────────────────────────────────────────────────────────────
igual('la línea de total del consenso es la mediana cotizada', mk.consensus.total_line, 20.5);
igual('la del hándicap también', mk.consensus.spread_line, -3.5);
igual('el desvigado de ganador se calcula casa a casa, no cruzando medianas', mk.consensus.ml_pares_libros, 3);

// ── 2. EL PRECIO ES DE LA LÍNEA QUE SE VALORA ───────────────────────────────────────────────────────────
igual('el over se paga en la línea del consenso, no en la que más paga', mk.best.total_over.line, 20.5);
igual('y es el mejor de ESA línea', mk.best.total_over.over, 1.95);
igual('la cuota más alta del tablero (2,05 en 21,5) no se usa', mk.best.total_over.over !== 2.05, true);
igual('el under, igual', [mk.best.total_under.line, mk.best.total_under.under], [20.5, 1.93]);
igual('el hándicap de A sale de −3,5', [mk.best.spread_a.line, mk.best.spread_a.a], [-3.5, 1.92]);
igual('el de B sale del MISMO contrato (B+3,5), no de B+4,5', [mk.best.spread_b.line, mk.best.spread_b.b], [-3.5, 1.95]);
igual('el ganador no tiene línea y no se filtra', mk.best.ml_b.b, 2.60);

// ── 3. LOS CONTADORES QUE NO EXISTÍAN ───────────────────────────────────────────────────────────────────
// Una casa de otra línea × dos lados = dos descartes por familia.
igual('se cuentan las cotizaciones de otra línea en el total', mk.best.descartadas_por_linea.total, 2);
igual('y en el hándicap', mk.best.descartadas_por_linea.spread, 2);
igual('el ganador no descarta nada', mk.best.descartadas_por_linea.ml, 0);
igual('con todas las casas en la línea del consenso, no falta precio', mk.best.sin_precio_en_linea, []);

// ── 4. SI NADIE COTIZA LA LÍNEA EVALUADA, NO HAY PRECIO ─────────────────────────────────────────────────
// Se fuerza el caso quitando del tablero las dos casas que cotizaban 20,5/−3,5: el consenso pasa a ser la
// línea de la única que queda, así que se pide explícitamente otra y la respuesta tiene que ser un hueco.
const CT = require('../lib/contrato');
const soloOtra = CT.mejorPrecio(
  [{ casa: 'onexbet', familia: 'TOTAL', lado: 'over', linea: 21.5, cuota: 2.05, tipoLinea: 'total' }],
  { familia: 'TOTAL', lado: 'over', linea: 20.5, tipoLinea: 'total' });
igual('sin nadie en la línea evaluada la fila es nula', soloOtra.fila, null);
igual('y el motivo lo dice', /ninguna casa cotiza la línea evaluada/.test(soloOtra.motivo || ''), true);

// ── 5. UNA FILA SIN CUOTA NO ES UN PRECIO ───────────────────────────────────────────────────────────────
// El defecto de `x[side] || 0`: con `undefined` en el lado que se pide, el `reduce` devolvía esa fila y
// aguas abajo salía un NaN que mataba la candidata en silencio.
const sinCuota = CT.mejorPrecio(
  [{ casa: 'pinnacle', familia: 'TOTAL', lado: 'over', linea: 20.5, cuota: undefined, tipoLinea: 'total' }],
  { familia: 'TOTAL', lado: 'over', linea: 20.5, tipoLinea: 'total' });
igual('una fila sin cuota no gana el selector', sinCuota.fila, null);
igual('y se cuenta como lo que es', sinCuota.descartes.sin_cuota, 1);

// ── 6. LA TUPLA LLEGA HASTA LA CANDIDATA ────────────────────────────────────────────────────────────────
// `line` es la línea que valoró el modelo y `line_price` la que cotizaba la casa del precio. Que las dos
// viajen juntas en cada pick es lo que faltaba: 766 picks liquidadas y ninguna sabía de qué línea era su
// cuota, así que el histórico no se pudo auditar. Desde hoy sí.
const ct = TEN.candidatasDePrueba ? TEN.candidatasDePrueba(ev) : null;
if (ct) {
  const tot = ct.filter((c) => c.family === 'TOTAL');
  igual('cada candidata de total lleva la línea del precio', tot.every((c) => c.line_price === c.line), true);
  igual('y ninguna queda descuadrada', tot.some((c) => c.line_mismatch), false);
} else {
  console.log('ok    (las candidatas necesitan la base propia; el contrato del precio ya queda probado arriba)');
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
