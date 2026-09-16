// tests/puertas.test.js — LAS CINCO PUERTAS (Fase 3, 16-sep-2026)
//
// Lo que este test fija no son umbrales: es la POSTURA del módulo. Una puerta solo sirve si lo que no se
// puede comprobar bloquea igual que lo que falla. Si `no_evaluable` pasara, una familia sin datos cruzaría
// las cinco puertas por no tener nada que la contradiga — que es literalmente cómo `cards_under_v1` acabó
// con dinero real sin haber demostrado nada.
'use strict';
const P = require('../lib/puertas');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

const DECL_OK = { contrato_documentado: true, liquidador_concuerda: true, walkforward: true, competidores: true, costes: 0 };
const CTX_OK = { evaluada: { familias: 12, umbral_p: 0.0714 } };

// Un libro sano: 120 eventos, dos tickets por evento, las dos caras del cierre, y una ventaja real.
function libro({ n = 240, conContraria = 1, ev = 'positivo', sinResolver = 0, enVivo = 0 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const evento = 'ev' + Math.floor(i / 2);
    // cierre 1,90/1,95 → Q = 1,0391, justa ≈ 0,5067. A 2,05 el EV es +3,9 %; a 1,80 es −8,8 %.
    // LA ENTRADA VARÍA A PROPÓSITO. Con todos los tickets al mismo precio el EV es idéntico en todos, la
    // varianza entre racimos es cero y `bootstrapClusters` devuelve t nulo — que es lo correcto y lo que la
    // guarda del 15-sep existe para hacer, pero convierte el fixture en degenerado. Un libro real tiene
    // dispersión de precio de entrada, así que el fixture también.
    const jitter = ((i * 7919) % 17 - 8) / 100;          // ±0,08 determinista, sin Math.random
    const odds = +((ev === 'positivo' ? 2.05 : 1.80) + jitter).toFixed(3);
    const p = { status: 'SETTLED', result_code: i % 2 ? 'WIN' : 'LOSS', units: i % 2 ? 1 : -1,
      odds, close_para_ev: 1.90, close_odds: 1.90, event_id: evento, line: 5.5, book: 'cloudbet',
      close_captura: i < enVivo ? 'in_play' : 'prepartido' };
    if (i < n * conContraria) p.close_odds_contraria = 1.95;
    out.push(p);
  }
  for (let i = 0; i < sinResolver; i++) out.push({ status: 'SETTLED', result_code: 'DATA_UNRESOLVED', event_id: 'nr' + i, odds: 1.9, book: 'cloudbet' });
  return out;
}

// ── 1. LO QUE NO SE PUEDE COMPROBAR BLOQUEA ──────────────────────────────────────────────────────────────
const sinDecl = P.evalua('prueba', libro(), {}, CTX_OK);
t('sin declaraciones, G0 NO pasa', sinDecl.G0.pasa === false);
t('y el motivo es que nadie declaró el contrato', /reglamento/.test(sinDecl.G0.bloqueo || ''), sinDecl.G0.bloqueo);
t('y no se evalúa G1 de una familia que no pasó G0', !!sinDecl.G1.no_evaluada);
t('las no evaluables se cuentan aparte de las que fallan', sinDecl.G0.no_evaluables >= 2 && sinDecl.G0.fallan === 0,
  `fallan ${sinDecl.G0.fallan}, no evaluables ${sinDecl.G0.no_evaluables}`);

// ── 2. UN LIBRO SANO Y DECLARADO PASA G0 ─────────────────────────────────────────────────────────────────
const sano = P.evalua('prueba', libro(), DECL_OK, CTX_OK);
t('con el libro sano y las declaraciones, G0 pasa', sano.G0.pasa === true, sano.G0.bloqueo || '');

// ── 3. G1 EXIGE EV POSITIVO **Y** MUESTRA ────────────────────────────────────────────────────────────────
t('con ventaja real y 120 eventos, G1 pasa', sano.G1.pasa === true, sano.G1.bloqueo || '');
t('y entonces la familia queda a las puertas de G2', sano.puerta_actual === 'G2');

