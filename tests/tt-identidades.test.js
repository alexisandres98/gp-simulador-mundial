// tests/tt-identidades.test.js — LAS DOS IDENTIDADES DE PAGO DEL TENIS DE MESA (T2.12, 15-sep-2026)
//
//   node tests/tt-identidades.test.js
//
// POR QUÉ EXISTE. El reglamento deja dos huecos en las escalas, y donde hay un hueco hay dos apuestas con
// nombres distintos que pagan exactamente igual:
//
//   1. Dentro de un game, un hándicap de −1,5 puntos ES ganar el game. El margen mínimo son dos puntos
//      (hay que ganar por dos), así que no existe ningún resultado en el que se gane el game y no se cubra
//      el −1,5. Vale para cualquier línea dentro de (−2, 2).
//   2. "Más de 20,5 puntos" y "más de 21,5 puntos" en un game son la MISMA apuesta, y las dos son "hay
//      deuce". El total 21 no existe: un game no puede acabar 11–10, y a partir del deuce los totales solo
//      pueden ser pares.
//
// Sirven de prueba del CATÁLOGO y de los PRECIOS a la vez:
//   · como PRECIO, las tres probabilidades tienen que coincidir dígito a dígito. Si no coinciden, el
//     compilador se está contradiciendo consigo mismo y cualquier ventaja medida sobre una de las tres es
//     una ventaja contra nuestro propio error de redondeo.
//   · como CATÁLOGO, las tres selecciones tienen que caer en la MISMA clase de equivalencia. Si no, el
//     sistema puede registrar tres tesis para una sola apuesta, inflar la muestra y correlacionar el track
//     — que es exactamente lo que apilar líneas de tarjetas del mismo partido costó (−17,63 % de ROI).
//
// Qué NO prueba: que haya ventaja en ninguna de ellas. Solo que el motor no se contradice.
'use strict';

const C = require('../tt-engine/compiler');
const R = require('../tt-engine/rules');

let fallos = 0, avisos = 0, casos = 0;
const ok = (cond, texto, detalle) => { casos++; if (!cond) fallos++; console.log(`${cond ? 'ok   ' : 'FALLA'}  ${texto}${detalle ? '  ' + detalle : ''}`); };
const num = (x) => (Number.isFinite(x) ? x.toExponential(2) : String(x));

// la parrilla: dos jugadores parejos, uno favorito, uno aplastante; los dos formatos; los tres sorteos
const PARES = [[0.5, 0.5], [0.54, 0.48], [0.58, 0.47], [0.62, 0.55], [0.47, 0.41]];
const BOS = [3, 5, 7];
const PRIMEROS = ['a', 'b', null];

// TOLERANCIAS, y por qué son las que son. El compilador trunca la cola del deuce con un ε explícito
// (`EPS_TAIL = 1e-11` en compiler.js) y NUNCA adjudica la masa residual a un ganador: por eso "más de 20,5"
// puede quedarse a ~5e-12 de P(deuce) en vez de a cero exacto. Un hándicap de game contra el ganador del
// game no tiene truncamiento de por medio y tiene que coincidir a coma flotante.
const TOL_DEUCE = 1e-9;       // holgura sobre el ε de la cola, tres órdenes por encima
const TOL_EXACTA = 1e-12;

console.log('══ 1. PRECIOS: las tres probabilidades del compilador ══════════════════════════════════════');
let peorDeuce = 0, peorHcp = 0, peorLineas = 0;
for (const [a, b] of PARES) for (const bo of BOS) for (const first of PRIMEROS) {
  const mm = C.compileMatch(a, b, { best_of: bo, first });
  const o205 = C.probOf(mm, 'GAME_POINTS_TOTAL', 'over', 20.5, 1);
  const o215 = C.probOf(mm, 'GAME_POINTS_TOTAL', 'over', 21.5, 1);
  const deuce = C.probOf(mm, 'GAME_DEUCE', 'yes', null, 1);
  const hcp15 = C.probOf(mm, 'GAME_POINTS_HCP', 'a', -1.5, 1);
  const hcp05 = C.probOf(mm, 'GAME_POINTS_HCP', 'a', -0.5, 1);
  const gml = C.probOf(mm, 'GAME_ML', 'a', null, 1);
  peorLineas = Math.max(peorLineas, Math.abs(o205 - o215));
  peorDeuce = Math.max(peorDeuce, Math.abs(o205 - deuce));
  peorHcp = Math.max(peorHcp, Math.abs(hcp15 - gml), Math.abs(hcp05 - gml));
  // las caras contrarias también: under 20,5 ≡ under 21,5 ≡ deuce no
  peorDeuce = Math.max(peorDeuce, Math.abs(C.probOf(mm, 'GAME_POINTS_TOTAL', 'under', 20.5, 1) - C.probOf(mm, 'GAME_DEUCE', 'no', null, 1)));
}
ok(peorLineas <= TOL_EXACTA, 'más de 20,5 ≡ más de 21,5 (el total 21 no existe)', `peor desvío ${num(peorLineas)}`);
ok(peorDeuce <= TOL_DEUCE, 'más de 20,5 ≡ P(deuce) (dentro del ε de la cola truncada)', `peor desvío ${num(peorDeuce)}`);
ok(peorHcp <= TOL_EXACTA, 'hándicap de game −1,5 y −0,5 ≡ ganar el game', `peor desvío ${num(peorHcp)}`);

