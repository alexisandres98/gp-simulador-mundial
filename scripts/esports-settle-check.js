// scripts/esports-settle-check.js — LA COMPROBACIÓN DE LA LIQUIDACIÓN (16-ago).
//
// POR QUÉ EXISTE Y POR QUÉ IMPORTA MÁS QUE LAS OTRAS PRUEBAS. Una pick mal liquidada no rompe nada: se
// guarda tan tranquila, entra en el histórico y a los tres meses el ROI y el CLV están contando una historia
// falsa sin dejar rastro. Es el peor tipo de error de esta casa —el que no se ve— y por eso el veredicto de
// cada familia se comprueba contra un resultado REAL con la cuenta hecha a mano.
//
// El partido de referencia se capturó de bo3 el 16-ago:
//     Basement Boys 2-1 INOX Division · ancient 16-12 (OT) · nuke 7-13 · dust2 13-11
// Con eso, cada familia tiene una respuesta que se puede verificar sin creerle al código.
//
// Se corre con `node scripts/esports-settle-check.js`. Sin red en la parte de veredictos; al final hace una
// pasada CONTRA LA FUENTE VIVA para confirmar que sigue sirviendo resultados con el detalle que hace falta.
'use strict';

const ES = require('../esports-engine/store');
const RES = require('../data-providers/esports/results');

let fail = 0;
const eq = (got, want, what) => {
  if (got !== want) { fail++; console.log(`  ✗ ${what}\n      esperaba ${want}, obtuvo ${got}`); }
  else console.log(`  ✓ ${what} → ${got}`);
};

// El resultado real, con el LOCAL de la pick = Basement Boys (lado `a`).
const R = {
  source: 'bo3', a: 'Basement Boys', b: 'INOX Division',
  maps_a: 2, maps_b: 1,
  maps: [
    { n: 1, map: 'ancient', rounds: 28, ot: 1, score_a: 16, score_b: 12 },
    { n: 2, map: 'nuke', rounds: 20, ot: 0, score_a: 7, score_b: 13 },
    { n: 3, map: 'dust2', rounds: 24, ot: 0, score_a: 13, score_b: 11 },
  ],
};
const pk = (o) => ({ line: null, side: null, map: null, team: null, ...o });

console.log('SERIE  ·  Basement Boys 2-1 INOX Division');
eq(ES.settleOne(pk({ family: 'TOTAL_MAPAS', line: 2.5, side: 'over' }), R), 'WIN', 'total de mapas: más de 2.5 con 3 jugados');
eq(ES.settleOne(pk({ family: 'TOTAL_MAPAS', line: 2.5, side: 'under' }), R), 'LOSS', 'total de mapas: menos de 2.5 con 3 jugados');
eq(ES.settleOne(pk({ family: 'TOTAL_MAPAS', line: 3, side: 'over' }), R), 'PUSH', 'línea entera clavada (3 mapas, línea 3) devuelve la apuesta');
// EL SIGNO DEL HÁNDICAP: la línea guardada es SIEMPRE la del local y el visitante juega su negación. Es la
// convención de todo el motor y donde un error se paga más caro, así que se comprueba en los dos sentidos.
eq(ES.settleOne(pk({ family: 'HANDICAP', line: -1.5, side: 'home' }), R), 'LOSS', 'hándicap: local −1.5 con la serie ganada 2-1');
eq(ES.settleOne(pk({ family: 'HANDICAP', line: 1.5, side: 'home' }), R), 'WIN', 'hándicap: local +1.5');
eq(ES.settleOne(pk({ family: 'HANDICAP', line: -1.5, side: 'away' }), R), 'WIN', 'hándicap: visitante con la línea del local en −1.5 (o sea, visitante +1.5)');
eq(ES.settleOne(pk({ family: 'HANDICAP', line: 1.5, side: 'away' }), R), 'LOSS', 'hándicap: visitante con la línea del local en +1.5 (visitante −1.5)');

