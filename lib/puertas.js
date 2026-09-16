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
  // G2 — la sombra prospectiva. Los tres primeros salen de la auditoría; el cuarto de lo aprendido el
  // 15-sep con la tupla: valorar la línea del consenso con el precio de otra infla la ventaja SIEMPRE en
  // la misma dirección, así que una cuota que no se pudo tomar no cuenta como observación.
  g2_eventos_min: 100,          // §5.3 otra vez: prospectivos, bajo regla congelada
  g2_ejecutables_min: 0.90,     // 9 de cada 10 observaciones con cuota que se pudo tomar de verdad
  // G3 — el piloto real. No son estadística: son frenos. Veinte órdenes bien ejecutadas NO validan nada.
  g3_ordenes_min: 20,
  g3_conciliacion_max_pct: 1,   // descuadre máximo entre nuestro libro y el de la casa, en % del nocional
  // G4 — escalar. La capacidad es lo que casi nadie mide y lo que mata a los que escalan.
  g4_eventos_min: 300,
  g4_drawdown_max_pct: 20,
  g4_degradacion_max_pp: 1,     // cuánto puede empeorar el precio medio al subir de tamaño
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
  //    16-sep (A5): «no documentado» ya no es un estado único. El reglamento de Cloudbet se obtuvo entero y
  //    contesta seis de las nueve preguntas; los de Pinnacle y Bovada no se pudieron alcanzar. Como casi
  //    ninguna familia cruza en una sola casa, eso NO basta para pasar la comprobación —el listón no se
  //    mueve—, pero decir «nadie lo ha declarado» cuando media casa está resuelta es falso y hace que nadie
  //    sepa qué falta. Cuando hay avance parcial, la comprobación lo dice y nombra lo que queda.
  c.push(decl.contrato_documentado === true
    ? ok('contrato', 'el reglamento de la casa para esta familia está documentado y fechado', decl.contrato_ref || null)
    : decl.contrato_documentado === false
      ? mal('contrato', 'el reglamento de la casa para esta familia NO está documentado: no sabemos qué paga', null)
      : decl.contrato_cloudbet
        ? nose('contrato', `Cloudbet resuelto; falta: ${decl.contrato_pendiente || 'las demás casas'}`,
          { cloudbet: decl.contrato_cloudbet, pendiente: decl.contrato_pendiente || null })
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

// ══ G2 · LA SOMBRA PROSPECTIVA ════════════════════════════════════════════════════════════════════════
// G1 mira hacia atrás: pregunta si el libro que YA existe tiene señal. G2 mira hacia adelante, y esa es
// toda la diferencia. Una familia puede pasar G1 porque la regla se fue afinando sobre esos mismos datos
// —nadie lo hace a propósito, pasa solo— y hundirse en cuanto tiene que predecir algo que no ha visto.
//
// Las cuatro comprobaciones son las cuatro maneras de hacer trampa sin querer:
//   · `version_congelada` — si la regla cambia a mitad de la ventana, la muestra mezcla dos cosas y no
//     mide ninguna. El hash de la regla lo hace comprobable en vez de recordable.
//   · `preregistro` — el criterio de éxito tiene que estar escrito CON FECHA ANTERIOR a la primera
//     observación. Sin eso, el criterio se elige sabiendo el resultado, que es lo mismo que no tenerlo.
//   · `comparaciones` — la corrección múltiple otra vez, ahora sobre las familias en sombra.
//   · `cuotas_ejecutables` — la que costó dinero de verdad: una observación vale si la cuota se pudo
//     TOMAR, no si era la mejor del mercado en ese instante.
function g2(picks, decl = {}, ctx = {}) {
  const c = [];
  const pros = (picks || []).filter((p) => esLiquidada(p) && p.prospectiva === true);
  const nEv = new Set(pros.map((p) => p.event_id || p.match_id || p.id)).size;

  c.push(decl.version_congelada && decl.version_hash
    ? ok('version_congelada', `la regla está congelada en ${decl.version_congelada} (hash ${String(decl.version_hash).slice(0, 12)})`, { version: decl.version_congelada, hash: decl.version_hash })
    : nose('version_congelada', 'nadie ha declarado una versión congelada con su hash: sin eso no se puede afirmar que la regla no cambió a mitad de la ventana', null));

  const pre = decl.preregistro || null;
  const preAt = pre && pre.at ? Date.parse(pre.at) : NaN;
  const primera = pros.reduce((m, p) => {
    const t = Date.parse(p.created_at || p.born_at || p.at || 0);
    return Number.isFinite(t) && t > 0 ? Math.min(m, t) : m;
  }, Infinity);
  c.push(!pre || !Number.isFinite(preAt)
    ? nose('preregistro', 'no hay criterio de éxito preregistrado con fecha', null)
    : (Number.isFinite(primera) && preAt < primera
      ? ok('preregistro', `criterio escrito el ${pre.at}, antes de la primera observación (${new Date(primera).toISOString()})`, pre)
      : mal('preregistro', `el criterio está fechado el ${pre.at} y hay observaciones anteriores: se eligió sabiendo parte del resultado`, { preregistro_at: pre.at, primera_observacion: Number.isFinite(primera) ? new Date(primera).toISOString() : null })));

  c.push(nEv >= LISTONES.g2_eventos_min
    ? ok('muestra_prospectiva', `${nEv} eventos prospectivos bajo la regla congelada`, { eventos: nEv })
    : mal('muestra_prospectiva', `${nEv} eventos prospectivos de los ${LISTONES.g2_eventos_min} que pide la puerta`, { eventos: nEv, faltan: LISTONES.g2_eventos_min - nEv }));

  const conEj = pros.filter((p) => p.cuota_ejecutable === true || p.odds_ejecutable === true).length;
  const cuota = pros.length ? conEj / pros.length : null;
  c.push(cuota == null
    ? nose('cuotas_ejecutables', 'sin observaciones prospectivas que comprobar', null)
    : (cuota >= LISTONES.g2_ejecutables_min
      ? ok('cuotas_ejecutables', `${(100 * cuota).toFixed(1)} % de las observaciones con cuota que se pudo tomar`, { cuota, n: pros.length })
      : mal('cuotas_ejecutables', `solo el ${(100 * cuota).toFixed(1)} % de las observaciones tiene cuota ejecutable (tope ${100 * LISTONES.g2_ejecutables_min} %): valorar con precios que no se pudieron tomar infla la ventaja siempre hacia el mismo lado`, { cuota, n: pros.length })));

  const ev2 = ctx.evaluadaG2 || ctx.evaluada;
  c.push(ev2 && Number.isFinite(ev2.umbral_p)
    ? ok('comparaciones', `umbral corregido por Benjamini–Hochberg al ${100 * LISTONES.bh_q} % sobre ${ev2.familias} familias en sombra: p ≤ ${ev2.umbral_p}`, ev2)
    : nose('comparaciones', 'no se ha aplicado corrección por comparaciones múltiples al conjunto de familias en sombra', null));

  return cierra('G2', 'sombra prospectiva', c);
}

// ══ G3 · EL PILOTO REAL ═══════════════════════════════════════════════════════════════════════════════
// G3 no es estadística: son FRENOS. Su comprobación más importante es la que no se puede pasar — la
// advertencia de que veinte órdenes bien ejecutadas no validan ninguna ventaja. G3 contesta «¿sabemos
// operar esto sin perder dinero por fontanería?», no «¿gana?». Confundir las dos preguntas es exactamente
// lo que pasó con las tarjetas: se leyó un piloto que funcionaba como si fuera un edge que existía.
function g3(picks, decl = {}, ctx = {}) {
  const c = [];
  const reales = (picks || []).filter((p) => p.real === true || p.canal === 'real');

  c.push(Number.isFinite(decl.presupuesto_perdida)
    ? ok('presupuesto', `presupuesto absoluto de pérdida escrito: ${decl.presupuesto_perdida} ${decl.moneda || ''}`.trim(), { presupuesto: decl.presupuesto_perdida })
    : nose('presupuesto', 'no hay presupuesto absoluto de pérdida escrito: sin un número, «parar» es una opinión', null));

  c.push(Number.isFinite(decl.limite_evento) && Number.isFinite(decl.limite_dia)
    ? ok('limites', `tope por evento ${decl.limite_evento} y por día ${decl.limite_dia}`, { evento: decl.limite_evento, dia: decl.limite_dia })
    : nose('limites', 'faltan los topes por evento y por día', null));

  const desc = decl.conciliacion_descuadre_pct;
  c.push(!Number.isFinite(desc)
    ? nose('conciliacion', 'nadie ha conciliado los fills y la contabilidad contra la casa', null)
    : (Math.abs(desc) <= LISTONES.g3_conciliacion_max_pct
      ? ok('conciliacion', `el libro cuadra con el de la casa dentro del ${LISTONES.g3_conciliacion_max_pct} % (descuadre ${desc} %)`, { descuadre_pct: desc })
      : mal('conciliacion', `el libro y el de la casa se separan un ${desc} % (tope ${LISTONES.g3_conciliacion_max_pct} %): lo que dice el track no es lo que pasó con el dinero`, { descuadre_pct: desc })));

  c.push(reales.length >= LISTONES.g3_ordenes_min
    ? ok('ordenes', `${reales.length} órdenes reales ejecutadas`, { n: reales.length })
    : mal('ordenes', `${reales.length} órdenes reales de las ${LISTONES.g3_ordenes_min} que pide el piloto`, { n: reales.length }));

  // Esta comprobación NO se puede pasar, y es a propósito: existe para que nadie lea un G3 verde como una
  // validación de ventaja. Es un aviso con forma de comprobación.
  c.push({ id: 'no_valida_el_edge', estado: 'aviso',
    texto: `veinte órdenes bien ejecutadas NO validan ninguna ventaja: G3 contesta si sabemos operar esto, no si gana. Lo segundo lo contesta G4 con ${LISTONES.g4_eventos_min} eventos.`,
    dato: null });

  return cierra('G3', 'piloto real', c.filter((x) => x.estado !== 'aviso'), c);
}

// ══ G4 · ESCALAR ══════════════════════════════════════════════════════════════════════════════════════
// La puerta que casi nadie pone y que es la que mata a los que llegan hasta aquí. Una ventaja de verdad a
// 5 dólares puede no existir a 500: el precio se degrada al pedir tamaño, y la degradación se mide, no se
// supone. Por eso `capacidad` compara el precio medio conseguido en el tamaño ACTUAL con el del tamaño
// SIGUIENTE, y si nadie ha probado el tamaño siguiente, la puerta no pasa — no se extrapola.
function g4(picks, decl = {}, ctx = {}) {
  const c = [];
  const ev = ctx.ev || null;

  c.push(ev && Number.isFinite(ev.t) && Number.isFinite(ev.n_clusters)
    ? (ev.t >= LISTONES.ev_t_min && ev.n_clusters >= LISTONES.g4_eventos_min && ev.media > 0
      ? ok('rentabilidad_neta', `EV neto ${ev.media} con t ${ev.t} sobre ${ev.n_clusters} eventos`, ev)
      : mal('rentabilidad_neta', `EV ${ev.media} con t ${ev.t} sobre ${ev.n_clusters} eventos: la puerta pide t ≥ ${LISTONES.ev_t_min} y ${LISTONES.g4_eventos_min} eventos con el EV por encima de cero`, ev))
    : nose('rentabilidad_neta', 'no hay EV neto agregado con su incertidumbre por racimos', null));

  const deg = decl.degradacion_pp;
  c.push(!Number.isFinite(deg)
    ? nose('capacidad', 'nadie ha probado el tamaño siguiente: la capacidad no se extrapola, se mide', null)
    : (deg <= LISTONES.g4_degradacion_max_pp
      ? ok('capacidad', `al subir de tamaño el precio medio empeora ${deg} pp (tope ${LISTONES.g4_degradacion_max_pp})`, { degradacion_pp: deg })
      : mal('capacidad', `al subir de tamaño el precio medio empeora ${deg} pp, por encima del tope de ${LISTONES.g4_degradacion_max_pp}: la ventaja se la come el tamaño`, { degradacion_pp: deg })));

  const dd = decl.drawdown_max_pct;
  c.push(!Number.isFinite(dd)
    ? nose('drawdown', 'no hay límite de drawdown medido', null)
    : (dd <= LISTONES.g4_drawdown_max_pct
      ? ok('drawdown', `drawdown máximo ${dd} % (tope ${LISTONES.g4_drawdown_max_pct} %)`, { drawdown_pct: dd })
      : mal('drawdown', `drawdown máximo ${dd} %, por encima del tope de ${LISTONES.g4_drawdown_max_pct} %`, { drawdown_pct: dd })));

  c.push(decl.subida_gradual === true
    ? ok('subida_gradual', 'la subida de tamaño es gradual y mide degradación en cada escalón', null)
    : nose('subida_gradual', 'no se ha declarado una subida gradual con medición en cada escalón', null));

  return cierra('G4', 'escalar', c);
}

// ══ EL VEREDICTO DE UNA PUERTA ════════════════════════════════════════════════════════════════════════
// Una puerta se pasa cuando TODAS sus comprobaciones pasan. `no_evaluable` bloquea igual que `falla`: la
// diferencia se conserva en el detalle, pero no en el resultado. Si no lo hiciera, una familia sin datos
// pasaría todas las puertas por no tener nada que la contradiga.
function cierra(id, nombre, comprobaciones, conAvisos = null) {
  const fallan = comprobaciones.filter((x) => x.estado === 'falla');
  const dudan = comprobaciones.filter((x) => x.estado === 'no_evaluable');
  return {
    puerta: id, nombre,
    pasa: fallan.length === 0 && dudan.length === 0,
    fallan: fallan.length, no_evaluables: dudan.length, pasan: comprobaciones.length - fallan.length - dudan.length,
    bloqueo: fallan.length ? fallan[0].texto : (dudan.length ? dudan[0].texto : null),
    comprobaciones: conAvisos || comprobaciones,
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
      G1: { puerta: 'G1', nombre: 'señal histórica', pasa: false, no_evaluada: 'no se evalúa la señal de una familia cuyo libro no está en orden: se estaría midiendo el desorden' } };
  }
  const p1 = g1(picks, decl, ctx);
  if (!p1.pasa) {
    return { familia, puerta_actual: 'G1', pasa_hasta: 'G0', bloqueo: p1.bloqueo, G0: p0, G1: p1,
      G2: { puerta: 'G2', nombre: 'sombra prospectiva', pasa: false, no_evaluada: 'no se evalúa la sombra prospectiva de una familia sin señal histórica: la secuencia existe para no gastar meses de muestra en algo que ya se sabe que no tiene señal' } };
  }
  const p2 = g2(picks, decl, ctx);
  if (!p2.pasa) {
    return { familia, puerta_actual: 'G2', pasa_hasta: 'G1', bloqueo: p2.bloqueo, G0: p0, G1: p1, G2: p2,
      G3: { puerta: 'G3', nombre: 'piloto real', pasa: false, no_evaluada: 'no se pone dinero real en una familia que no ha cruzado la sombra prospectiva' } };
  }
  const p3 = g3(picks, decl, ctx);
  if (!p3.pasa) {
    return { familia, puerta_actual: 'G3', pasa_hasta: 'G2', bloqueo: p3.bloqueo, G0: p0, G1: p1, G2: p2, G3: p3,
      G4: { puerta: 'G4', nombre: 'escalar', pasa: false, no_evaluada: 'no se escala lo que no se ha pilotado' } };
  }
  const p4 = g4(picks, decl, ctx);
  return { familia, puerta_actual: p4.pasa ? 'pasa_todas' : 'G4', pasa_hasta: p4.pasa ? 'G4' : 'G3',
    bloqueo: p4.pasa ? null : p4.bloqueo,
    G0: p0, G1: p1, G2: p2, G3: p3, G4: p4,
    nota: p4.pasa ? 'cruza las cinco puertas. Eso NO enciende nada: encender un canal sigue siendo decisión de Alexis y la regla del dinero del 13-sep sigue por encima.' : null };
}

module.exports = { evalua, g0, g1, g2, g3, g4, LISTONES, esLiquidada };