console.log('\n══ 2. CATÁLOGO: las clases de equivalencia de pago ═════════════════════════════════════════');
const K = (f, s, l, g, bo) => R.equivalenceKey(f, s, l, g, bo);
const MISMAS = [
  ['el deuce y sus dos líneas', [K('GAME_POINTS_TOTAL', 'over', 20.5, 1, 5), K('GAME_POINTS_TOTAL', 'over', 21.5, 1, 5), K('GAME_DEUCE', 'yes', null, 1, 5)]],
  ['la cara contraria del deuce', [K('GAME_POINTS_TOTAL', 'under', 20.5, 1, 5), K('GAME_POINTS_TOTAL', 'under', 21.5, 1, 5), K('GAME_DEUCE', 'no', null, 1, 5)]],
  ['ganar el game y sus hándicaps', [K('GAME_ML', 'a', null, 1, 5), K('GAME_POINTS_HCP', 'a', -1.5, 1, 5), K('GAME_POINTS_HCP', 'a', -0.5, 1, 5), K('GAME_POINTS_HCP', 'a', 1.5, 1, 5)]],
  ['ganar el partido y el hándicap de games', [K('ML', 'a', null, null, 5), K('GAMES_HCP', 'a', -0.5, null, 5), K('GAMES_HCP', 'a', 0.5, null, 5)]],
  ['deuce de dos bloques', [K('GAME_POINTS_TOTAL', 'over', 22.5, 1, 5), K('GAME_POINTS_TOTAL', 'over', 23.5, 1, 5)]],
];
for (const [texto, claves] of MISMAS) ok(claves.every((k) => k && k === claves[0]), `misma clase: ${texto}`, claves.join(' · '));
const DISTINTAS = [
  ['más de 19,5 NO es el deuce', K('GAME_POINTS_TOTAL', 'over', 19.5, 1, 5), K('GAME_DEUCE', 'yes', null, 1, 5)],
  ['hándicap −2,5 NO es ganar el game', K('GAME_POINTS_HCP', 'a', -2.5, 1, 5), K('GAME_ML', 'a', null, 1, 5)],
  ['hándicap de games −1,5 NO es ganar el partido', K('GAMES_HCP', 'a', -1.5, null, 5), K('ML', 'a', null, null, 5)],
  ['el game 1 y el game 2 no se mezclan', K('GAME_DEUCE', 'yes', null, 1, 5), K('GAME_DEUCE', 'yes', null, 2, 5)],
  ['los dos lados no se mezclan', K('GAME_ML', 'a', null, 1, 5), K('GAME_ML', 'b', null, 1, 5)],
];
for (const [texto, k1, k2] of DISTINTAS) ok(k1 !== k2, `clases distintas: ${texto}`, `${k1} ≠ ${k2}`);

// la clase tiene que predecir el precio: si dos selecciones comparten clave, el compilador tiene que darles
// la misma probabilidad. Es la prueba que une las dos mitades del test.
console.log('\n══ 3. CLASE Y PRECIO TIENEN QUE IR JUNTOS ══════════════════════════════════════════════════');
const SELECCIONES = [
  ['GAME_POINTS_TOTAL', 'over', 20.5, 1], ['GAME_POINTS_TOTAL', 'over', 21.5, 1], ['GAME_DEUCE', 'yes', null, 1],
  ['GAME_POINTS_TOTAL', 'under', 20.5, 1], ['GAME_POINTS_TOTAL', 'under', 21.5, 1], ['GAME_DEUCE', 'no', null, 1],
  ['GAME_ML', 'a', null, 1], ['GAME_POINTS_HCP', 'a', -1.5, 1], ['GAME_POINTS_HCP', 'a', 1.5, 1],
  ['GAME_ML', 'b', null, 1], ['GAME_POINTS_HCP', 'b', 1.5, 1],
  ['ML', 'a', null, null], ['GAMES_HCP', 'a', -0.5, null],
  ['GAME_POINTS_TOTAL', 'over', 19.5, 1], ['GAME_POINTS_HCP', 'a', -2.5, 1], ['GAMES_HCP', 'a', -1.5, null],
];
let peorClase = 0, paresComprobados = 0;
for (const [a, b] of PARES) for (const bo of [5, 7]) {
  const mm = C.compileMatch(a, b, { best_of: bo, first: 'a' });
  const filas = SELECCIONES.map(([f, s, l, g]) => ({ f, s, l, g, k: K(f, s, l, g, bo), p: C.probOf(mm, f, s, l, g || 1) }))
    .filter((x) => x.k && Number.isFinite(x.p));
  const porClave = new Map();
  for (const x of filas) { if (!porClave.has(x.k)) porClave.set(x.k, []); porClave.get(x.k).push(x); }
  for (const grupo of porClave.values()) {
    for (let i = 1; i < grupo.length; i++) { peorClase = Math.max(peorClase, Math.abs(grupo[i].p - grupo[0].p)); paresComprobados++; }
  }
}
ok(peorClase <= TOL_DEUCE, `misma clase ⇒ mismo precio (${paresComprobados} parejas)`, `peor desvío ${num(peorClase)}`);

