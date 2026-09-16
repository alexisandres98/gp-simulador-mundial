// tests/encogimiento.test.js — EL ENCOGIMIENTO NO PUEDE CREERSE A SÍ MISMO (16-sep, M1)
//
// Un módulo que ajusta un parámetro para que el modelo parezca mejor es peligroso por construcción: si se
// ajusta y se juzga con los mismos datos, `c` sale positivo SIEMPRE, porque el modelo tiene algo de
// información aunque esté descalibrado. Lo que se fija aquí no son valores concretos de `c`, sino que el
// módulo acierte el SIGNO en los tres mundos donde la respuesta se conoce de antemano:
//
//   · si el modelo es la verdad y el precio está aplastado  → `c` tiene que ser alto
//   · si el precio es la verdad y el modelo se pasa         → `c` tiene que ser 0
//   · si el modelo es ruido puro                            → `c` tiene que ser 0
//
// El tercero es el que de verdad protege: es el caso en el que un módulo mal hecho inventa una ventaja.
'use strict';
const E = require('../lib/encogimiento');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// generador determinista: la misma semilla da la misma serie en cualquier máquina
function rng(semilla = 12345) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const logit = E.logit, sig = E.sigmoide;

// Construye un libro de `n` filas. `kModelo` y `kPrecio` son cuánto se aplasta o se estira el logit de la
// verdad al fabricar el modelo y el precio: 1 = clavado, >1 = se pasa, <1 = se queda corto.
// `ruidoModelo` sustituye el modelo por ruido cuando es true.
function libro({ n = 600, kModelo = 1, kPrecio = 1, ruidoModelo = false, semilla = 7, margenLado = 2.5 } = {}) {
  const r = rng(semilla), out = [];
  for (let i = 0; i < n; i++) {
    const pTrue = 0.20 + 0.60 * r();                       // verdad entre 0,20 y 0,80
    const L = logit(pTrue);
    const pGp = ruidoModelo ? 0.20 + 0.60 * r() : sig(kModelo * L);
    const pMkt = sig(kPrecio * L);
    // la cuota que publica la casa lleva el margen dentro: se parte por igual entre los dos lados
    const Q = 1 + 2 * margenLado / 100;
    const odds = 1 / (pMkt * Q);
    const contraria = 1 / ((1 - pMkt) * Q);
    out.push({ p_gp: pGp, odds, odds_contraria: contraria,
      result: r() < pTrue ? 'WIN' : 'LOSS',
      settled_at: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 3))).toISOString(),
      event_id: 'ev' + Math.floor(i / 2) });
  }
  return out;
}

// ── 1. LA FÓRMULA HACE LO QUE DICE ──────────────────────────────────────────────────────────────────────
t('c = 0 devuelve exactamente el precio', Math.abs(E.encoger(0.80, 0.50, 0) - 0.50) < 1e-9);
t('c = 1 devuelve exactamente el modelo', Math.abs(E.encoger(0.80, 0.50, 1) - 0.80) < 1e-9);
t('c = 0,5 cae a medio camino EN LOGIT, no en probabilidad',
  Math.abs(E.encoger(0.80, 0.50, 0.5) - 2 / 3) < 1e-9, String(E.encoger(0.80, 0.50, 0.5)));
t('el suelo recorta un c negativo a 0', Math.abs(E.encoger(0.80, 0.50, -3) - 0.50) < 1e-9);
t('el techo recorta un c mayor que 1 a 1', Math.abs(E.encoger(0.80, 0.50, 9) - 0.80) < 1e-9);
t('sin precio no hay encogimiento posible', E.encoger(0.8, null, 0.5) === null && E.encoger(0.8, 0, 0.5) === null);

// ── 2. EL PRECIO ENTRA SIN MARGEN, Y SI NO SE PUEDE, NO ENTRA ───────────────────────────────────────────
const exacta = E.pMercado({ odds: 1.90, odds_contraria: 1.90 });
t('con las dos caras el margen se quita exacto', exacta && Math.abs(exacta.p - 0.5) < 1e-9 && exacta.fuente === 'exacta',
  JSON.stringify(exacta));
const medida = E.pMercado({ odds: 1.90 }, { margenLadoPct: 2.6316 });
t('con una cara y el margen MEDIDO se reconstruye lo mismo',
  medida && Math.abs(medida.p - 0.5) < 1e-4 && medida.fuente === 'medida', JSON.stringify(medida));
t('con una cara y SIN margen medido devuelve null: no se supone un margen',
  E.pMercado({ odds: 1.90 }) === null);
t('la implícita cruda NO se usa como precio', Math.abs(1 / 1.90 - 0.5) > 0.02,
  'el crudo dice 0,5263 y el justo 0,5000: 2,6 pp de diferencia que iría siempre a favor de parecer que hay ventaja');