console.log('\nRONDAS  ·  ancient 28 (OT) · nuke 20 · dust2 24');
eq(ES.settleOne(pk({ family: 'RONDAS', map: 1, line: 21.5, side: 'over' }), R), 'WIN', 'mapa 1: más de 21.5 con 28 rondas');
eq(ES.settleOne(pk({ family: 'RONDAS', map: 2, line: 21.5, side: 'under' }), R), 'WIN', 'mapa 2: menos de 21.5 con 20 rondas');
eq(ES.settleOne(pk({ family: 'RONDAS', map: 2, line: 21.5, side: 'over' }), R), 'LOSS', 'mapa 2: más de 21.5 con 20 rondas');
eq(ES.settleOne(pk({ family: 'RONDAS', map: 3, line: 24, side: 'over' }), R), 'PUSH', 'mapa 3: línea entera 24 con 24 rondas');
eq(ES.settleOne(pk({ family: 'RONDAS', map: 4, line: 21.5, side: 'over' }), R), null, 'un mapa que NO se jugó queda SIN liquidar, no perdido');

console.log('\nPRÓRROGA  ·  solo el mapa 1 la tuvo');
eq(ES.settleOne(pk({ family: 'PRORROGA', map: 1, side: 'yes' }), R), 'WIN', 'mapa 1: sí prórroga');
eq(ES.settleOne(pk({ family: 'PRORROGA', map: 1, side: 'no' }), R), 'LOSS', 'mapa 1: no prórroga');
eq(ES.settleOne(pk({ family: 'PRORROGA', map: 2, side: 'no' }), R), 'WIN', 'mapa 2: no prórroga');

console.log('\nRONDAS POR EQUIPO  ·  nuke 7-13');
eq(ES.settleOne(pk({ family: 'RONDAS_EQUIPO', map: 2, team: 'home', line: 12.5, side: 'over' }), R), 'LOSS', 'local más de 12.5 con 7 rondas');
eq(ES.settleOne(pk({ family: 'RONDAS_EQUIPO', map: 2, team: 'away', line: 12.5, side: 'over' }), R), 'WIN', 'visitante más de 12.5 con 13 rondas');
eq(ES.settleOne(pk({ family: 'RONDAS_EQUIPO', map: 2, team: 'home', line: 7, side: 'under' }), R), 'PUSH', 'línea entera clavada en el total del equipo');

console.log('\nHÁNDICAP DE RONDAS  ·  ancient 16-12 (margen local +4)');
eq(ES.settleOne(pk({ family: 'RONDAS_HANDICAP', map: 1, line: -2.5, side: 'home' }), R), 'WIN', 'local −2.5 con margen +4');
eq(ES.settleOne(pk({ family: 'RONDAS_HANDICAP', map: 1, line: -2.5, side: 'away' }), R), 'LOSS', 'visitante (línea del local −2.5) con margen +4');
eq(ES.settleOne(pk({ family: 'RONDAS_HANDICAP', map: 1, line: -4, side: 'home' }), R), 'PUSH', 'línea entera igual al margen: devuelve');
eq(ES.settleOne(pk({ family: 'RONDAS_HANDICAP', map: 2, line: -2.5, side: 'away' }), R), 'WIN', 'mapa 2: margen local −6, visitante cubre');

console.log('\nLO QUE **NO** SE PUEDE LIQUIDAR, y se dice en vez de aproximarlo');
eq(ES.settleOne(pk({ family: 'KILLS', map: 1, line: 131.5, side: 'over' }), R), null, 'kills: bo3 no publica kills por mapa → sin liquidar');
eq(ES.settleOne(pk({ family: 'KILLS_HANDICAP', map: 1, line: -1.5, side: 'home' }), R), null, 'hándicap de kills → sin liquidar');

(async () => {
  console.log('\nLA FUENTE VIVA  ·  ¿sigue sirviendo lo que hace falta?');
  const since = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  for (const g of ['cs2', 'dota2', 'lol', 'valorant']) {
    const r = await RES.results(g, { since, max: 60 }).catch(() => null);
    const rows = (r && r.rows) || [];
    const conRondas = rows.filter((x) => (x.maps || []).some((m) => m.rounds != null)).length;
    const ok = g === 'valorant' ? !r.available : (r && r.available && rows.length > 0);
    if (!ok) fail++;
    console.log(`  ${ok ? '✓' : '✗'} ${g.padEnd(9)} ${r && r.available ? 'fuente ' + r.source : 'SIN FUENTE'} · ${rows.length} partidos` +
      (g === 'cs2' ? ` · ${conRondas} con detalle de rondas` : ''));
  }
  console.log(fail ? `\n${fail} COMPROBACIONES FALLIDAS` : '\nTodo correcto.');
  process.exit(fail ? 1 : 0);
})();
