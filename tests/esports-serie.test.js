// tests/esports-serie.test.js — UNA SERIE A MEDIAS NO LIQUIDA NADA DE LA SERIE (16-sep-2026, D-Dota)
//
// EL FALLO QUE FIJA ESTE TEST. OpenDota publica los partidos SEGÚN TERMINAN y la serie se reconstruye
// agrupando por `series_id`. Un BO3 con el mapa 1 jugado llega al liquidador como una fila perfectamente
// formada que dice `maps_a: 1, maps_b: 0` — indistinguible, mirándola sola, de un BO3 que acabó 1-0 por
// incomparecencia. Y las familias de SERIE se liquidaban con ella: un "menos de 2,5 mapas" se daba por
// ganado en cuanto acababa el primer mapa, cuando todavía podía acabar 2-1.
//
// El dato que rompe el empate ya viajaba en la pick y nadie lo miraba: `bo`.
//
// La otra mitad del test: las familias de MAPA sí se liquidan con la serie a medias, y tienen que seguir
// haciéndolo. Si la puerta las bloqueara, "menos de 24,5 rondas en el mapa 1" esperaría a que acabe una
// serie que ya no le afecta — y eso las mandaría a la caducidad de 21 días sin motivo.
'use strict';
const ES = require('../esports-engine/store');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// Un BO3 del que solo se ha jugado el primer mapa: A lo ganó 1-0 en mapas.
const A_MEDIAS = { maps_a: 1, maps_b: 0, has_rounds: true, has_kills: true, source: 'opendota',
  maps: [{ n: 1, map: 'g1', score_a: 1, score_b: 0, rounds: 42, kills_a: 28, kills_b: 19, ot: 0 }] };
// El mismo BO3, terminado 2-1.
const TERMINADA = { maps_a: 2, maps_b: 1, has_rounds: true, has_kills: true, source: 'opendota',
  maps: [{ n: 1, map: 'g1', score_a: 1, score_b: 0, rounds: 42, kills_a: 28, kills_b: 19, ot: 0 },
    { n: 2, map: 'g2', score_a: 0, score_b: 1, rounds: 38, kills_a: 15, kills_b: 24, ot: 0 },
    { n: 3, map: 'g3', score_a: 1, score_b: 0, rounds: 45, kills_a: 30, kills_b: 22, ot: 0 }] };

// ── 1. LAS FAMILIAS DE SERIE ESPERAN ────────────────────────────────────────────────────────────────────
// "menos de 2,5 mapas" con la serie 1-0 GANARÍA si se liquidara ahora, y perdería si acaba 2-1. Liquidarlo
// ahora no es optimista: es inventarse el resultado.
const under25 = { family: 'TOTAL_MAPAS', side: 'under', line: 2.5, bo: 3 };
t('TOTAL_MAPAS no se liquida con la serie a medias', ES.settleOne(under25, A_MEDIAS) === null,
  String(ES.settleOne(under25, A_MEDIAS)));
t('y sí con la serie terminada', ES.settleOne(under25, TERMINADA) === 'LOSS',
  String(ES.settleOne(under25, TERMINADA)) + ' (2-1 son 3 mapas: el under de 2,5 pierde)');

const hcp = { family: 'HANDICAP', side: 'home', line: -1.5, bo: 3 };
t('HANDICAP de mapas tampoco se liquida a medias', ES.settleOne(hcp, A_MEDIAS) === null);
t('y sí con la serie terminada', ES.settleOne(hcp, TERMINADA) === 'LOSS',
  String(ES.settleOne(hcp, TERMINADA)) + ' (2-1: el local no cubre -1,5)');

// ── 2. UN BO1 NO ESTÁ "A MEDIAS" CON UN MAPA ───────────────────────────────────────────────────────────
// La puerta usa `bo`, no un número fijo. En un BO1, un mapa jugado ES la serie entera, y bloquearlo mandaría
// todos los BO1 a la caducidad.
const bo1 = { family: 'TOTAL_MAPAS', side: 'under', line: 1.5, bo: 1 };
t('en un BO1, un mapa jugado SÍ termina la serie', ES.settleOne(bo1, A_MEDIAS) === 'WIN',
  String(ES.settleOne(bo1, A_MEDIAS)));

