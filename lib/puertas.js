// lib/puertas.js — LAS CINCO PUERTAS, CONVERTIDAS EN CÓDIGO (16-sep-2026, Fase 3 de la auditoría externa).
//
// POR QUÉ ESTO ES CÓDIGO Y NO UN DOCUMENTO. La auditoría dejó escritas cinco puertas —G0 a G4— que una
// familia tiene que cruzar antes de que se hable de dinero. Escritas en un documento son doctrina: alguien
// las recuerda, alguien las interpreta y alguien acaba saltándoselas sin querer, que es exactamente la
// historia de `cards_under_v1`. Aquí una familia no «cumple más o menos G0»: o pasa cada comprobación con
// un número detrás, o no pasa, y se dice cuál falla.
//
// LA REGLA DE ORO DE ESTE MÓDULO: lo que no se puede comprobar NO pasa por defecto. Una comprobación sin
// datos devuelve `no_evaluable`, y `no_evaluable` bloquea igual que un fallo. Es lo contrario de lo que
// hacía el sistema hasta ahora —donde la ausencia de evidencia se leía como ausencia de problema— y es la
// única forma de que una puerta signifique algo.
//
// Y LAS PUERTAS SON SECUENCIALES. No se evalúa G1 de una familia que no ha pasado G0: si el libro, los
// cierres o el contrato no están en orden, cualquier medición de señal está midiendo el desorden. Eso
// también es una lección cara: el CLV de CS2 llevaba meses siendo positivo y significativo sobre un libro
// cuyo emparejado de caras estaba mal.
//
// ESTE MÓDULO NO DECIDE NADA SOBRE DINERO. Dice en qué puerta está cada familia y qué le falta. Encender o
// apagar un canal sigue siendo decisión de Alexis, y la regla del dinero del 13-sep sigue por encima de
// todo esto.
'use strict';

const INF = require('./inferencia');

// ══ LOS LISTONES, EN UN SOLO SITIO ════════════════════════════════════════════════════════════════════
// Salen de la auditoría y de lo medido, no de la intuición. Cambiarlos es una decisión, así que viven
// juntos y con su procedencia escrita al lado.
const LISTONES = {
  // G0
  cierre_valorable_min: 0.50,   // la mitad de las liquidadas tiene que tener las dos caras del cierre
  sin_resolver_max: 0.05,       // por encima del 5 % sin resultado, el ROI y el EV están seleccionados
  in_play_max: 0.10,            // cierres capturados con el partido rodando
  cruce_filial_max: 0.02,       // liquidadas emparejando un equipo con su academia o su segundo roster
  // G1 — los de `lib/vara.js`, repetidos aquí para que la puerta sea legible sin abrir otro archivo
  ev_t_min: 2,                  // t sobre RACIMOS DE EVENTO, no sobre tickets
  n_eventos_min: 100,           // §5.3: 100 tickets es control operativo, no certificación
  bh_q: 0.10,
};

