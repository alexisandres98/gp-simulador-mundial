// scripts/esports-books-check.js — LA COMPROBACIÓN DE LOS ADAPTADORES DE CASAS (16-ago).
//
// POR QUÉ EXISTE. Las familias más valiosas de Bovada —prórroga del mapa, par/impar, kills y marcador
// exacto— SOLO abren en los partidos grandes y en las horas previas al inicio. Comprobar si se leen bien
// esperando a que estén vivas es comprobarlo en producción con dinero de por medio. Así que las respuestas
// reales se capturaron el 16-ago, se dejan aquí congeladas, y el parseo se verifica contra ellas.
//
// Cubre los dos fallos que de verdad ocurrieron y los dos que costarían más caro:
//   1. el marcador exacto de Bovada llega con `type` H/A en las CUATRO selecciones → leer el tipo antes que
//      la descripción colapsaba "2-0" y "2-1" en un solo lado llamado `home`.
//   2. la misma clave `2W-HCAP` es hándicap de mapas, de rondas y de KILLS según el grupo y el periodo.
//   3. el signo del hándicap: la línea que se guarda es SIEMPRE la del local, en las dos filas.
//   4. Pinnacle publica en AMERICANO: −172 es 1,5814 y no 1,72.
//
// Se corre con `node scripts/esports-books-check.js`. Sin red: son datos capturados.
'use strict';

const BOV = require('../data-providers/esports/bovada');
const PIN = require('../data-providers/esports/pinnacle');

let fail = 0;
const eq = (got, want, what) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('  ✗', what, '\n      esperaba', JSON.stringify(want), '\n      obtuvo  ', JSON.stringify(got)); }
  else console.log('  ✓', what);
};

// ---- respuesta REAL de Bovada, capturada el 16-ago (Astralis vs Ninjas in Pyjamas, EWC) ------------------
const P_GAME = { id: '12146', description: 'Game', abbreviation: 'G', live: false, main: true };
const P_MAP1 = { id: '12148', description: 'Map 1', abbreviation: 'Map {1}', live: false, main: false };
const px = (dec, hcap) => ({ decimal: String(dec), ...(hcap != null ? { handicap: String(hcap) } : {}) });

const EV = {
  id: '29641774', description: 'Astralis vs Ninjas in Pyjamas',
  competitors: [{ name: 'Astralis', home: true }, { name: 'Ninjas in Pyjamas', home: false }],
  displayGroups: [
    { description: 'Game Lines', markets: [
      { description: 'Moneyline', key: '2W-12', period: P_GAME, outcomes: [
        { description: 'Astralis', status: 'O', type: 'H', price: px(1.69) },
        { description: 'Ninjas in Pyjamas', status: 'O', type: 'A', price: px(2.10) }] },
      { description: 'Point Spread', key: '2W-HCAP', period: P_GAME, outcomes: [
        { description: 'Astralis', status: 'O', type: 'H', price: px(3.30, -1.5) },
        { description: 'Ninjas in Pyjamas', status: 'O', type: 'A', price: px(1.307692, 1.5) }] },
      { description: 'Total', key: '2W-OU', period: P_GAME, outcomes: [
        { description: 'Over', status: 'O', type: 'O', price: px(1.87, 2.5) },
        { description: 'Under', status: 'O', type: 'U', price: px(1.87, 2.5) }] },
      { description: 'Total', key: '2W-OU', period: P_MAP1, outcomes: [
        { description: 'Over - Map 1', status: 'O', type: 'O', price: px(1.909091, 21.5) },
        { description: 'Under - Map 1', status: 'O', type: 'U', price: px(1.833333, 21.5) }] },
      { description: 'Point Spread', key: '2W-HCAP', period: P_MAP1, outcomes: [
        { description: 'Astralis - Map 1', status: 'O', type: 'H', price: px(1.454545, 3.5) },
        { description: 'Ninjas in Pyjamas - Map 1', status: 'O', type: 'A', price: px(2.65, -3.5) }] } ] },
    { description: 'Kill Props', markets: [
      { description: 'Asian Handicap Kills', key: '2W-HCAP', period: P_MAP1, outcomes: [
        { description: 'Astralis - Map 1', status: 'O', type: 'H', price: px(2.05, -1.5) },
        { description: 'Ninjas in Pyjamas - Map 1', status: 'O', type: 'A', price: px(1.741, 1.5) }] },
      { description: 'Under/Over Kills', key: '2W-OU', period: P_MAP1, outcomes: [
        { description: 'Over - Map 1', status: 'O', type: 'O', price: px(1.588235, 131.5) },
        { description: 'Under - Map 1', status: 'O', type: 'U', price: px(2.30, 131.5) }] } ] },
    { description: 'Map Props', markets: [
      { description: 'Map will go to Overtime', key: 'GAME-PROP', period: P_MAP1, outcomes: [
        { description: 'Yes - Map 1', status: 'O', type: 'H', price: px(6.50) },
        { description: 'No - Map 1', status: 'O', type: 'A', price: px(1.090909) }] },
      { description: 'Total Map Rounds Odd/Even', key: 'GAME-PROP', period: P_MAP1, outcomes: [
        { description: 'Odd - Map 1', status: 'O', type: 'H', price: px(2.00) },
        { description: 'Even - Map 1', status: 'O', type: 'A', price: px(1.714286) }] },
      { description: 'Round 1 Winner', key: 'GAME-PROP', period: P_MAP1, outcomes: [
        { description: 'Astralis - Map 1', status: 'O', type: 'H', price: px(1.76923) },
        { description: 'Ninjas in Pyjamas - Map 1', status: 'O', type: 'A', price: px(1.909091) }] } ] },
    { description: 'Match Props', markets: [
      { description: 'Correct Score', key: 'GAME-PROP-DYN', period: P_GAME, outcomes: [
        { description: '2 - 0', status: 'O', type: 'H', price: px(3.40) },
        { description: '2 - 1', status: 'O', type: 'H', price: px(3.50) },
        { description: '0 - 2', status: 'O', type: 'A', price: px(4.00) },
        { description: '1 - 2', status: 'O', type: 'A', price: px(3.75) }] } ] },
    { description: 'Player Props', markets: [
      { description: "Total kills - Andrei 'arT' Piovezan", key: 'GAME-PROP', period: P_MAP1, outcomes: [
        { description: 'Over - Map 1', status: 'O', type: 'O', price: px(1.90, 17.5) }] } ] },
  ],
};

