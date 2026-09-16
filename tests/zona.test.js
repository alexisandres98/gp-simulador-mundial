// tests/zona.test.js — LA HORA DEL SAQUE (16-sep-2026, A29 de la auditoría externa)
//
// El fallo que fija este test: `nfl-engine/store.js` calculaba el saque pegándole una `Z` a una hora que
// viene en hora del ESTE de Estados Unidos. Eso no convierte nada, la declara UTC — y deja el saque cuatro
// horas antes en septiembre y cinco en enero, porque la temporada de la NFL cruza el cambio de hora.
//
// De ese número cuelgan el pronóstico del tiempo, la ventana de captura del cierre y la espera para
// liquidar. Un desplazamiento de cuatro horas en la ventana de cierre significa que el "último precio antes
// del saque" puede ser un precio EN VIVO.
'use strict';
const Z = require('../lib/zona');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };
const iso = (f, h) => { const r = Z.aUtc(f, h, 'America/New_York'); return r && r.iso; };

// ── 1. EL HORARIO DE VERANO Y EL ESTÁNDAR, EN LA MISMA TEMPORADA ───────────────────────────────────────
t('un domingo de septiembre a la 1 de la tarde son las 17:00 UTC (UTC−4)',
  iso('2026-09-14', '13:00') === '2026-09-14T17:00:00.000Z', String(iso('2026-09-14', '13:00')));
t('el mismo horario en enero son las 18:00 UTC (UTC−5)',
  iso('2027-01-10', '13:00') === '2027-01-10T18:00:00.000Z', String(iso('2027-01-10', '13:00')));
t('y el partido de noche de septiembre cruza a la madrugada del día siguiente',
  iso('2026-09-14', '20:15') === '2026-09-15T00:15:00.000Z', String(iso('2026-09-14', '20:15')));

// ── 2. EL CAMBIO DE HORA CAE DENTRO DE LA TEMPORADA ────────────────────────────────────────────────────
// El 1-nov-2026 acaba el horario de verano en EE. UU. Los partidos de ese domingo ya son UTC−5; los del
// domingo anterior, UTC−4. Una constante no puede estar bien en los dos.
t('el 25-oct es UTC−4', Z.aUtc('2026-10-25', '13:00', 'America/New_York').desfase_min === -240);
t('el 1-nov ya es UTC−5', Z.aUtc('2026-11-01', '13:00', 'America/New_York').desfase_min === -300);
t('y eso son 60 minutos de diferencia entre dos domingos seguidos',
  Date.parse(iso('2026-11-01', '13:00')) - Date.parse(iso('2026-10-25', '13:00')) === 7 * 864e5 + 3600e3,
  `${(Date.parse(iso('2026-11-01', '13:00')) - Date.parse(iso('2026-10-25', '13:00'))) / 3600e3} h`);

// ── 3. EL ERROR QUE HABÍA, CUANTIFICADO ────────────────────────────────────────────────────────────────
const antes = (f, h) => Date.parse(f + 'T' + h + ':00Z');
t('el método viejo se equivocaba en 4 h en septiembre',
  (Date.parse(iso('2026-09-14', '13:00')) - antes('2026-09-14', '13:00')) === 4 * 3600e3);
t('y en 5 h en enero',
  (Date.parse(iso('2027-01-10', '13:00')) - antes('2027-01-10', '13:00')) === 5 * 3600e3);

// ── 4. LOS DOS CASOS RAROS DEL CAMBIO DE HORA SE DECLARAN ──────────────────────────────────────────────
// Ningún partido se juega a las 2 de la madrugada, pero un conversor que resuelva en silencio un reloj
// imposible es el que luego desplaza un cierre sin que nadie lo note.
const noExiste = Z.aUtc('2026-03-08', '02:30', 'America/New_York');
t('la hora que no existe se declara', noExiste && noExiste.existe === false, JSON.stringify(noExiste && noExiste.existe));
t('y lo dice con el motivo', /no existe/.test((noExiste || {}).aviso || ''));

const ambigua = Z.aUtc('2026-11-01', '01:30', 'America/New_York');
t('la hora repetida se declara ambigua', !!(ambigua && ambigua.ambigua), JSON.stringify(ambigua));
t('y se devuelve la PRIMERA de las dos (horario de verano)', ambigua && ambigua.desfase_min === -240,
  String(ambigua && ambigua.desfase_min));
// una hora normal NO es ambigua: si lo fuera, la detección estaría mirando al lado equivocado (fue el
// primer intento: miraba una hora ANTES, y ahí nunca hay repetición)
t('una hora normal no se marca como ambigua', !Z.aUtc('2026-11-01', '13:00', 'America/New_York').ambigua);

// ── 5. OTRAS ZONAS, PORQUE EL MÓDULO NO ES DE LA NFL ───────────────────────────────────────────────────
t('Madrid en verano es UTC+2', Z.aUtc('2026-07-01', '12:00', 'Europe/Madrid').desfase_min === 120);
t('Madrid en invierno es UTC+1', Z.aUtc('2026-12-01', '12:00', 'Europe/Madrid').desfase_min === 60);
t('Tokio no tiene horario de verano', Z.aUtc('2026-07-01', '12:00', 'Asia/Tokyo').desfase_min === 540
  && Z.aUtc('2026-12-01', '12:00', 'Asia/Tokyo').desfase_min === 540);
t('y una zona al este del meridiano da desfase positivo', Z.aUtc('2026-07-01', '12:00', 'Asia/Tokyo').iso === '2026-07-01T03:00:00.000Z',
  String(Z.aUtc('2026-07-01', '12:00', 'Asia/Tokyo').iso));

// ── 6. ENTRADAS ROTAS NO INVENTAN UNA FECHA ────────────────────────────────────────────────────────────
t('sin hora no se devuelve nada', Z.aUtc('2026-09-14', null, 'America/New_York') === null);
t('sin fecha tampoco', Z.aUtc(null, '13:00', 'America/New_York') === null);
t('una hora imposible no se acepta', Z.aUtc('2026-09-14', '25:00', 'America/New_York') === null);

// ── 7. EL ATAJO DE LA NFL ──────────────────────────────────────────────────────────────────────────────
t('nflKickoffUtc usa el Este', Z.nflKickoffUtc('2026-09-14', '13:00') === Date.parse('2026-09-14T17:00:00.000Z'));
t('y sin hora cae a las 13:00 del Este, no a las 17:00 UTC a secas',
  Z.nflKickoffUtc('2026-09-14', null) === Date.parse('2026-09-14T17:00:00.000Z'),
  new Date(Z.nflKickoffUtc('2026-09-14', null)).toISOString());

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
