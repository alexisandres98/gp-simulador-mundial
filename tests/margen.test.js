// tests/margen.test.js — EL MARGEN NO SE MIDE ENTRE PARTIDOS DISTINTOS (16-sep, A4)
//
// Este test existe por un fallo real que estuvo cinco días dando números a la doctrina. `claveMercado` no
// incluía el partido, así que todas las filas con la misma casa, familia y línea caían en el mismo cubo
// aunque vinieran de partidos distintos; y como de cada cara se queda la de MEJOR cuota, se emparejaba el
// over de un partido con el under de otro. El resultado tenía la cara de una medición y era un arbitraje
// imaginario: `cs2 · bovada · KILLS` salía con margen EXACTAMENTE 0 %.
'use strict';
const MG = require('../lib/margen');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// Dos partidos, misma casa, misma familia, misma línea. Cada uno cobra un 5,26 % de sobre-redondeo
// (1.90/1.90), pero los precios están cruzados: el over caro está en uno y el under caro en el otro. Quien
// los mezcle verá un mercado a 2.00/2.00 — margen cero — que no existe en ninguna de las dos casas.
const dosPartidos = [
  { event_id: 'p1', book: 'casa', family: 'KILLS', line: 25.5, side: 'over', odds: 2.00 },
  { event_id: 'p1', book: 'casa', family: 'KILLS', line: 25.5, side: 'under', odds: 1.81 },
  { event_id: 'p2', book: 'casa', family: 'KILLS', line: 25.5, side: 'over', odds: 1.81 },
  { event_id: 'p2', book: 'casa', family: 'KILLS', line: 25.5, side: 'under', odds: 2.00 },
];

const r = MG.resumen(dosPartidos, { porCasa: false });
t('los dos partidos se miden por separado', r.KILLS && r.KILLS.n === 2, r.KILLS ? `n ${r.KILLS.n}` : 'sin familia');
const over = r.KILLS && r.KILLS.over_mediana_pct;
t('y el sobre-redondeo es el de verdad, no cero', over > 5 && over < 6, `${over} %`);
t('el margen por lado es la mitad', Math.abs(r.KILLS.margen_lado_pct - over / 2) < 0.02);

// EL COSTE EN ESPERANZA NO ES LA MITAD DEL SOBRE-REDONDEO. Cruzar un mercado con sobre-redondeo R cuesta
// R/(1+R), que para márgenes pequeños se parece a R/2 y para los caros no.
t('el coste en esperanza se informa aparte', Math.abs(r.KILLS.coste_ev_pct - 100 * ((over / 100) / (1 + over / 100))) < 0.02,
  `${r.KILLS.coste_ev_pct} % vs lado ${r.KILLS.margen_lado_pct} %`);

// ── SIN PARTIDO NO HAY MERCADO ──────────────────────────────────────────────────────────────────────────
const sinEvento = dosPartidos.map(({ event_id, ...x }) => x);   // eslint-disable-line no-unused-vars
const r2 = MG.resumen(sinEvento, { porCasa: false });
t('las filas sin partido NO se emparejan', !r2.KILLS, r2.KILLS ? `salió n ${r2.KILLS.n}` : 'ninguna');
t('y se cuentan para que se sepa', r2._filas && r2._filas.sin_evento === 4, JSON.stringify(r2._filas));

// ── EL FALLO ORIGINAL, RECONSTRUIDO ─────────────────────────────────────────────────────────────────────
// Con la clave vieja (sin partido) estos cuatro precios daban margen cero. Se comprueba que hoy NO.
t('el arbitraje imaginario entre partidos ya no aparece', over !== 0 && r.KILLS.margen_lado_pct > 2.5,
  `lado ${r.KILLS.margen_lado_pct} %`);

// ── UN HÁNDICAP SIGUE EMPAREJANDO +L CON −L, DENTRO DEL MISMO PARTIDO ───────────────────────────────────
const hcp = [
  { event_id: 'p1', book: 'casa', family: 'RONDAS_HANDICAP', line: 2.5, side: 'home', odds: 1.90 },
  { event_id: 'p1', book: 'casa', family: 'RONDAS_HANDICAP', line: -2.5, side: 'away', odds: 1.90 },
  { event_id: 'p2', book: 'casa', family: 'RONDAS_HANDICAP', line: 2.5, side: 'home', odds: 1.95 },
  { event_id: 'p2', book: 'casa', family: 'RONDAS_HANDICAP', line: -2.5, side: 'away', odds: 1.85 },
];
const r3 = MG.resumen(hcp, { porCasa: false });
t('el hándicap empareja +L con −L y da dos mercados', r3.RONDAS_HANDICAP && r3.RONDAS_HANDICAP.n === 2,
  r3.RONDAS_HANDICAP ? `n ${r3.RONDAS_HANDICAP.n}` : 'sin familia');

// ── OTROS NOMBRES DEL PARTIDO ───────────────────────────────────────────────────────────────────────────
// Cada motor lo llama a su manera y el módulo tiene que reconocerlos todos: si no, «sin partido» tapa
// archivos enteros y el margen desaparece justo donde hay datos.
for (const campo of ['event_id', 'match_id', 'series_id', 'game_id', 'fixture_id', 'ceid', 'cb_event_id', 'partido_id', 'evento']) {
  const fila = { [campo]: 'x1', book: 'c', family: 'F', line: 1, side: 'over', odds: 2 };
  t(`se reconoce el partido en \`${campo}\``, MG.eventoDe(fila) === 'x1', String(MG.eventoDe(fila)));
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
