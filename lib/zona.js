// lib/zona.js — HORA LOCAL A UTC, CON LA ZONA DE VERDAD (16-sep-2026, A29 de la auditoría externa)
//
// EL FALLO QUE VIENE A TAPAR. `nfl-engine/store.js` calculaba el saque así:
//
//     const kickoff = Date.parse(g.date + 'T' + (g.time || '17:00') + ':00Z');
//
// `g.time` viene de `gametime` de nflverse, que es **hora del Este de Estados Unidos**. Pegarle una `Z`
// detrás no la convierte: la declara UTC. Un partido de la 1 de la tarde en Nueva York quedaba anotado a
// la 1 de la tarde UTC, o sea **cuatro o cinco horas antes de lo que es**, según el horario de verano.
//
// No es cosmético. De ese número cuelgan tres cosas:
//   · el pronóstico del tiempo se pide para la hora equivocada (NFL-0399 pide "la hora del kickoff");
//   · la ventana de captura del cierre —«desde 4 h antes hasta 8 días»— se desplaza entera, así que el
//     "último precio antes del saque" puede ser de cuatro horas DESPUÉS del saque real;
//   · la liquidación espera 3,2 h desde un saque que no es el saque.
//
// Y cambia dentro de la temporada: la NFL empieza en septiembre con horario de verano (UTC−4) y termina en
// febrero con horario estándar (UTC−5). Una constante no vale; hay que preguntar por la fecha concreta.
//
// CÓMO SE HACE SIN TABLA DE REGLAS. Node trae la base de datos de zonas horarias en `Intl`. En vez de
// codificar "segundo domingo de marzo" —que además ha cambiado por ley varias veces y volverá a cambiar—,
// se le pregunta al sistema: se parte de una estimación, se formatea en la zona pedida, se mide cuánto se
// desvía del reloj de pared que queríamos, y se corrige. Dos iteraciones bastan siempre, incluso en los
// saltos de hora.
//
// PURO: sin red, sin disco, sin estado.
'use strict';

const MIN = 60e3;

// Partes de un instante leídas EN una zona. `Intl` da el reloj de pared de esa zona para ese instante.
function partesEn(ms, zona) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const p = {};
  for (const x of f) if (x.type !== 'literal') p[x.type] = +x.value;
  // `hour24` de Intl puede devolver 24 en medianoche según la plataforma; se normaliza a 0
  if (p.hour === 24) p.hour = 0;
  return p;
}

// El desfase de una zona en un instante dado, en minutos (negativo al oeste de Greenwich).
function desfaseMin(ms, zona) {
  const p = partesEn(ms, zona);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - ms) / MIN);
}

// ── LA FUNCIÓN QUE IMPORTA ──────────────────────────────────────────────────────────────────────────────
// Un reloj de pared ("2026-09-14", "13:00") en una zona → el instante UTC correspondiente.
//
// El punto fijo se busca por iteración porque el desfase depende del instante y el instante depende del
// desfase. Dos vueltas bastan: la primera lleva al día correcto, la segunda ajusta el salto de hora si la
// fecha cae justo en él.
//
// LOS DOS CASOS RAROS DE LOS CAMBIOS DE HORA, y los dos se declaran en vez de fingir:
//   · la hora que NO EXISTE (la madrugada en que el reloj salta hacia adelante): no hay instante que
//     corresponda a ese reloj de pared. Se devuelve el instante del salto y `existe: false`.
//   · la hora REPETIDA (cuando el reloj atrasa): hay dos instantes. Se devuelve el PRIMERO —el del horario
//     de verano— y `ambigua: true`, que es la convención de la mayoría de bibliotecas.
// Ningún partido de la NFL se juega a las 2 de la madrugada, así que en la práctica no pasa; pero un
// conversor que resuelva en silencio un caso imposible es el que luego desplaza un cierre sin que nadie lo
// note.
function aUtc(fechaISO, hhmm, zona, { segundos = 0 } = {}) {
  const md = String(fechaISO || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const mh = String(hhmm == null ? '' : hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!md || !mh) return null;
  const [Y, M, D] = [+md[1], +md[2], +md[3]];
  const [h, m] = [+mh[1], +mh[2]];
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return null;

  const pared = Date.UTC(Y, M - 1, D, h, m, segundos);
  let ms = pared;
  for (let i = 0; i < 3; i++) {
    const off = desfaseMin(ms, zona);
    const nuevo = pared - off * MIN;
    if (nuevo === ms) break;
    ms = nuevo;
  }
  // comprobación: ¿el instante que hemos encontrado se lee de verdad como el reloj que pedíamos?
  const p = partesEn(ms, zona);
  const casa = p.year === Y && p.month === M && p.day === D && p.hour === h && p.minute === m;
  // ¿ES AMBIGUA? Hay que mirar HACIA ADELANTE, no hacia atrás. Cuando el reloj atrasa, el instante que
  // encontramos es el primero (horario de verano) y el SEGUNDO —una hora después en tiempo absoluto— se lee
  // con el mismo reloj de pared. Mirar una hora antes da la hora anterior y nunca detecta nada: el 1-nov de
  // 2026 a la 01:30 salía "no ambigua" cuando es el caso de libro.
  const despues = partesEn(ms + 60 * MIN, zona);
  const ambigua = casa && despues.hour === h && despues.minute === m && despues.day === D;
  return { ms, iso: new Date(ms).toISOString(), zona,
    desfase_min: desfaseMin(ms, zona),
    existe: casa, ...(ambigua ? { ambigua: true } : {}),
    ...(casa ? {} : { aviso: `el reloj ${fechaISO} ${hhmm} no existe en ${zona} (salto de hora): se devuelve el instante del salto` }) };
}

// Atajo para lo que de verdad se usa: la NFL publica `gametime` en hora del Este.
const ESTE_EEUU = 'America/New_York';
function nflKickoffUtc(fecha, hora, { porDefecto = '13:00' } = {}) {
  const r = aUtc(fecha, hora || porDefecto, ESTE_EEUU);
  return r ? r.ms : NaN;
}

module.exports = { aUtc, desfaseMin, partesEn, nflKickoffUtc, ESTE_EEUU, MIN };
