// tests/nfl-paridad.test.js — UN MARCADOR QUE NO EXISTE NO PUEDE SALIR DEL SIMULADOR (16-sep-2026, A28)
//
// EL FALLO. En la rama del pool de residuos, el simulador de fútbol americano sorteaba margen y total y los
// redondeaba POR SEPARADO. De ahí salen pares que no corresponden a ningún marcador posible, por dos
// razones que son aritmética y no modelo:
//
//   local = (t + m)/2   ·   visitante = (t − m)/2
//
//   · t y m tienen que tener LA MISMA PARIDAD. Un margen de 3 con un total de 20 significa 11,5 a 8,5.
//   · y t ≥ |m|, porque el que pierde no puede anotar negativo.
//
// No es cosmético: de estas mismas filas salen las CDF con las que se cotiza cualquier línea de hándicap y
// de total. Un margen de 3 que aparece con un total de 20 mete masa en el número clave más importante de la
// NFL desde un marcador que no se jugó nunca.
//
// La rama del ATLAS no tiene el problema —copia pares (m, t) de partidos reales— y este test lo comprueba
// también, porque el día que alguien toque esa rama conviene que salte.
'use strict';
const S = require('../nfl-engine/simulate');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// Un pool de residuos sintético con la dispersión REAL de la NFL: 13,3 puntos de margen y 10,5 de total.
// Determinista, sin Math.random.
//
// OJO CON EL FACTOR √3, que me costó un falso fallo: un uniforme en [−1, 1] tiene desviación 1/√3 ≈ 0,577,
// no 1. Multiplicar por 13,3 da un pool de sd 7,68 y el test decía que el simulador estaba subdisperso
// cuando el subdisperso era el fixture. Hay que escalar por 13,3·√3.
const RAIZ3 = Math.sqrt(3);
const POOL = [];
for (let i = 0; i < 400; i++) {
  const a = ((i * 7919) % 101 - 50) / 50;      // −1 .. 1, sd = 1/√3
  const b = ((i * 104729) % 97 - 48) / 48;
  POOL.push([+(a * 13.3 * RAIZ3).toFixed(2), +(b * 10.5 * RAIZ3).toFixed(2)]);
}
const PRIORS = { resid_pool: POOL, outcome_atlas: [] };

const PAR = (o) => Object.entries(o || {}).filter(([k]) => Math.abs(+k) % 2 === 0).reduce((s, [, v]) => s + v, 0);
const TOT = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);

const res = S.simulate({ muMargin: 2.5, muTotal: 44.5, priors: PRIORS, n: 40000, seed: 31 });
t('el simulador devuelve algo', !!res);

if (res) {
  const mh = res.margin_hist, th = res.total_hist;
  t('trae los histogramas de margen y total', !!(mh && th));

  // ── LA PARIDAD, QUE ES LA COMPROBACIÓN DE VERDAD ──────────────────────────────────────────────────────
  // «margen par» y «total par» son EL MISMO SUCESO: local = (t+m)/2 solo es entero si t y m tienen la misma
  // paridad. Así que P(margen par) tiene que ser igual a P(total par) hasta el ruido de Monte Carlo. Con el
  // redondeo por separado los dos eran independientes y la igualdad se rompía.
  const pm = PAR(mh) / TOT(mh), pt = PAR(th) / TOT(th);
  t('P(margen par) = P(total par), porque son el mismo suceso', Math.abs(pm - pt) < 0.01,
    `margen par ${pm.toFixed(4)} · total par ${pt.toFixed(4)} · diferencia ${(Math.abs(pm - pt)).toFixed(5)}`);

  // ── NINGÚN TOTAL POR DEBAJO DEL MARGEN QUE LO ACOMPAÑA ───────────────────────────────────────────────
  // No se puede comprobar la conjunta desde los marginales, pero sí la condición necesaria: el total mínimo
  // con masa no puede ser menor que 2, y el margen máximo tiene que ser alcanzable con algún total.
  const tMin = Math.min(...Object.keys(th).map(Number));
  const tMax = Math.max(...Object.keys(th).map(Number));
  const mMax = Math.max(...Object.keys(mh).map((k) => Math.abs(+k)));
  t('el total mínimo con masa es al menos 2', tMin >= 2, `t mínimo ${tMin}`);
  t('el margen máximo es alcanzable con algún total', mMax <= tMax, `|m| máx ${mMax} · t máx ${tMax}`);

  // ── Y LA DISPERSIÓN NO SE HA ROTO AL CUADRAR LA PARIDAD ──────────────────────────────────────────────
  // Mover el total un punto para cuadrar la paridad no puede cambiar la dispersión de forma apreciable. Si
  // la cambiara, el arreglo estaría distorsionando el modelo en vez de corregir aritmética.
  const sd = (o) => {
    const n = TOT(o); let mu = 0, v = 0;
    for (const [k, p] of Object.entries(o)) mu += (+k) * p / n;
    for (const [k, p] of Object.entries(o)) v += ((+k) - mu) ** 2 * p / n;
    return Math.sqrt(v);
  };
  const sdM = sd(mh), sdT = sd(th);
  t('la desviación del margen sigue en el orden de la NFL', sdM > 8 && sdM < 20, sdM.toFixed(2));
  t('y la del total también', sdT > 6 && sdT < 20, sdT.toFixed(2));

  // ── LA RAMA DEL ATLAS NO TIENE EL PROBLEMA, Y CONVIENE QUE SALTE SI ALGUIEN LA TOCA ──────────────────
  // El atlas copia pares (m, t) de partidos reales, que cumplen las dos condiciones por construcción.
  const ATLAS = [];
  for (let i = 0; i < 1200; i++) {
    const m = ((i * 7919) % 41) - 20;
    const t2 = 30 + ((i * 104729) % 30) * 2 + (Math.abs(m) % 2);   // misma paridad que m, y >= |m|
    ATLAS.push([m, t2, m, t2]);
  }
  const resA = S.simulate({ muMargin: 2.5, muTotal: 44.5, priors: { resid_pool: POOL, outcome_atlas: ATLAS }, n: 20000, seed: 31 });
  if (resA && resA.margin_hist && resA.total_hist) {
    const pmA = PAR(resA.margin_hist) / TOT(resA.margin_hist), ptA = PAR(resA.total_hist) / TOT(resA.total_hist);
    t('la rama del atlas también cuadra la paridad', Math.abs(pmA - ptA) < 0.01,
      `margen par ${pmA.toFixed(4)} · total par ${ptA.toFixed(4)}`);
  } else {
    t('la rama del atlas devuelve histogramas', false, 'no devolvió');
  }
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