const negativo = P.evalua('prueba', libro({ ev: 'negativo' }), DECL_OK, CTX_OK);
t('con EV negativo, G1 NO pasa', negativo.G1.pasa === false);
t('y lo dice con el número', /EV -/.test(negativo.G1.bloqueo || ''), negativo.G1.bloqueo);

const corto = P.evalua('prueba', libro({ n: 80 }), DECL_OK, CTX_OK);
t('con 40 eventos, G1 NO pasa aunque el EV sea positivo', corto.G1.pasa === false);
t('y el motivo es la muestra, no el signo', /hacen falta 100/.test(JSON.stringify(corto.G1.comprobaciones)));

// ── 4. LAS TRES COMPROBACIONES DE INTEGRIDAD QUE SE MIDEN SOBRE EL LIBRO ─────────────────────────────────
const pocaContraria = P.evalua('prueba', libro({ conContraria: 0.2 }), DECL_OK, CTX_OK);
t('con solo el 20 % de cierres de dos caras, G0 NO pasa', pocaContraria.G0.pasa === false);
t('y el motivo es el margen que no se puede quitar', /margen/.test(pocaContraria.G0.bloqueo || ''), pocaContraria.G0.bloqueo);

const muchosSinResolver = P.evalua('prueba', libro({ n: 100, sinResolver: 30 }), DECL_OK, CTX_OK);
t('con un 23 % sin resolver, G0 NO pasa', muchosSinResolver.G0.pasa === false);
t('y dice que la muestra está seleccionada por la ausencia de dato',
  /seleccionada/.test(JSON.stringify(muchosSinResolver.G0.comprobaciones)));

const muchoEnVivo = P.evalua('prueba', libro({ enVivo: 60 }), DECL_OK, CTX_OK);
t('con un 25 % de cierres capturados en vivo, G0 NO pasa', muchoEnVivo.G0.pasa === false);

// ── 5. LAS PUERTAS SON SECUENCIALES, Y DESDE EL 16-SEP LAS CINCO COMPRUEBAN ─────────────────────────────
// Hasta el 16-sep, G2, G3 y G4 vivían en un objeto `PENDIENTES` con la lista de lo que HABRÍA que
// comprobar, y este test comprobaba que estuvieran escritas. Ahora están implementadas (E1-E3), así que lo
// que hay que fijar es otra cosa: que la secuencia no se pueda saltar y que ninguna pase sin datos. El
// detalle de cada una vive en tests/puertas-g234.test.js.
t('las tres puertas nuevas existen como funciones', ['g2', 'g3', 'g4'].every((k) => typeof P[k] === 'function'));
t('y ninguna pasa sin datos', [P.g2, P.g3, P.g4].every((f) => f([], {}, {}).pasa === false));
t('G3 lleva escrita la advertencia de las veinte órdenes',
  /veinte órdenes/.test(JSON.stringify(P.g3([], {}, {}).comprobaciones)));
// la secuencia: una familia que no pasa G0 no llega ni a tener bloque G2
const cortada = P.evalua('prueba', [], {});
t('sin pasar G0 no hay bloque G2', cortada.puerta_actual === 'G0' && !cortada.G2);

// ── 6. LOS COSTES SE DESCUENTAN DE VERDAD ────────────────────────────────────────────────────────────────
// Polymarket cobra por fill: con la comisión puesta, una ventaja pequeña deja de serlo. Si esto no restara,
// la puerta aprobaría familias que pierden dinero justo por lo que cobra la casa.
const conCostes = P.evalua('prueba', libro(), { ...DECL_OK, costes: 0.05 }, CTX_OK);
t('con un 5 % de costes, la misma familia ya no pasa G1', conCostes.G1.pasa === false,
  conCostes.G1.bloqueo || '');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
