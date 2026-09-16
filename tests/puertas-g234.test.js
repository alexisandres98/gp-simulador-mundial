// tests/puertas-g234.test.js — G2, G3 y G4 EN CÓDIGO (16-sep, E1-E3)
//
// Estaban declaradas en un objeto `PENDIENTES` y no comprobaban nada. Una puerta declarada y no
// implementada es peor que ninguna: da la impresión de que se está comprobando. Lo que se fija aquí es que
// las tres bloqueen por defecto, que cada comprobación tenga un número detrás, y que la secuencia no se
// pueda saltar.
'use strict';
const P = require('../lib/puertas');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };
const chk = (puerta, id) => (puerta.comprobaciones || []).find((x) => x.id === id) || {};

// ── LO QUE NO SE PUEDE COMPROBAR NO PASA ────────────────────────────────────────────────────────────────
for (const [nombre, fn] of [['G2', P.g2], ['G3', P.g3], ['G4', P.g4]]) {
  const r = fn([], {}, {});
  t(`${nombre} sin datos NO pasa`, r.pasa === false, `${r.fallan} fallan · ${r.no_evaluables} no evaluables`);
  t(`${nombre} dice qué la bloquea`, typeof r.bloqueo === 'string' && r.bloqueo.length > 10, String(r.bloqueo).slice(0, 70));
}

// ── G2: LAS CUATRO MANERAS DE HACER TRAMPA SIN QUERER ───────────────────────────────────────────────────
const pros = [];
for (let i = 0; i < 110; i++) pros.push({ status: 'SETTLED', result: i % 2 ? 'WIN' : 'LOSS', units: 1,
  prospectiva: true, cuota_ejecutable: true, event_id: 'ev' + i,
  created_at: new Date(Date.UTC(2026, 7, 10 + (i % 20))).toISOString() });
const declOk = { version_congelada: 'cards_v2', version_hash: 'abc123def456789',
  preregistro: { at: '2026-08-01T00:00:00.000Z', criterio: 'EV al cierre > 0 con t >= 2' } };
const ctxOk = { evaluada: { familias: 6, umbral_p: 0.02 } };

const g2ok = P.g2(pros, declOk, ctxOk);
t('G2 pasa con regla congelada, preregistro anterior, muestra y cuotas ejecutables', g2ok.pasa === true,
  g2ok.bloqueo || 'pasa');

// el preregistro fechado DESPUÉS de la primera observación es el fallo más silencioso de todos
const g2tarde = P.g2(pros, { ...declOk, preregistro: { at: '2026-09-01T00:00:00.000Z' } }, ctxOk);
t('G2 FALLA si el criterio se escribió después de la primera observación',
  chk(g2tarde, 'preregistro').estado === 'falla', chk(g2tarde, 'preregistro').texto);

const g2pocos = P.g2(pros.slice(0, 40), declOk, ctxOk);
t('G2 falla con muestra prospectiva corta', chk(g2pocos, 'muestra_prospectiva').estado === 'falla',
  chk(g2pocos, 'muestra_prospectiva').texto);

const noEj = pros.map((p, i) => (i < 30 ? { ...p, cuota_ejecutable: false } : p));
const g2ej = P.g2(noEj, declOk, ctxOk);
t('G2 falla si las cuotas no se pudieron tomar', chk(g2ej, 'cuotas_ejecutables').estado === 'falla',
  chk(g2ej, 'cuotas_ejecutables').texto);
t('y explica por qué eso infla la ventaja', /siempre hacia el mismo lado/.test(chk(g2ej, 'cuotas_ejecutables').texto));

const g2sinHash = P.g2(pros, { ...declOk, version_hash: null }, ctxOk);
t('G2 no pasa sin el hash de la regla', g2sinHash.pasa === false && chk(g2sinHash, 'version_congelada').estado === 'no_evaluable');

// ── G3: SON FRENOS, NO ESTADÍSTICA ──────────────────────────────────────────────────────────────────────
const reales = Array.from({ length: 25 }, (_, i) => ({ real: true, id: 'r' + i }));
const g3ok = P.g3(reales, { presupuesto_perdida: 500, moneda: 'USDT', limite_evento: 40, limite_dia: 120,
  conciliacion_descuadre_pct: 0.2 });
t('G3 pasa con presupuesto, topes, conciliación y órdenes', g3ok.pasa === true, g3ok.bloqueo || 'pasa');
t('G3 lleva SIEMPRE el aviso de que no valida el edge',
  (g3ok.comprobaciones || []).some((x) => x.id === 'no_valida_el_edge' && x.estado === 'aviso'),
  JSON.stringify((g3ok.comprobaciones || []).map((x) => x.id)));
t('y el aviso NO cuenta para pasar o fallar', g3ok.pasan + g3ok.fallan + g3ok.no_evaluables === 4,
  `${g3ok.pasan}+${g3ok.fallan}+${g3ok.no_evaluables}`);
const g3desc = P.g3(reales, { presupuesto_perdida: 500, limite_evento: 40, limite_dia: 120, conciliacion_descuadre_pct: 4 });
t('G3 falla si el libro no cuadra con el de la casa', chk(g3desc, 'conciliacion').estado === 'falla',
  chk(g3desc, 'conciliacion').texto);

// ── G4: LA CAPACIDAD NO SE EXTRAPOLA ────────────────────────────────────────────────────────────────────
const evBueno = { media: 1.8, t: 3.1, n_clusters: 350 };
const g4ok = P.g4([], { degradacion_pp: 0.4, drawdown_max_pct: 12, subida_gradual: true }, { ev: evBueno });
t('G4 pasa con EV neto, capacidad medida, drawdown y subida gradual', g4ok.pasa === true, g4ok.bloqueo || 'pasa');
const g4sinCap = P.g4([], { drawdown_max_pct: 12, subida_gradual: true }, { ev: evBueno });
t('G4 NO pasa si nadie probó el tamaño siguiente', g4sinCap.pasa === false
  && chk(g4sinCap, 'capacidad').estado === 'no_evaluable', chk(g4sinCap, 'capacidad').texto);
t('y lo dice con esas palabras', /no se extrapola, se mide/.test(chk(g4sinCap, 'capacidad').texto));
const g4caro = P.g4([], { degradacion_pp: 3, drawdown_max_pct: 12, subida_gradual: true }, { ev: evBueno });
t('G4 falla si el tamaño se come la ventaja', chk(g4caro, 'capacidad').estado === 'falla',
  chk(g4caro, 'capacidad').texto);
const g4pocos = P.g4([], { degradacion_pp: 0.4, drawdown_max_pct: 12, subida_gradual: true },
  { ev: { media: 1.8, t: 3.1, n_clusters: 120 } });
t('G4 pide más eventos que G1: 300, no 100', chk(g4pocos, 'rentabilidad_neta').estado === 'falla',
  chk(g4pocos, 'rentabilidad_neta').texto);

// ── LA SECUENCIA NO SE SALTA ────────────────────────────────────────────────────────────────────────────
const r0 = P.evalua('sin_nada', [], {});
t('una familia que no pasa G0 ni siquiera tiene bloque G2', r0.puerta_actual === 'G0' && !r0.G2);
t('y se dice por qué no se evalúa G1', /midiendo el desorden/.test(String(r0.G1.no_evaluada)));

// ── CRUZAR LAS CINCO NO ENCIENDE NADA ───────────────────────────────────────────────────────────────────
t('el listón de G4 exige más eventos que el de G1', P.LISTONES.g4_eventos_min > P.LISTONES.n_eventos_min,
  `${P.LISTONES.g4_eventos_min} vs ${P.LISTONES.n_eventos_min}`);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
