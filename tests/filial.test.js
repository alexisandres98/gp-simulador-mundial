// tests/filial.test.js — EL EMPAREJADO QUE CRUZA UN EQUIPO CON SU FILIAL (16-sep-2026)
//
// Este test tiene dos mitades y las dos importan por igual:
//   · que DETECTE el cruce real — "Spirit Academy" contra "Spirit" son dos rosters;
//   · que NO lo invente donde no lo hay — "Vivo Keyd Stars" contra "Keyd Stars" es el mismo equipo con un
//     patrocinador delante, y rechazar ese emparejado tiraría 150 liquidaciones correctas.
// Un detector que se pasa de celoso aquí no es "prudente": es un detector que borra el libro.
'use strict';
const F = require('../lib/filial');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// ── 1. LOS CRUCES REALES, TAL Y COMO SALEN DEL LIBRO DE CS2 ─────────────────────────────────────────────
for (const [a, b, que] of [
  ['Spirit Academy', 'Spirit', 'equipo academia'],
  ['BESTIA', 'BESTIA Academy', 'equipo academia'],
  ['Inner Circle', 'Inner Circle Academy', 'equipo academia'],
  ['Falcons', 'Falcons Force', 'segundo roster (Falcons)'],
  ['Faze Up Next', 'FaZe Clan', 'cantera (FaZe)'],
  ['ENCE Prospects', 'ENCE', 'cantera'],
  ['MOUZ NXT', 'MOUZ', 'cantera (MOUZ)'],
]) {
  const r = F.cruza(a, b);
  t(`cruza: ${a} ↔ ${b}`, !!r && r.marca === que, r ? r.marca : 'no lo detecta');
}

// ── 2. LOS QUE NO SON CRUCES Y NO SE PUEDEN ROMPER ──────────────────────────────────────────────────────
// Cada uno de éstos es un emparejado que hoy funciona y rescata liquidaciones. Si el detector los marcara,
// la etiqueta perdería todo su valor: habría cientos de "cruces" y nadie miraría ninguno.
for (const [a, b, por] of [
  ['Vivo Keyd Stars', 'Keyd Stars', 'patrocinador delante'],
  ['100 Thieves', '100 Thieves Roobet', 'patrocinador detrás'],
  ['Bounty Hunters', 'Bounty Hunters BetJam', 'patrocinador detrás'],
  ['WRAITH PCIFIC', 'PCIFIC', 'patrocinador delante'],
  ['Phantom Academy', 'Phantom AC', 'la MISMA academia, abreviada'],
  ['ex-Sashi Academy', 'Sashi Academy', 'la misma academia con el prefijo ex-'],
  ['Spirit Academy', 'G2', 'ni siquiera es la misma marca'],
  ['Team Spirit', 'Spirit', 'la misma entidad'],
  ['Nemiga Gaming', 'Nemiga', 'sufijo genérico, no filial'],
  ['Furia Esports', 'FURIA', 'sufijo genérico, no filial'],
  ['BESTIA Academy', 'Bestia Academy', 'solo cambian las mayúsculas'],
]) {
  t(`NO cruza (${por}): ${a} ↔ ${b}`, F.cruza(a, b) === null, JSON.stringify(F.cruza(a, b)));
}

// ── 3. EL PAR COMPLETO: UN CRUCE EN CUALQUIER LADO CONTAMINA LA LIQUIDACIÓN ─────────────────────────────
const limpio = F.cruceEnPar({ pickA: 'Vivo Keyd Stars', pickB: 'Isurus', fuenteA: 'Keyd Stars', fuenteB: 'Isurus' });
t('un par sin cruces devuelve null', limpio === null);

const sucio = F.cruceEnPar({ pickA: 'Spirit Academy', pickB: 'MOUZ', fuenteA: 'Spirit', fuenteB: 'MOUZ' });
t('un cruce en el lado local se detecta', !!sucio && sucio.lados.length === 1, JSON.stringify(sucio && sucio.resumen));
t('y viaja con su propia etiqueta, distinta de "aproximado"', sucio.etiqueta === 'aproximado_filial');
t('y el aviso explica por qué importa', /rosters distintos/i.test(sucio.lados[0].aviso));

const sucioVisita = F.cruceEnPar({ pickA: 'MOUZ', pickB: 'BESTIA', fuenteA: 'MOUZ', fuenteB: 'BESTIA Academy' });
t('un cruce en el lado visitante también', !!sucioVisita && sucioVisita.lados.length === 1);

// ── 4. LAS FUSIONES DEL CATÁLOGO ────────────────────────────────────────────────────────────────────────
// Dos rosters distintos que el resolutor devuelve con el MISMO id. Es un fallo claro y decidible, a
// diferencia del cruce por contención: aquí no hay ambigüedad que respetar.
const resolver = (n) => ({
  'FaZe Clan': 'faze', 'Faze Up Next': 'faze',          // la fusión real que hay hoy en CS2
  'Team Spirit': 'spirit', 'Spirit Academy': 'spirit-academy',   // éstos SÍ están bien separados
  MOUZ: 'mouz', 'MOUZ NXT': 'mouz-nxt',
}[n] || null);
const fus = F.fusionesEnCatalogo(['FaZe Clan', 'Faze Up Next', 'Team Spirit', 'Spirit Academy', 'MOUZ', 'MOUZ NXT'], resolver);
t('encuentra la fusión de FaZe', fus.length === 1 && fus[0].id === 'gp:faze', JSON.stringify(fus.map((x) => x.id)));
t('y no marca a los que sí están separados', !fus.some((x) => /spirit|mouz/.test(x.id)));
t('y el aviso dice exactamente qué va a pasar', /se liquidará con el resultado de la otra/i.test(fus[0].aviso));

// variantes de mayúsculas no son una fusión
const solo = F.fusionesEnCatalogo(['ENCE', 'Ence'], (n) => (/ence/i.test(n) ? 'ence' : null));
t('dos formas del mismo nombre no son una fusión', solo.length === 0, JSON.stringify(solo));

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