console.log('BOVADA · traducción a la taxonomía de GP');
const R = BOV.parseEvent(EV, 'cs2');
const find = (f, o = {}) => R.markets.filter((r) => r.family === f
  && (o.map === undefined || r.map === o.map) && (o.side === undefined || r.side === o.side));

eq(find('SERIE').map((r) => [r.side, r.odds]), [['home', 1.69], ['away', 2.1]], 'serie → SERIE home/away');
eq(find('HANDICAP').map((r) => [r.side, r.line]), [['home', -1.5], ['away', -1.5]],
  'hándicap de mapas: la línea del LOCAL en las dos filas (la del visitante llega +1.5 y se le da la vuelta)');
eq(find('TOTAL_MAPAS').map((r) => [r.side, r.line]), [['over', 2.5], ['under', 2.5]], 'total del periodo Game → TOTAL_MAPAS');
eq(find('RONDAS', { map: 1 }).map((r) => [r.side, r.line]), [['over', 21.5], ['under', 21.5]],
  'el MISMO mercado "Total" en periodo Map 1 → RONDAS, no TOTAL_MAPAS');
eq(find('RONDAS_HANDICAP', { map: 1 }).map((r) => [r.side, r.line]), [['home', 3.5], ['away', 3.5]],
  '"Point Spread" en Map 1 → hándicap de RONDAS (no de mapas), con la línea del local');
eq(find('KILLS_HANDICAP', { map: 1 }).map((r) => [r.side, r.line]), [['home', -1.5], ['away', -1.5]],
  'la MISMA clave 2W-HCAP bajo Kill Props → KILLS_HANDICAP, no hándicap de mapas');
eq(find('KILLS', { map: 1 }).map((r) => [r.side, r.line]), [['over', 131.5], ['under', 131.5]], 'Under/Over Kills → KILLS');
eq(find('PRORROGA', { map: 1 }).map((r) => r.side), ['yes', 'no'], 'prórroga: sí/no, NO home/away (el `type` dice H/A y miente)');
eq(find('PAR_IMPAR', { map: 1 }).map((r) => r.side), ['odd', 'even'], 'par/impar: odd/even, NO home/away');
eq(find('MARCADOR').map((r) => r.side), ['2:0', '2:1', '0:2', '1:2'],
  'marcador exacto: CUATRO lados distintos con formato x:y — este es el fallo que se cazó');
eq(R.markets.filter((r) => /Round 1 Winner/.test(r.market_key)).length, 0, 'ronda 1: familia que el motor no modela → se ignora en silencio');
eq(R.markets.filter((r) => /Total kills - /.test(r.market_key)).length, 0, 'props de jugador → fuera (GP no modela rendimiento individual)');

// ---- Pinnacle: americano → decimal, y la línea del local ------------------------------------------------
console.log('\nPINNACLE · conversión y convención');
eq(PIN.amToDec(-172), 1.5814, 'americano −172 → 1,5814 decimal (confundirlo con 1,72 inventa 10 pp de ventaja)');
eq(PIN.amToDec(141), 2.41, 'americano +141 → 2,41 decimal');
eq(PIN.amToDec(-1139), 1.0878, 'un favorísimo: −1139 → 1,0878');
eq([PIN.gameOfLeague('CS2 - Esports World Cup'), PIN.gameOfLeague('League of Legends - LEC'),
  PIN.gameOfLeague('Valorant - Champions Tour: EMEA'), PIN.gameOfLeague('Dota 2 - The International'),
  PIN.gameOfLeague('Rocket League - RLCS')],
['cs2', 'lol', 'valorant', 'dota2', undefined], 'el juego se lee del nombre de la liga, y lo que no casa no entra');

// una cuota decimal y su implícita tienen que cerrar: dos lados sin margen suman 1
const p = 1 / PIN.amToDec(-172) + 1 / PIN.amToDec(141);
console.log(`  · margen de esa serie en Pinnacle: ${((p - 1) * 100).toFixed(2)} %` +
  (p > 1 && p < 1.09 ? '  ✓ (rango creíble para una casa afilada)' : '  ✗ FUERA DE RANGO'));
if (!(p > 1 && p < 1.09)) fail++;

console.log(fail ? `\n${fail} COMPROBACIONES FALLIDAS` : '\nTodo correcto.');
process.exit(fail ? 1 : 0);
