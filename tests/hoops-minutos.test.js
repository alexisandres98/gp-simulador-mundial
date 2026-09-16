// tests/hoops-minutos.test.js — EL DENOMINADOR DE MINUTOS Y LA BAJA DE IMPACTO CONOCIDO (16-sep-2026)
//
// A13 de la auditoría externa. Dos cosas, y la segunda es la que de verdad prueba que el puente funciona:
//
//   1. EL DENOMINADOR ES DE LA LIGA, NO DE LA NBA. Un partido de la WNBA son 5 × 40 = 200 minutos-jugador,
//      no 240. El valor por defecto caía a 48 minutos, así que cualquier llamada que olvidara pasar la liga
//      normalizaba la WNBA a la NBA e inflaba TODOS los minutos un 20 %. Como el rating de equipo se pondera
//      por minutos, el error no se queda en la tabla de rotación: llega a la probabilidad.
//
//   2. UNA BAJA DE IMPACTO CONOCIDO SE REPARTE DONDE DEBE. Se construye una plantilla sintética donde se
//      sabe exactamente quién juega cuánto, se quita a la titular de 36 minutos, y se comprueba que:
//        · el total sigue siendo el de la liga (no se pierden ni se inventan minutos);
//        · nadie supera su techo observado + 6 (el entrenador estira la rotación, no a una persona);
//        · los minutos liberados van sobre todo a quien ya jugaba mucho, no al último de la rotación.
'use strict';
const MN = require('../basketball-engine/minutes');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };
const cerca = (a, b, tol = 0.5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

// ── 1. EL DENOMINADOR POR LIGA ──────────────────────────────────────────────────────────────────────────
t('NBA son 240 minutos-jugador', MN.teamMinutes({ minutes: 48 }) === 240);
t('WNBA son 200, no 240', MN.teamMinutes({ minutes: 40 }) === 200, String(MN.teamMinutes({ minutes: 40 })));
t('NCAA son 200', MN.teamMinutes({ minutes: 40 }) === 200);
t('y también se puede pedir por nombre de liga', MN.teamMinutes('wnba') === 200 && MN.teamMinutes('nba') === 240,
  `wnba ${MN.teamMinutes('wnba')} nba ${MN.teamMinutes('nba')}`);
t('sin liga NO se adivina la NBA', MN.teamMinutes(null) === null, String(MN.teamMinutes(null)));
t('y con un objeto sin minutos tampoco', MN.teamMinutes({}) === null);

// ── 2. UNA PLANTILLA SINTÉTICA DE IMPACTO CONOCIDO ──────────────────────────────────────────────────────
// Ocho jugadoras, 200 minutos EXACTOS de WNBA (36+32+30+28+26+22+16+10). Que sume 200 exactamente no es
// cosmético: si sumara menos, la normalización escalaría a todo el mundo hacia arriba y el test estaría
// midiendo el reescalado en vez del reparto de la baja — fue el primer fixture que escribí, sumaba 173, y
// la titular de 36 minutos salía con 41,5 sin que nada estuviera roto.
const PLANTILLA = [
  { id: '1', name: 'Titular franquicia', pos: 'G', exp: 36, max: 40, apps: 15, startShare: 1 },
  { id: '2', name: 'Titular 2', pos: 'F', exp: 32, max: 36, apps: 15, startShare: 1 },
  { id: '3', name: 'Titular 3', pos: 'C', exp: 30, max: 34, apps: 15, startShare: 1 },
  { id: '4', name: 'Titular 4', pos: 'G', exp: 28, max: 33, apps: 15, startShare: 0.9 },
  { id: '5', name: 'Titular 5', pos: 'F', exp: 26, max: 31, apps: 15, startShare: 0.8 },
  { id: '6', name: 'Sexta', pos: 'G', exp: 22, max: 27, apps: 14, startShare: 0.1 },
  { id: '7', name: 'Séptima', pos: 'F', exp: 16, max: 22, apps: 12, startShare: 0 },
  { id: '8', name: 'Octava', pos: 'C', exp: 10, max: 16, apps: 9, startShare: 0 },
];
const perfil = { team_id: 'T', games: 15, rows: PLANTILLA.map((x) => ({ ...x })) };
const WNBA = { minutes: 40, otMin: 5 };

// sin liga: se niega en vez de normalizar a 240
const sinLiga = MN.projectMinutes({ team_id: 'T', games: 15, rows: PLANTILLA.map((x) => ({ ...x })) }, {});
t('sin liga, la proyección se declara imposible en vez de dar un número', !!(sinLiga && sinLiga.error === 'sin_liga'),
  JSON.stringify(sinLiga && (sinLiga.error || sinLiga.total)));

const base = MN.projectMinutes(perfil, { L: WNBA });
const suma = (p) => Object.values(p.map || {}).reduce((a, b) => a + b, 0);
t('con la plantilla al completo, el total es el de la WNBA', cerca(suma(base), 200, 1), `suma ${suma(base).toFixed(1)}`);
t('y la titular franquicia conserva sus minutos', cerca(base.map['1'], 36, 2), `${base.map['1']}`);

// ── 3. LA BAJA DE IMPACTO CONOCIDO ──────────────────────────────────────────────────────────────────────
const sinTitular = MN.projectMinutes({ team_id: 'T', games: 15, rows: PLANTILLA.map((x) => ({ ...x })) },
  { out: ['1'], L: WNBA });
t('con la titular fuera, el total SIGUE siendo 200', cerca(suma(sinTitular), 200, 1), `suma ${suma(sinTitular).toFixed(1)}`);
t('y la titular ausente no aparece con minutos', !(sinTitular.map['1'] > 0), String(sinTitular.map['1']));

// nadie rompe su techo
const rompeTecho = PLANTILLA.filter((p) => p.id !== '1')
  .filter((p) => (sinTitular.map[p.id] || 0) > p.max + 6 + 0.01);
t('nadie supera su techo observado + 6', rompeTecho.length === 0,
  rompeTecho.map((p) => `${p.name} ${sinTitular.map[p.id]} > ${p.max + 6}`).join('; '));

// los 36 minutos liberados van sobre todo a quien ya jugaba, no a la última
const gana = (id) => +( (sinTitular.map[id] || 0) - (base.map[id] || 0) ).toFixed(2);
const ganaTitulares = ['2', '3', '4', '5'].reduce((a, id) => a + gana(id), 0);
const ganaFondo = ['7', '8'].reduce((a, id) => a + gana(id), 0);
t('los minutos liberados se reparten y suman los que faltaban',
  cerca(['2', '3', '4', '5', '6', '7', '8'].reduce((a, id) => a + gana(id), 0), 36, 1.5),
  `repartidos ${['2', '3', '4', '5', '6', '7', '8'].reduce((a, id) => a + gana(id), 0).toFixed(1)}`);
t('y van sobre todo a la rotación de arriba, no al fondo del banquillo', ganaTitulares > ganaFondo,
  `arriba +${ganaTitulares.toFixed(1)} · fondo +${ganaFondo.toFixed(1)}`);

// ── 4. EL CASO EXTREMO: TRES BAJAS ──────────────────────────────────────────────────────────────────────
// 94 minutos fuera. Los techos impiden absorberlos con siete jugadoras, así que TIENE que entrar nivel de
// reemplazo — y el total tiene que seguir cuadrando. Si no, o se pierden minutos o alguien juega 50.
const tresBajas = MN.projectMinutes({ team_id: 'T', games: 15, rows: PLANTILLA.map((x) => ({ ...x })) },
  { out: ['1', '2', '3'], L: WNBA });
t('con tres titulares fuera, el total sigue cuadrando', cerca(suma(tresBajas), 200, 1), `suma ${suma(tresBajas).toFixed(1)}`);
const excede = PLANTILLA.filter((p) => !['1', '2', '3'].includes(p.id))
  .filter((p) => (tresBajas.map[p.id] || 0) > p.max + 6 + 0.01);
t('y aun así nadie rompe su techo', excede.length === 0,
  excede.map((p) => `${p.name} ${tresBajas.map[p.id]}`).join('; '));
t('los minutos que nadie puede absorber entran como nivel de reemplazo',
  Object.keys(tresBajas.map).some((k) => /repl/i.test(k)) || (tresBajas.rows || []).some((r) => /reemplazo/i.test(r.name || '')),
  JSON.stringify((tresBajas.rows || []).map((r) => `${r.name}:${r.min}`)));

// ── 5. LA DUDOSA CUENTA A MEDIAS ────────────────────────────────────────────────────────────────────────
const dudosa = MN.projectMinutes({ team_id: 'T', games: 15, rows: PLANTILLA.map((x) => ({ ...x })) },
  { doubtful: { 1: 0.5 }, L: WNBA });
t('una dudosa al 50 % juega menos que al 100 % pero más que nada',
  dudosa.map['1'] > 0 && dudosa.map['1'] < base.map['1'], `${dudosa.map['1']} contra ${base.map['1']}`);
t('y el total sigue siendo 200', cerca(suma(dudosa), 200, 1), `suma ${suma(dudosa).toFixed(1)}`);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
