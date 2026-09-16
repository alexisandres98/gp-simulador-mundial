// tests/tenis-retiro.test.js — EL RETIRO SE LIQUIDA DISTINTO EN CADA FAMILIA (16-sep, A5)
//
// Hasta el 16-sep un retiro anulaba las tres familias de tenis, con el comentario «las casas difieren».
// Ya no hay que suponerlo: el reglamento de Cloudbet, leído ese día, dice cosas distintas y las dice
// literalmente. Esto fija las tres, porque son el tipo de regla que se vuelve a «simplificar» sola.
//
// Las citas, del reglamento de la casa:
//   · «One full set must be completed for money line / winner wagers to stand. If less than 1 set is
//      completed, all money line wagers will be void. The winner of the match is the participant declared
//      the victor by the umpire of the match.»
//   · «If a tennis match is not completed because of a player retirement or disqualification, all Handicap
//      and Total Games wagers will be void, regardless of the score of the match.»
'use strict';

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// La cuenta de sets completos es la que decide el ganador, así que se prueba sola. Un set está completo si
// alguien llegó a 6 con dos de margen, o a 7 (7-5 y 7-6).
function setsCompletados(setsA, setsB) {
  let n = 0;
  for (let i = 0; i < Math.min(setsA.length, setsB.length); i++) {
    const a = setsA[i], b = setsB[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if ((hi >= 6 && hi - lo >= 2) || hi === 7) n++;
  }
  return n;
}

// ── QUÉ CUENTA COMO SET COMPLETO ────────────────────────────────────────────────────────────────────────
const casos = [
  { s: [[6], [3]], n: 1, que: '6-3 es un set' },
  { s: [[7], [5]], n: 1, que: '7-5 es un set' },
  { s: [[7], [6]], n: 1, que: '7-6 (tiebreak) es un set' },
  { s: [[6], [4]], n: 1, que: '6-4 es un set' },
  { s: [[5], [4]], n: 0, que: '5-4 NO es un set: la retirada llegó antes' },
  { s: [[6], [5]], n: 0, que: '6-5 tampoco: falta el margen de dos' },
  { s: [[4], [1]], n: 0, que: '4-1 no' },
  { s: [[6, 3], [4, 2]], n: 1, que: '6-4 y 3-2: solo el primero está completo' },
  { s: [[6, 6], [4, 3]], n: 2, que: 'dos sets completos' },
];
for (const c of casos) t(c.que, setsCompletados(c.s[0], c.s[1]) === c.n, `salió ${setsCompletados(c.s[0], c.s[1])}`);

// ── LA REGLA POR FAMILIA ────────────────────────────────────────────────────────────────────────────────
// Se reproduce la decisión tal y como la toma el liquidador, sin necesitar red ni ESPN.
const anulada = (familia, retired, nSets) => (familia === 'ML' ? (retired && nSets < 1) : retired);

t('ML: retiro con un set completo NO se anula — la casa paga al que no se retira',
  anulada('ML', true, 1) === false);
t('ML: retiro ANTES de completar un set sí se anula',
  anulada('ML', true, 0) === true);
t('SPREAD: el retiro anula siempre, sea cual sea el marcador',
  anulada('SPREAD', true, 2) === true && anulada('SPREAD', true, 0) === true);
t('TOTAL: el retiro anula siempre, sea cual sea el marcador',
  anulada('TOTAL', true, 2) === true && anulada('TOTAL', true, 0) === true);
t('sin retiro no se anula nada',
  ['ML', 'SPREAD', 'TOTAL'].every((f) => anulada(f, false, 2) === false));

// ── LA DIRECCIÓN DEL ERROR VIEJO ────────────────────────────────────────────────────────────────────────
// Anular el ganador cuando la casa lo paga no es «conservador»: borra del track justo los partidos que
// acaban en retirada, que no son una muestra cualquiera — el que se retira suele ir perdiendo, así que lo
// que se borraba eran sobre todo aciertos sobre el favorito.
t('la regla vieja anulaba el ganador donde la casa lo paga',
  anulada('ML', true, 2) === false, 'con dos sets completos el ganador se paga');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
