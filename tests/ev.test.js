// tests/ev.test.js — EL VALOR ESPERADO AL CIERRE (T1.1, 15-sep-2026)
//
// Este test fija el contraejemplo por el que se reescribió la vara. La regla del 11-sep restaba el margen
// por lado a la media del CLV y llamaba a eso "neto"; con ese cálculo una familia con esperanza NEGATIVA
// salía aprobada. Aquí se comprueba el número exacto, para que nadie vuelva a mezclar las dos magnitudes.
'use strict';
const EV = require('../lib/ev');

let fallos = 0;
const cerca = (nombre, real, esperado, tol = 0.01) => {
  const ok = real != null && Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};
const igual = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};

// ── 1. EL CONTRAEJEMPLO DE LA AUDITORÍA ──────────────────────────────────────────────────────────────────
// cierre 1,904762 / 1,904762 → Q = 1,05, margen 2,5 % por lado, probabilidad justa 0,50
// entrada aceptada a 1,97 → CLV bruto +3,425 %, regla vieja +0,925 %, EV REAL −1,50 %
const cierre = 2 / 1.05;   // 1,904762
const e = EV.evDeTicket({ entrada: 1.97, cierre, cierreContraria: cierre });
igual('el ticket se puede valorar', e.ok, true);
cerca('CLV bruto', e.clv_bruto_pct, 3.43, 0.02);
cerca('margen por lado del cierre', e.margen_lado_pct, 2.5, 0.01);
cerca('probabilidad justa del cierre', e.q_cierre, 0.5, 0.0001);
cerca('EV al cierre', e.ev_pct, -1.5, 0.02);
const reglaVieja = e.clv_bruto_pct - e.margen_lado_pct;
igual('la regla vieja aprobaba (CLV − margen > 0) lo que el EV rechaza', reglaVieja > 0 && e.ev_pct < 0, true);

// ── 2. SIN LAS DOS CARAS NO HAY VARA ─────────────────────────────────────────────────────────────────────
igual('sin la cara contraria no se inventa el margen', EV.evDeTicket({ entrada: 1.97, cierre }).ok, false);
igual('sin cierre tampoco', EV.evDeTicket({ entrada: 1.97 }).ok, false);
igual('una cuota de 1 o menos no es cuota', EV.evDeTicket({ entrada: 0.9, cierre, cierreContraria: cierre }).ok, false);

// ── 3. UN CIERRE SIN MARGEN DEJA EL EV IGUAL AL CLV ──────────────────────────────────────────────────────
const justo = EV.evDeTicket({ entrada: 2.10, cierre: 2, cierreContraria: 2 });
cerca('con Q = 1 el EV coincide con el CLV bruto', justo.ev_pct, justo.clv_bruto_pct, 0.02);

// ── 4. COMISIONES ────────────────────────────────────────────────────────────────────────────────────────
const conCoste = EV.evDeTicket({ entrada: 2.10, cierre: 2, cierreContraria: 2, costes: 0.02 });
cerca('una comisión del 2 % del stake baja el EV dos puntos', conCoste.ev_pct, justo.ev_pct - 2, 0.02);

// ── 5. CUARTOS ASIÁTICOS: SE PROMEDIAN PAGOS, NO PROBABILIDADES ──────────────────────────────────────────
// over 2,25 con P(T<2)=0,30, P(T=2)=0,25, P(T>2)=0,45.
// Media apuesta en over 2,0 (empate en 2 devuelve) y media en over 2,5 (empate en 2 pierde).
//   A = 0,45          B = 0,30 + 0,5×0,25 = 0,425          cuota justa = 1 + B/A = 1,944444
// Promediar P(over2 | no push)=0,60 con P(over2,5)=0,45 da 0,525 → cuota 1,904762, que es mentira.
const cuarto = EV.evFraccionario([
  { p: 0.30, gana: 0, pierde: 1 },      // menos de 2: pierde la mitad de 2,0 y la mitad de 2,5 → pierde entera
  { p: 0.25, gana: 0, pierde: 0.5 },    // exactamente 2: la mitad de 2,0 devuelve, la mitad de 2,5 pierde
  { p: 0.45, gana: 1, pierde: 0 },      // más de 2: gana entera
]);
cerca('masa que gana (A)', cuarto.A, 0.45, 0.0001);
cerca('masa que pierde (B)', cuarto.B, 0.425, 0.0001);
cerca('cuota justa del cuarto', cuarto.cuota_justa, 1.944444, 0.0001);
cerca('probabilidad equivalente', cuarto.p_equivalente, 0.45 / 0.875, 0.0001);
const ingenua = 1 / (0.5 * (0.45 / (1 - 0.25) + 0.45));
const evIngenua = EV.evFraccionario([
  { p: 0.30, gana: 0, pierde: 1 }, { p: 0.25, gana: 0, pierde: 0.5 }, { p: 0.45, gana: 1, pierde: 0 },
], ingenua).ev_pct;
cerca('apostar a la cuota justa INGENUA pierde dinero', evIngenua, -1.786, 0.02);

// ── 6. LÍNEA ENTERA ──────────────────────────────────────────────────────────────────────────────────────
const entera = EV.evFraccionario([
  { p: 0.30, gana: 0, pierde: 1 }, { p: 0.25, gana: 0, pierde: 0 }, { p: 0.45, gana: 1, pierde: 0 },
]);
cerca('en línea entera el empate devuelve entero', entera.masa_devuelta, 0.25, 0.0001);
cerca('cuota justa de la línea entera', entera.cuota_justa, 1 + 0.30 / 0.45, 0.0001);

// ── 7. DISTRIBUCIONES QUE NO SUMAN 1 NO SE VALORAN ───────────────────────────────────────────────────────
igual('una distribución que no suma 1 devuelve null', EV.evFraccionario([{ p: 0.4, gana: 1, pierde: 0 }]), null);

// ── 8. EL AGREGADO ───────────────────────────────────────────────────────────────────────────────────────
const tickets = [
  { entrada: 1.97, cierre, cierreContraria: cierre, evento: 'A' },
  { entrada: 2.10, cierre: 2, cierreContraria: 2, evento: 'A' },
  { entrada: 2.05, cierre: 2, cierreContraria: 2, evento: 'B' },
  { entrada: 1.80, cierre: 2, cierreContraria: 2, evento: 'C' },
  { entrada: 1.99, cierre: 2, evento: 'D' },                      // sin cara contraria: fuera, contado
];
const ag = EV.agrega(tickets, { cluster: (x) => x.evento });
igual('el ticket sin cara contraria queda fuera', ag.n, 4);
igual('y se cuenta por qué', ag.descartados.sin_contraria, 1);
cerca('la cobertura se declara', ag.cobertura_pct, 80, 0.1);
igual('hay media', ag.ev_medio_pct != null, true);
igual('el método se declara siempre', typeof ag.metodo === 'string' && ag.metodo.length > 10, true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