console.log('\n══ 4. EL OBJETO QUE SE SIRVE (recortado para pintarlo) ═════════════════════════════════════');
// `tt-engine/store.js` recorta las distribuciones antes de servirlas (`trim(g1.total, 0.0005)`) para no
// mandar 130 pares por partido a un móvil. Eso NO afecta al precio —`evaluateEdges` lee la distribución
// entera— pero sí a quien lea P(over 20,5) del objeto servido: la cola del deuce son muchas casillas
// diminutas y el recorte se las come. Aquí se mide cuánto, para que el número esté escrito en alguna parte.
const trim = (pares, eps) => (pares || []).filter(([, p]) => p > eps).map(([k, p]) => [k, +p.toFixed(4)]);
let peorServido = 0, peorMasa = 0;
for (const [a, b] of PARES) for (const bo of [5, 7]) {
  const mm = C.compileMatch(a, b, { best_of: bo, first: 'a' });
  const g1 = C.gameFor(mm, 1);
  peorServido = Math.max(peorServido, Math.abs(C.over(g1.total, 20.5) - C.over(trim(g1.total, 0.0005), 20.5)));
  peorMasa = Math.max(peorMasa, Math.abs(1 - trim(mm.points_total, 0.0003).reduce((s, x) => s + x[1], 0)));
}
ok(peorServido < 0.002, 'el recorte de display no mueve P(deuce) más de 0,2 pp', `peor ${(100 * peorServido).toFixed(3)} pp`);
ok(peorMasa < 0.01, 'la distribución de puntos servida conserva ≥ 99 % de la masa', `peor pérdida ${(100 * peorMasa).toFixed(3)} pp`);
if (peorServido > 1e-9) { avisos++; console.log(`AVISO  el objeto SERVIDO no cumple la identidad al dígito: P(más de 20,5) leída ahí se queda ${(100 * peorServido).toFixed(3)} pp corta. El precio no lo usa; una lectura de pantalla sí.`); }

console.log('\n══ 5. EL CATÁLOGO NO PUEDE REGISTRAR DOS VECES LA MISMA APUESTA ════════════════════════════');
// El dedupe del catálogo es por `familia|lado|línea|game`, así que sin agrupar por clase de pago las tres
// selecciones equivalentes sobreviven como tres candidatas. Se comprueba sobre las claves, que es donde
// vive la regla; el efecto sobre el libro depende de qué cotice la casa (Cloudbet no publica el deuce;
// Bovada sí, y también líneas alternativas de total de game).
const PARRILLA = [
  { family: 'GAME_POINTS_TOTAL', side: 'over', line: 20.5, game: 1 },
  { family: 'GAME_POINTS_TOTAL', side: 'over', line: 21.5, game: 1 },
  { family: 'GAME_DEUCE', side: 'yes', line: null, game: 1 },
  { family: 'GAME_ML', side: 'a', line: null, game: 1 },
  { family: 'GAME_POINTS_HCP', side: 'a', line: -1.5, game: 1 },
];
const claveVieja = (c) => `${c.family}|${c.side}|${c.line}|${c.game}`;
const distintasViejas = new Set(PARRILLA.map(claveVieja)).size;
const distintasNuevas = new Set(PARRILLA.map((c) => K(c.family, c.side, c.line, c.game, 5))).size;
ok(distintasViejas === 5, 'el dedupe de hoy (familia|lado|línea|game) ve 5 selecciones distintas', `${distintasViejas}`);
ok(distintasNuevas === 2, 'por clase de pago solo hay 2 apuestas de verdad (el deuce y ganar el game)', `${distintasNuevas}`);
console.log(`AVISO  el catálogo de producción sigue contando ${distintasViejas} y no ${distintasNuevas}: ` +
  'las candidatas se ETIQUETAN con su clase (`equiv`, `equiv_dup`) pero solo se agrupan con GP_TT_DEDUP_EQUIV. ' +
  'Cambiar el agrupamiento cambia qué tesis nacen y eso es decisión, no arreglo.');
avisos++;

console.log(`\n${casos} comprobaciones · ${fallos} fallos · ${avisos} avisos`);
process.exit(fallos ? 1 : 0);
