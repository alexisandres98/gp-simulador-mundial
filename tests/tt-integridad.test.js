// tests/tt-integridad.test.js — EL CLASIFICADOR DE COMPETICIONES DE TENIS DE MESA (T0.3, 15-sep-2026)
//
// Por qué existe. Hasta el 15-sep, `integrityOf('WTT Star Contender Astana, WS')` devolvía RESTRICTED: el
// patrón `tt star`, escrito para el circuito privado "TT Star Series", casaba dentro de "W·tt star·
// Contender". Como la lista de privadas se evaluaba antes que la del organizador oficial, una categoría
// entera del calendario WTT quedaba fuera del modelo y de la sombra sin que nadie lo viera: la sonda solo
// decía "0 señales" y el calendario, "0 partidos con mercado".
//
// Qué fija este test: el organizador oficial manda, los circuitos privados siguen fuera, y ningún evento
// oficial cae por el país donde se juega.
'use strict';
const R = require('../tt-engine/rules');
const V = R.INTEGRITY.VERIFIED_SCOPE, X = R.INTEGRITY.RESTRICTED;

const CASOS = [
  // el fallo que motivó el test: Star Contender es categoría oficial de la WTT
  ['WTT Star Contender Astana, WS', V],
  ['WTT Star Contender Astana, MS', V],
  ['WTT Star Contender Doha', V],
  ['WTT Star Contender Ljubljana', V],
  // el circuito privado que el patrón quería cazar sigue cazado
  ['TT Star Series', X],
  ['TT Star', X],
  // oficiales celebradas en países que aparecen en la lista de privadas
  ['WTT Contender Prague Czech', V],
  ['ITTF Czech Open', V],
  ['WTT Contender Almaty Kazakhstan Open', V],
  ['ITTF Russia Open', V],
  // oficiales que ya funcionaban
  ['WTT Feeder Bangkok, WS', V],
  ['WTT Feeder Bangkok, MD', V],
  ['WTT Champions Macao, MS', V],
  ['WTT Contender Panagyurishte', V],
  // privadas de apuestas: fuera
  ['Czech Liga Pro', X],
  ['Setka Cup', X],
  ['Liga Pro', X],
  ['TT Cup', X],
  ['Moscow Liga Pro', X],
  ['Ukraine Win Cup', X],
  ['Armenia Elite Series', X],
  // sin nombre: restringida por defecto
  ['', X],
  [null, X],
];

let fallos = 0;
for (const [nombre, esperado] of CASOS) {
  const real = R.integrityOf(nombre);
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${String(nombre).padEnd(38)} esperado ${esperado.padEnd(15)} real ${real}`);
}

// la etiqueta y la nota de cada estado tienen que existir para pintarlas
for (const k of Object.values(R.INTEGRITY)) {
  if (!R.INTEGRITY_LABEL[k]) { console.log('FALLA  sin etiqueta para', k); fallos++; }
}

console.log(fallos ? `\n${fallos} FALLOS de ${CASOS.length}` : `\n${CASOS.length} casos, todos correctos`);
process.exit(fallos ? 1 : 0);