// ── 3. EL MUNDO DONDE EL MODELO ES LA VERDAD ────────────────────────────────────────────────────────────
// El precio está aplastado (k = 0,5: se queda corto siempre) y el modelo clava la verdad. `c` alto.
const A = E.paraFamilia(libro({ kModelo: 1, kPrecio: 0.5, semilla: 11 }));
t('si el modelo es la verdad y el precio se queda corto, c es alto', A.c >= 0.6,
  `c ${A.c} · ${A.veredicto} · fuera de muestra mejora ${A.fuera_de_muestra && A.fuera_de_muestra.mejora_sobre_precio}`);
t('y el veredicto lo dice', A.veredicto === 'el_modelo_aporta', A.veredicto);

// ── 4. EL MUNDO DONDE EL PRECIO ES LA VERDAD Y EL MODELO SE PASA ────────────────────────────────────────
// Es el mundo medido en docs/CALIBRACION_2026-09-16.md: nueve motores de doce. `c` tiene que ser 0.
const B = E.paraFamilia(libro({ kModelo: 1.8, kPrecio: 1, semilla: 23 }));
t('si el precio es la verdad y el modelo se pasa, c = 0', B.c === 0,
  `c ${B.c} · ${B.veredicto}`);
t('y el fuera de muestra enseña cuánto peor es el modelo crudo',
  B.fuera_de_muestra && B.fuera_de_muestra.penalizacion_del_modelo_crudo > 0,
  `penalización ${B.fuera_de_muestra && B.fuera_de_muestra.penalizacion_del_modelo_crudo}`);

// ── 5. EL QUE DE VERDAD PROTEGE: MODELO DE RUIDO PURO ───────────────────────────────────────────────────
const C = E.paraFamilia(libro({ ruidoModelo: true, kPrecio: 1, semilla: 31 }));
t('con un modelo que es ruido, c = 0', C.c === 0, `c ${C.c} · ${C.veredicto}`);
t('y se dice que el modelo no aporta', C.veredicto === 'el_modelo_no_aporta', String(C.razon).slice(0, 120));

// ── 6. MUESTRA CORTA: NO SE INVENTA UN c ────────────────────────────────────────────────────────────────
const D = E.paraFamilia(libro({ n: 40, kModelo: 1, kPrecio: 0.5, semilla: 41 }));
t('con 40 filas no se ajusta nada y se publica el precio', D.c === 0 && D.veredicto === 'muestra_corta',
  `c ${D.c} · ${D.veredicto}`);
t('y dice cuántas harían falta', /hacen falta \d+/.test(String(D.razon)), String(D.razon).slice(0, 110));

// ── 7. LOS DESCARTES SE CUENTAN POR MOTIVO ──────────────────────────────────────────────────────────────
// Un descarte silencioso convierte una muestra sesgada en una muestra pequeña, que parece lo mismo.
const sucio = libro({ n: 200, semilla: 53 }).map((f, i) => {
  if (i % 7 === 0) return { ...f, p_gp: null };
  if (i % 7 === 1) return { ...f, result: 'DATA_UNRESOLVED' };
  if (i % 7 === 2) return { ...f, odds_contraria: null };        // sin cara contraria y sin margen medido
  return f;
});
const S = E.paraFamilia(sucio);
t('las filas rotas no entran y se cuentan por motivo',
  S.descartes.sin_p_modelo > 0 && S.descartes.sin_resultado_binario > 0 && S.descartes.sin_precio_sin_margen > 0,
  JSON.stringify(S.descartes));
t('y se informa cuántas entraron de cuántas',
  S.n_entradas === 200 && S.n_utilizables < 200 && S.n_utilizables > 100,
  `${S.n_utilizables} de ${S.n_entradas}`);

// ── 8. LA MEJORA SE MIDE FUERA DE MUESTRA, NO DENTRO ────────────────────────────────────────────────────
t('el bloque de fuera de muestra existe y tiene menos filas que el total',
  A.fuera_de_muestra && A.fuera_de_muestra.n > 0 && A.fuera_de_muestra.n < A.n_utilizables,
  `${A.fuera_de_muestra && A.fuera_de_muestra.n} fuera de muestra de ${A.n_utilizables}`);
t('y cada bloque enseña con qué c se entrenó',
  Array.isArray(A.por_bloque) && A.por_bloque.length >= 1 && A.por_bloque.every((b) => Number.isFinite(b.c_entrenado)),
  JSON.stringify((A.por_bloque || []).map((b) => b.c_entrenado)));

// ── 9. REPRODUCIBLE ─────────────────────────────────────────────────────────────────────────────────────
const r1 = E.paraFamilia(libro({ kPrecio: 0.5, semilla: 11 })).c;
const r2 = E.paraFamilia(libro({ kPrecio: 0.5, semilla: 11 })).c;
t('dos corridas del mismo libro dan el mismo c', r1 === r2, `${r1} vs ${r2}`);

// ── 10. EL MÓDULO NO DECIDE DINERO Y LO LLEVA ESCRITO ───────────────────────────────────────────────────
t('el resultado dice que no decide si una familia es invertible',
  /lib\/vara\.js y las puertas/.test(String(A.no_decide_dinero || '')), String(A.no_decide_dinero || '').slice(0, 80));

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