const pct = (a, b) => (b > 0 ? +(100 * a / b).toFixed(1) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// Una comprobación: pasa, falla o no se puede evaluar. Las tres son estados distintos y las tres se
// publican; colapsar `no_evaluable` en `falla` escondería la diferencia entre «está mal» y «no lo sabemos»,
// que es justo la distinción que la auditoría vino a rescatar.
const ok = (id, texto, dato) => ({ id, estado: 'pasa', texto, dato });
const mal = (id, texto, dato) => ({ id, estado: 'falla', texto, dato });
const nose = (id, texto, dato) => ({ id, estado: 'no_evaluable', texto, dato });

// ══ G0 — INTEGRIDAD ═══════════════════════════════════════════════════════════════════════════════════
// «Contratos, pagos, identidad, tiempos, libro y cierres reconciliados; ningún P0 abierto en la ruta.»
//
// Se evalúa sobre el LIBRO REAL de la familia, no sobre una declaración. `decl` trae lo que no se puede
// deducir de los tickets —si el reglamento de la casa está documentado, si el liquidador usa esa regla— y
// esas dos son las únicas que dependen de que alguien haya hecho un trabajo y lo haya anotado.
function g0(picks, decl = {}) {
  const c = [];
  const liq = (picks || []).filter((p) => esLiquidada(p));
  const n = liq.length;

  // 1. CONTRATO. Saber qué paga la casa no es un detalle administrativo: en tarjetas, no saberlo costó
  //    2,63 pp de probabilidad en la línea que apostábamos, siempre a favor de parecer mejores.
  c.push(decl.contrato_documentado === true
    ? ok('contrato', 'el reglamento de la casa para esta familia está documentado y fechado', decl.contrato_ref || null)
    : decl.contrato_documentado === false
      ? mal('contrato', 'el reglamento de la casa para esta familia NO está documentado: no sabemos qué paga', null)
      : nose('contrato', 'nadie ha declarado si el reglamento de la casa está documentado', null));

  // 2. PAGOS. Que NUESTRO liquidador cuente lo mismo que la casa. Dos apuestas reales de tarjetas se
  //    liquidaron a nuestro favor y la casa las pagó como perdidas.
  c.push(decl.liquidador_concuerda === true
    ? ok('pagos', 'el liquidador usa la regla de la casa', decl.liquidador_ref || null)
    : decl.liquidador_concuerda === false
      ? mal('pagos', 'el liquidador NO usa la regla de la casa: el track dice otra cosa que el dinero', null)
      : nose('pagos', 'nadie ha comprobado que el liquidador concuerde con la casa', null));

  // 3. IDENTIDAD. Selección, línea y cuota viajan juntas. Sin esto se valora una línea con el precio de
  //    otra, y ese error infla la ventaja SIEMPRE en la misma dirección.
  const conLinea = liq.filter((p) => p.line != null).length;
  const conCasa = liq.filter((p) => p.book || p.casa || p.best_book).length;
  c.push(n === 0 ? nose('identidad', 'sin liquidadas no hay nada que comprobar', null)
    : conCasa === n
      ? ok('identidad', 'todas las filas declaran su casa', { con_casa: conCasa, n })
      : mal('identidad', `${n - conCasa} de ${n} filas no declaran casa: su precio no se puede atribuir a ningún libro`, { con_casa: conCasa, n }));

  // 4. TIEMPOS. Un cierre capturado con el partido rodando no es un cierre.
  const etiquetadas = liq.filter((p) => p.close_captura != null).length;
  const enVivo = liq.filter((p) => p.close_captura === 'in_play').length;
  c.push(etiquetadas === 0
    ? nose('tiempos', 'ninguna fila lleva etiqueta de captura: no se sabe si los cierres son prepartido', { etiquetadas, n })
    : (enVivo / Math.max(1, etiquetadas)) <= LISTONES.in_play_max
      ? ok('tiempos', `${pct(enVivo, etiquetadas)} % de los cierres etiquetados se capturaron en vivo`, { en_vivo: enVivo, etiquetadas })
      : mal('tiempos', `${pct(enVivo, etiquetadas)} % de los cierres se capturaron con el partido rodando (tope ${100 * LISTONES.in_play_max} %)`, { en_vivo: enVivo, etiquetadas }));

  // 5. LIBRO. Que exista ticket a ticket y fuera del contenedor. Ocho motores no lo tenían hasta el 15-sep,
  //    y por eso la vara no podía juzgarlos.
  c.push(n > 0 ? ok('libro', `${n} filas liquidadas legibles ticket a ticket`, { n })
    : nose('libro', 'el libro no trae liquidadas', { n }));

  // 6. SIN RESOLVER. Un resultado que no se encuentra no es una devolución; si son muchos, el ROI y el EV
  //    están calculados sobre una muestra seleccionada por la propia ausencia de dato.
  const sinRes = (picks || []).filter((p) => /DATA_UNRESOLVED/i.test(String(p.result_code || p.result || ''))).length;
  const base = n + sinRes;
  // LA FRASE «LA MUESTRA ESTÁ SELECCIONADA» ERA UNA SUPOSICIÓN, Y AHORA SE MIDE (16-sep). El tope del 5 %
  // presume que un hueco grande sesga, pero lo que sesga no es el tamaño del hueco: es que el hueco esté
  // relacionado con el resultado. `lib/ausencia.js` lo contrasta —cuota, probabilidad del modelo como
  // placebo, composición— y su veredicto se adjunta aquí como DIAGNÓSTICO.
  //
  // EL LISTÓN NO SE MUEVE. Un 12 % con ausencia demostrablemente ignorable sigue fallando G0: relajar un
  // listón del sistema es decisión de Alexis, no de este archivo (regla del dinero, 13-sep). Lo único que
  // cambia es que el motivo del fallo deja de ser una presunción y pasa a ser una medición — que en CS2
  // resultó CONFIRMAR el sesgo (las ausentes tienen cuota más corta y más probabilidad del modelo), así
  // que el tope estaba protegiendo algo real y conviene que conste.
  let diagAusencia = null;
  if (sinRes > 0 && base > 0) {
    try {
      const AU = require('./ausencia');
      const a = AU.examinaLibro(picks || []);
      diagAusencia = { veredicto: a.veredicto, razon: a.razon,
        contrastes_que_pasan_bh: (a.contrastes || []).filter((x) => x.significativa_bh)
          .map((x) => ({ que: x.etiqueta, obs: x.media_obs, aus: x.media_aus, t: x.t, p: x.p, placebo: !!x.placebo })),
        concentracion: a.concentracion };
    } catch (e) { diagAusencia = { veredicto: 'no_medible', razon: e.message }; }
  }
  c.push(base === 0 ? nose('sin_resolver', 'sin muestra', null)
    : (sinRes / base) <= LISTONES.sin_resolver_max
      ? ok('sin_resolver', `${pct(sinRes, base)} % sin resultado localizable`, { sin_resolver: sinRes, base, ausencia: diagAusencia })
      : mal('sin_resolver', `${pct(sinRes, base)} % sin resultado localizable (tope ${100 * LISTONES.sin_resolver_max} %)`
        + (diagAusencia ? ` · prueba de ausencia: ${diagAusencia.veredicto}` : ''),
      { sin_resolver: sinRes, base, ausencia: diagAusencia }));

  // 6b. IDENTIDAD DEL RIVAL: EL CRUCE DE FILIALES (16-sep). Una apuesta liquidada con el resultado del otro
  //     roster de la misma marca no es un resultado ruidoso: es el resultado de otro partido. El emparejado
  //     laxo del liquidador no puede distinguir "Vivo Keyd Stars ↔ Keyd Stars" (mismo equipo, patrocinador
  //     delante) de "Spirit Academy ↔ Spirit" (dos equipos), y en el libro de CS2 cruzan ≈65 tickets. No se
  //     re-liquidan —los datos no permiten decidir hacia qué lado está el error— pero SÍ se cuentan, y por
  //     encima del 2 % de las liquidadas la familia no puede decir que su libro esté en orden.
  const filial = liq.filter((p) => p.casado_por === 'aproximado_filial').length;
  c.push(n === 0 ? nose('identidad_filial', 'sin liquidadas', null)
    : (filial / n) <= LISTONES.cruce_filial_max
      ? ok('identidad_filial', filial ? `${pct(filial, n)} % liquidadas con un emparejado que cruza equipo y filial` : 'ningún emparejado cruza equipo y filial',
        { cruces: filial, n })
      : mal('identidad_filial', `${pct(filial, n)} % de las liquidadas se emparejó cruzando equipo y filial (tope ${100 * LISTONES.cruce_filial_max} %): `
        + 'esos tickets pueden estar liquidados con el partido de otro roster', { cruces: filial, n }));

  // 7. CIERRES RECONCILIADOS. Las dos caras del mismo contrato, en la misma casa, de la misma pasada. Es
  //    lo único que permite quitar el margen, y sin quitarlo no hay retorno esperado que valga.
  const conContraria = liq.filter((p) => Number(p.close_odds_contraria) > 1).length;
  c.push(n === 0 ? nose('cierres', 'sin liquidadas', null)
    : (conContraria / n) >= LISTONES.cierre_valorable_min
      ? ok('cierres', `${pct(conContraria, n)} % de las liquidadas tienen las dos caras del cierre`, { con_contraria: conContraria, n })
      : mal('cierres', `solo el ${pct(conContraria, n)} % tiene las dos caras del cierre (hace falta ${100 * LISTONES.cierre_valorable_min} %): sin la contraria no se puede quitar el margen`, { con_contraria: conContraria, n }));

  return cierra('G0', 'integridad', c);
}

// ══ G1 — SEÑAL HISTÓRICA ══════════════════════════════════════════════════════════════════════════════
// «Walk-forward anidado, competidores obligatorios, universo completo, diferencia pareada con IC por
// clusters, selección y costes incluidos.»
//
// Las dos primeras son declaraciones (¿se corrió el challenger? ¿con competidores?) porque no se pueden
// deducir de los tickets. Las tres últimas SÍ se miden aquí, sobre el libro.
function g1(picks, decl = {}, { evaluada = null } = {}) {
  const c = [];
  const liq = (picks || []).filter(esLiquidada);

  c.push(decl.walkforward === true
    ? ok('walkforward', 'hay validación hacia adelante con hiperparámetros elegidos dentro del entrenamiento', decl.walkforward_ref || null)
    : decl.walkforward === false
      ? mal('walkforward', 'no hay validación hacia adelante: el ajuste vio el futuro', null)
      : nose('walkforward', 'nadie ha declarado si existe validación hacia adelante', null));

  c.push(decl.competidores === true
    ? ok('competidores', 'el modelo se comparó contra competidores obligatorios, no solo contra sí mismo', decl.competidores_ref || null)
    : decl.competidores === false
      ? mal('competidores', 'el modelo no se ha comparado con ninguna alternativa: ganar a nada no es ganar', null)
      : nose('competidores', 'nadie ha declarado si hubo competidores', null));

  // EL EV, QUE ES EL VEREDICTO. Con incertidumbre por racimos de evento: dos líneas del mismo partido no
  // son dos observaciones, y tratarlas como tales multiplica el t por la raíz del tamaño del racimo.
  const conEv = liq.filter((p) => Number(p.close_odds_contraria) > 1 && Number(p.odds) > 1);
  if (conEv.length < 30) {
    c.push(nose('ev', `solo ${conEv.length} tickets con cierre valorable: no hay con qué estimar el EV`, { n: conEv.length }));
    c.push(nose('muestra', 'sin EV no se puede juzgar la muestra', null));
  } else {
    const EVm = require('./ev');
    const tickets = conEv.map((p) => {
      const cierre = Number(p.close_para_ev || p.close_own || p.close_odds || p.close_price);
      const e = EVm.evDeTicket({ entrada: Number(p.odds), cierre, cierreContraria: Number(p.close_odds_contraria), costes: decl.costes || 0 });
      return e.ok ? { valor: e.ev_pct, racimo: p.event_id || p.ceid || p.match || p.key } : null;
    }).filter(Boolean);
    const ic = INF.bootstrapClusters(tickets, { valor: (x) => x.valor, cluster: (x) => x.racimo, replicas: 2000, semilla: 20260916 });
    const nEv = ic.n_clusters;
    const positivo = ic.media > 0 && ic.t != null && ic.t >= LISTONES.ev_t_min;
    c.push(positivo
      ? ok('ev', `EV ${r2(ic.media)} % con t ${r2(ic.t)} sobre ${nEv} eventos`, { ev: r2(ic.media), t: r2(ic.t), n_eventos: nEv })
      : mal('ev', `EV ${r2(ic.media)} % con t ${ic.t == null ? '—' : r2(ic.t)} sobre ${nEv} eventos: no hay señal positiva que llevar a sombra`, { ev: r2(ic.media), t: r2(ic.t), n_eventos: nEv, ic: ic.ic }));
    c.push(nEv >= LISTONES.n_eventos_min
      ? ok('muestra', `${nEv} eventos con cierre valorable`, { n_eventos: nEv })
      : mal('muestra', `${nEv} eventos con cierre valorable, hacen falta ${LISTONES.n_eventos_min}`, { n_eventos: nEv }));
  }

  // COSTES. Polymarket cobra por fill; las casas de cuota fija no, pero el margen ya está dentro del EV.
  c.push(decl.costes != null
    ? ok('costes', `los costes de ejecución están declarados (${decl.costes} del stake) y descontados del EV`, { costes: decl.costes })
    : nose('costes', 'nadie ha declarado los costes de ejecución de esta familia', null));

  // COMPARACIONES MÚLTIPLES. El umbral corregido lo pone quien evalúa el conjunto; aquí solo se exige que
  // exista, porque juzgar una familia aislada cuando se están mirando treinta es cómo salen los falsos.
  c.push(evaluada != null && evaluada.umbral_p != null
    ? ok('comparaciones', `umbral corregido por Benjamini–Hochberg al ${100 * LISTONES.bh_q} % sobre ${evaluada.familias} familias: p ≤ ${evaluada.umbral_p}`, evaluada)
    : nose('comparaciones', 'no se ha aplicado corrección por comparaciones múltiples al conjunto', null));

  return cierra('G1', 'señal histórica', c);
}

// ══ G2, G3, G4 ════════════════════════════════════════════════════════════════════════════════════════
// Se declaran con sus comprobaciones para que estén escritas, pero hoy NINGUNA familia llega a evaluarlas:
// las puertas son secuenciales y ninguna ha pasado G1. Dejarlas a medio implementar sería peor que
// declararlas: daría la impresión de que se están comprobando.
const PENDIENTES = {
  G2: { nombre: 'sombra prospectiva', comprobaciones: ['versión de regla fija y congelada', 'criterio de éxito preregistrado ANTES de la primera observación', 'control de comparaciones múltiples', 'cuotas ejecutables observadas, no las mejores del mercado'] },
  G3: { nombre: 'piloto real', comprobaciones: ['presupuesto absoluto de pérdida escrito', 'límite por evento y por día', 'fills y contabilidad verificados contra la casa', 'y una advertencia: veinte órdenes bien ejecutadas NO validan el edge'] },
  G4: { nombre: 'escalar', comprobaciones: ['rentabilidad neta con su incertidumbre', 'capacidad demostrada al tamaño siguiente', 'límite de drawdown', 'subida gradual midiendo degradación de precio'] },
};

// ══ EL VEREDICTO DE UNA PUERTA ════════════════════════════════════════════════════════════════════════
// Una puerta se pasa cuando TODAS sus comprobaciones pasan. `no_evaluable` bloquea igual que `falla`: la
// diferencia se conserva en el detalle, pero no en el resultado. Si no lo hiciera, una familia sin datos
// pasaría todas las puertas por no tener nada que la contradiga.
function cierra(id, nombre, comprobaciones) {
  const fallan = comprobaciones.filter((x) => x.estado === 'falla');
  const dudan = comprobaciones.filter((x) => x.estado === 'no_evaluable');
  return {
    puerta: id, nombre,
    pasa: fallan.length === 0 && dudan.length === 0,
    fallan: fallan.length, no_evaluables: dudan.length, pasan: comprobaciones.length - fallan.length - dudan.length,
    bloqueo: fallan.length ? fallan[0].texto : (dudan.length ? dudan[0].texto : null),
    comprobaciones,
  };
}

const esLiquidada = (p) => {
  const r = String(p.result_code || p.result || '').toUpperCase();
  return p.status === 'SETTLED' && (r === 'WIN' || r === 'LOSS' || p.units != null);
};

// ══ LA EVALUACIÓN COMPLETA DE UNA FAMILIA ═════════════════════════════════════════════════════════════
// Devuelve en qué puerta está y qué la bloquea. Secuencial: si G0 no pasa, G1 ni se mira, y se dice por qué.
function evalua(familia, picks, decl = {}, ctx = {}) {
  const p0 = g0(picks, decl);
  if (!p0.pasa) {
    return { familia, puerta_actual: 'G0', pasa_hasta: null, bloqueo: p0.bloqueo, G0: p0,
      G1: { puerta: 'G1', nombre: 'señal histórica', pasa: false, no_evaluada: 'no se evalúa la señal de una familia cuyo libro no está en orden: se estaría midiendo el desorden' },
      pendientes: PENDIENTES };
  }
  const p1 = g1(picks, decl, ctx);
  return { familia, puerta_actual: p1.pasa ? 'G2' : 'G1', pasa_hasta: p1.pasa ? 'G1' : 'G0',
    bloqueo: p1.pasa ? 'le toca G2: sombra prospectiva con versión fija y criterio preregistrado' : p1.bloqueo,
    G0: p0, G1: p1, pendientes: PENDIENTES };
}

module.exports = { evalua, g0, g1, LISTONES, PENDIENTES, esLiquidada };
