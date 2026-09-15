// tests/contrato.test.js — EL PRECIO ES UNA TUPLA (T1.2 / A01, 15-sep-2026)
//
// Las tres pruebas que la auditoría pide por su nombre (§3.5) y que este módulo existe para pasar:
//   1. precio de otra línea → RECHAZADO ANTES DE VALORAR, con motivo y contador;
//   2. A/B invertidos con el signo del hándicap → misma clave canónica y el mismo pago;
//   3. caras de momentos distintos → no se emparejan, porque ese mercado no existió.
'use strict';
const C = require('../lib/contrato');

let fallos = 0;
const igual = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`);
};
const cerca = (nombre, real, esperado, tol = 1e-9) => {
  const ok = real != null && Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};

// ── 1. PRECIO DE OTRA LÍNEA: RECHAZO ANTES DE VALORAR ────────────────────────────────────────────────────
// El caso real de NFL y de amfoot: se valora la línea del CONSENSO (−2,5) y el mejor precio del tablero es
// de la casa que cotiza −3,5. Antes se pagaba 1,95 por una probabilidad que no era la de ese contrato.
const librosSpread = [
  { casa: 'pinnacle', familia: 'SPREAD', lado: 'home', linea: -2.5, cuota: 1.91, at: '2026-09-15T12:00:00Z' },
  { casa: 'draftkings', familia: 'SPREAD', lado: 'home', linea: -3.5, cuota: 2.10, at: '2026-09-15T12:00:30Z' },
  { casa: 'fanduel', familia: 'SPREAD', lado: 'home', linea: -2.5, cuota: 1.95, at: '2026-09-15T12:01:00Z' },
];
const mp = C.mejorPrecio(librosSpread, { familia: 'SPREAD', lado: 'home', linea: -2.5 });
igual('devuelve la fila entera, no una cuota suelta', typeof mp.fila === 'object' && mp.fila !== null, true);
igual('la casa viaja con el precio', mp.casa, 'fanduel');
cerca('la cuota es la mejor DE LA LÍNEA EVALUADA', mp.cuota, 1.95);
cerca('y la línea devuelta es la evaluada', mp.linea, -2.5);
igual('la cuota más alta del tablero (2,10) era de otra línea y no se usó', mp.cuota !== 2.10, true);
igual('el descarte se cuenta', mp.descartes.linea_distinta, 1);

// y cuando NADIE cotiza la línea evaluada, no se degrada a la de al lado: se dice que no hay precio
const soloOtras = C.mejorPrecio(librosSpread.filter((x) => x.linea === -3.5), { familia: 'SPREAD', lado: 'home', linea: -2.5 });
igual('sin nadie en la línea evaluada no hay fila', soloOtras.fila, null);
igual('y hay motivo escrito', /ninguna casa cotiza la línea evaluada/.test(soloOtras.motivo || ''), true);
igual('con su contador', soloOtras.descartes.linea_distinta, 1);

// el cuarto de punto NO se confunde con la línea entera de al lado
const cuartos = [
  { casa: 'cloudbet', familia: 'TOTAL', lado: 'over', linea: 2.25, cuota: 1.98 },
  { casa: 'cloudbet', familia: 'TOTAL', lado: 'over', linea: 2.5, cuota: 2.20 },
];
igual('over 2,25 no cobra el precio de over 2,5', C.mejorPrecio(cuartos, { familia: 'TOTAL', lado: 'over', linea: 2.25 }).cuota, 1.98);

// ── 2. A/B INVERTIDOS CON EL SIGNO DEL HÁNDICAP: MISMA CLAVE Y MISMO PAGO ───────────────────────────────
// La misma apuesta —los Chiefs dando 2,5— escrita por dos proveedores que ordenan el partido al revés.
const comoLaEscribeUno = {
  deporte: 'nfl', competicion: 'nfl', fase: 'regular', periodo: 'completo', reglas: 'incluye_prorroga',
  participantes: ['Chiefs', 'Broncos'], familia: 'SPREAD', seleccion: 'Chiefs', linea: -2.5, casa: 'pinnacle',
};
const comoLaEscribeElOtro = {
  deporte: 'nfl', competicion: 'nfl', fase: 'regular', periodo: 'completo', reglas: 'incluye_prorroga',
  participantes: ['Broncos', 'Chiefs'], familia: 'SPREAD', seleccion: 'Chiefs', linea: -2.5, casa: 'pinnacle',
};
igual('misma apuesta, orden invertido → MISMA clave canónica', C.clave(comoLaEscribeUno), C.clave(comoLaEscribeElOtro));
igual('y el pago es el mismo: la línea canónica no cambia de signo',
  C.partes(comoLaEscribeUno).linea_a, C.partes(comoLaEscribeElOtro).linea_a);
// la orientación se conserva como dato: se sabe cómo venía guardada
igual('la orientación se declara', C.partes(comoLaEscribeUno).orientacion, 'invertida');
igual('la orientación del otro también', C.partes(comoLaEscribeElOtro).orientacion, 'directa');

// las DOS CARAS del mismo mercado comparten mercado pero NO contrato
const caraA = { ...comoLaEscribeUno };
const caraB = { ...comoLaEscribeUno, seleccion: 'Broncos', linea: 2.5 };
igual('las dos caras comparten clave de mercado', C.claveMercado(caraA), C.claveMercado(caraB));
igual('pero no son el mismo contrato', C.clave(caraA) !== C.clave(caraB), true);
igual('las dos caras son la misma línea canónica', C.mismaLinea(caraA, caraB), true);

// EL ERROR QUE ESTE MÓDULO PROHÍBE: emparejar por valor absoluto. A−2,5/B+2,5 y A+2,5/B−2,5 son mercados
// distintos con pagos opuestos, y `abs(linea)` los daba por iguales.
const mercadoContrario = { ...comoLaEscribeUno, seleccion: 'Chiefs', linea: 2.5 };
igual('A−2,5 y A+2,5 NO son el mismo mercado', C.claveMercado(caraA) !== C.claveMercado(mercadoContrario), true);
igual('ni la misma línea', C.mismaLinea(caraA, mercadoContrario), false);
igual('aunque el valor absoluto coincida', Math.abs(-2.5) === Math.abs(2.5), true);

// en los totales la línea NO se voltea: over 2,5 y under 2,5 son el mismo 2,5
const over = { evento: 'x vs y', familia: 'TOTAL', seleccion: 'over', linea: 2.5, casa: 'cloudbet' };
const under = { evento: 'x vs y', familia: 'TOTAL', seleccion: 'under', linea: 2.5, casa: 'cloudbet' };
cerca('over 2,5 canónico', C.partes(over).linea_a, 2.5);
cerca('under 2,5 canónico (no se voltea)', C.partes(under).linea_a, 2.5);
igual('y comparten mercado', C.claveMercado(over), C.claveMercado(under));

// ── 3. CARAS DE MOMENTOS DISTINTOS: NO SE EMPAREJAN ─────────────────────────────────────────────────────
// Para desvigar hace falta la otra cara del MISMO contrato, la MISMA casa y la MISMA captura. Con caras de
// las 12:00 y de las 18:00 se fabrica un margen que nadie cobró.
const base = { evento: 'a vs b', familia: 'TOTAL', casa: 'cloudbet', linea: 2.5 };
const capturaOver = { ...base, seleccion: 'over', cuota: 1.95, at: '2026-09-15T12:00:00Z' };
const mismaCaptura = { ...base, seleccion: 'under', cuota: 1.92, at: '2026-09-15T12:00:20Z' };
const otraCaptura = { ...base, seleccion: 'under', cuota: 2.30, at: '2026-09-15T18:00:00Z' };
const otraCasa = { ...base, casa: 'pinnacle', seleccion: 'under', cuota: 2.05, at: '2026-09-15T12:00:10Z' };

igual('la cara contraria de la misma captura sí se empareja', C.parContrario(capturaOver, [mismaCaptura, otraCaptura]), mismaCaptura);
igual('la cara de otro momento NO se empareja', C.parContrario(capturaOver, [otraCaptura]), null);
const det = C.parContrario(capturaOver, [otraCaptura], { detalle: true });
igual('y se explica por qué', /momentos distintos/.test(det.motivo || ''), true);
igual('la cara de otra casa tampoco', C.parContrario(capturaOver, [otraCasa]), null);
const detCasa = C.parContrario(capturaOver, [otraCasa], { detalle: true });
igual('con su motivo', /misma casa/.test(detCasa.motivo || ''), true);
// el umbral es configurable: con una ventana de seis horas, esa misma pareja sí entra
igual('el umbral es configurable y se declara', C.parContrario(capturaOver, [otraCaptura], { toleranciaMs: 7 * 3600e3 }), otraCaptura);
// y la cara de OTRA LÍNEA no es la contraria de nada
igual('la contraria tiene que ser del mismo contrato',
  C.parContrario(capturaOver, [{ ...base, linea: 3.5, seleccion: 'under', cuota: 1.9, at: '2026-09-15T12:00:05Z' }]), null);

// ── 4. LA FILA ENTERA SOBREVIVE AL SELECTOR ─────────────────────────────────────────────────────────────
// El defecto original: `best()` devolvía un número y aguas abajo nadie sabía de qué línea era. Aquí la fila
// original viaja intacta, con todo lo que traía.
const conExtras = [{ casa: 'cloudbet', familia: 'TOTAL', lado: 'over', linea: 2.5, cuota: 1.99,
  at: '2026-09-15T12:00:00Z', max_stake: 240, market_id: 'TOTAL_GOALS_OVER_2_5' }];
const r = C.mejorPrecio(conExtras, { familia: 'TOTAL', lado: 'over', linea: 2.5 });
igual('la fila original viaja entera', r.fila.market_id, 'TOTAL_GOALS_OVER_2_5');
igual('con su profundidad', r.fila.max_stake, 240);
igual('y con su hora', r.at, Date.parse('2026-09-15T12:00:00Z'));
igual('la clave canónica del precio elegido viene puesta', typeof r.clave === 'string' && r.clave.includes('cloudbet'), true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
