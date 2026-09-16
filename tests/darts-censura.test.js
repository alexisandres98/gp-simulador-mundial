// tests/darts-censura.test.js — LA CENSURA DEL LEG (16-sep, M6 · A27)
//
// `calibrate()` perseguía la media de un leg que SIEMPRE se termina; la fuente mide PARTIDOS, donde la
// mitad de los legs se pierden y el que pierde nunca tira el checkout. La diferencia va de +18,8 puntos en
// un jugador de 70 a −6,4 en uno de 115, es monótona y comprime todo hacia 94-100. Lo que se fija aquí es
// que la inversión exista, vaya en la dirección correcta, y **no extrapole** fuera de lo medido.
'use strict';
const K = require('../darts-engine/kernel');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

const cal = (obs) => K.calibrate({ avg: obs }).target;

// ── 1. LA CORRECCIÓN EXISTE Y VA HACIA ABAJO EN EL GRUESO DEL CIRCUITO ──────────────────────────────────
// Un jugador cuya media OBSERVADA es 94 no es un jugador de 94 de solo-leg: es más flojo, porque parte de
// esos 94 se los regala no tener que cerrar los legs que pierde.
const c94 = cal(94);
t('con media observada 94 se ajusta a bastante menos', c94.avg < 90, `ajustada ${c94.avg}`);
t('y la corrección se informa', c94.censura_pp < 0 && c94.avg_observada === 94, JSON.stringify(c94));
t('y se dice que se aplicó', c94.censura_aplicada === true);

// ── 2. ES MONÓTONA ─────────────────────────────────────────────────────────────────────────────────────
// Si no lo fuera, dos jugadores ordenados por media observada podrían salir ordenados al revés, que es
// peor que no corregir nada.
const obs = [90, 92, 94, 96, 98, 100, 102];
const ajust = obs.map((o) => cal(o).avg);
t('la media ajustada crece con la observada', ajust.every((v, i) => i === 0 || v >= ajust[i - 1]),
  JSON.stringify(ajust));

// ── 3. LA CORRECCIÓN SE ENCOGE Y CAMBIA DE SIGNO EN LOS FUERTES ────────────────────────────────────────
// Es la forma que midió A27: los flojos parecen mucho más fuertes de lo que son, y los muy fuertes algo
// más flojos. Una corrección constante no serviría.
t('la corrección es grande en los flojos y pequeña o positiva en los fuertes',
  cal(92).censura_pp < cal(98).censura_pp && cal(98).censura_pp < cal(106).censura_pp,
  `92 → ${cal(92).censura_pp} · 98 → ${cal(98).censura_pp} · 106 → ${cal(106).censura_pp}`);

// ── 4. FUERA DEL RANGO MEDIDO NO SE EXTRAPOLA, SE DECLARA ──────────────────────────────────────────────
// La curva se midió entre 88,79 y 108,58 de media observada. Extrapolarla sería inventarse cuántos
// checkouts no tiró alguien de quien no se ha medido nada.
t('por debajo del rango se recorta y se marca', cal(85).censura_fuera_de_rango === 'por debajo', JSON.stringify(cal(85)));
t('por encima del rango se recorta y se marca', cal(110).censura_fuera_de_rango === 'por encima', JSON.stringify(cal(110)));
t('dentro del rango no se marca nada', cal(96).censura_fuera_de_rango == null, String(cal(96).censura_fuera_de_rango));
t('y el recorte no se pasa del extremo de la curva', cal(70).avg >= 70 && cal(120).avg <= 115,
  `${cal(70).avg} y ${cal(120).avg}`);

// ── 5. EL INTERRUPTOR DEVUELVE EL COMPORTAMIENTO VIEJO ──────────────────────────────────────────────────
// Cambiar la calibración de todos los jugadores tiene que ser reversible de una sola manera y sin tocar
// código, porque mueve el precio de todas las familias de dardos.
process.env.GP_DARTS_CENSURA = '0';
const sin = K.calibrate({ avg: 94 }).target;
t('con GP_DARTS_CENSURA=0 se ajusta a la media observada tal cual', sin.avg === 94 && sin.censura_pp === 0,
  JSON.stringify(sin));
t('y se dice que NO se aplicó', sin.censura_aplicada === false);
delete process.env.GP_DARTS_CENSURA;

// ── 6. LAS DOS APROXIMACIONES DEL DP SIGUEN APAGADAS ───────────────────────────────────────────────────
// M6 las deja apagadas para siempre: valen 0,026 y 0,017 puntos, que es ruido al lado de los 9,7 de la
// censura, y encenderlas cambiaría qué picks nacen a cambio de nada.
t('el DP exacto está apagado por defecto', !process.env.GP_DARTS_DP_EXACTO);
t('y la rejilla fina también', !process.env.GP_DARTS_DP_FINO);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