// ── 3. UN BO5 NECESITA TRES ───────────────────────────────────────────────────────────────────────────
const bo5 = { family: 'TOTAL_MAPAS', side: 'under', line: 4.5, bo: 5 };
t('en un BO5, 2-1 todavía NO es el final', ES.settleOne(bo5, TERMINADA) === null,
  String(ES.settleOne(bo5, TERMINADA)));

// ── 4. LAS FAMILIAS DE MAPA NO SE BLOQUEAN ─────────────────────────────────────────────────────────────
// Esta es la mitad que se rompería fácil al añadir la puerta, y la que más costaría: mandaría a caducidad
// picks que ya se pueden decidir.
const rondasM1 = { family: 'RONDAS', side: 'under', line: 44.5, map: 1, bo: 3 };
t('RONDAS del mapa 1 SÍ se liquida aunque la serie siga', ES.settleOne(rondasM1, A_MEDIAS) === 'WIN',
  String(ES.settleOne(rondasM1, A_MEDIAS)) + ' (42 rondas, under 44,5)');

const killsM1 = { family: 'KILLS', side: 'over', line: 40.5, map: 1, bo: 3 };
t('KILLS del mapa 1 también', ES.settleOne(killsM1, A_MEDIAS) === 'WIN',
  String(ES.settleOne(killsM1, A_MEDIAS)) + ' (28+19 = 47, over 40,5)');

// ── 5. SIN `bo` SE SUPONE BO3, QUE ES EL FORMATO NORMAL ────────────────────────────────────────────────
const sinBo = { family: 'TOTAL_MAPAS', side: 'under', line: 2.5 };
t('sin `bo` declarado se supone BO3 y la serie a medias espera', ES.settleOne(sinBo, A_MEDIAS) === null);

// ── 6. EL RESOLUTOR DE DOTA NO ELIGE ENTRE DOS CANDIDATOS (A10) ────────────────────────────────────────
// Recorría el catálogo y devolvía EL PRIMERO que casara por prefijo, y el catálogo se construye en orden
// cronológico: "el primero" significaba "el que apareció antes en el archivo".
const DD = require('../esports-engine/dota2-data');
const cat = { byName: new Map([['aurora', 'tA'], ['aurora gaming', 'tB'], ['team spirit', 'tC'],
  ['spirit academy', 'tD'], ['nigma galaxy', 'tE']]), byAlias: new Map(), teams: {} };
t('una coincidencia exacta gana a una por prefijo', DD.resolveTeam('Aurora', { data: cat }) === 'tA',
  String(DD.resolveTeam('Aurora', { data: cat })));
t('y el nombre largo resuelve al suyo', DD.resolveTeam('Aurora Gaming', { data: cat }) === 'tB');
t('un prefijo con un solo candidato sí resuelve', DD.resolveTeam('Nigma', { data: cat }) === 'tE');
t('un nombre sin candidatos no inventa ninguno', DD.resolveTeam('xxx', { data: cat }) === null);
// LA AMBIGÜEDAD REAL: dos equipos distintos que casan por PREFIJO con el mismo nombre corto. Antes se
// devolvía el primero del catálogo, que se construye en orden cronológico — o sea, el que jugó antes.
const catAmbiguo = { byName: new Map([['team spirit', 'tC'], ['team liquid', 'tL']]), byAlias: new Map(), teams: {} };
t('con dos equipos que casan por prefijo, NO se elige ninguno', DD.resolveTeam('Team', { data: catAmbiguo }) === null,
  String(DD.resolveTeam('Team', { data: catAmbiguo })) + ' — antes devolvía el primero del catálogo');
t('pero un prefijo más largo que solo casa con uno sí resuelve',
  DD.resolveTeam('Team Liq', { data: catAmbiguo }) === 'tL',
  String(DD.resolveTeam('Team Liq', { data: catAmbiguo })) + ' — negarse siempre sería tan malo como elegir al azar');
const catUno = { byName: new Map([['team spirit', 'tC'], ['nigma galaxy', 'tE']]), byAlias: new Map(), teams: {} };
t('un prefijo único entre varios equipos sí resuelve', DD.resolveTeam('Team Spirit', { data: catUno }) === 'tC');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
