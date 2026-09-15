// lib/contrato.js — UN PRECIO ES UNA TUPLA, NUNCA UN NÚMERO SUELTO (15-sep-2026)
//
// ── POR QUÉ EXISTE (A01 de la auditoría externa, §3.1) ──────────────────────────────────────────────────
// En media docena de sitios del sistema la función que elige "el mejor precio" devuelve UNA CUOTA y tira a
// la basura de qué línea, de qué casa y de qué momento venía. Después, aguas abajo, el modelo valora la
// línea del CONSENSO con esa cuota. Son dos contratos distintos y el resultado es una ventaja inflada de
// forma sistemática, siempre en la misma dirección: la casa que paga más suele pagar más porque su línea
// es peor, y cobrar por esa diferencia es cobrar por un mercado que no se compró.
//
//     consenso −2,5 · mejor precio de la casa que cotiza −3,5 → se valora P(cubrir −2,5) y se paga −3,5
//
// La regla, escrita una vez: la selección, su línea y su cuota VIAJAN JUNTAS desde la captura hasta la
// liquidación. Si la mejor cuota disponible es de otra línea, no se usa: se descarta con motivo y se cuenta.
//
// ── LA CLAVE CANÓNICA ───────────────────────────────────────────────────────────────────────────────────
// La identidad mínima de un contrato es:
//
//     evento | orientación (a/b según se guardó) | deporte | competición | fase | periodo/mapa/game |
//     familia | selección | línea CON SIGNO | reglas | casa
//
// `fuente` y `timestamp` NO entran en la identidad del contrato —si entraran, dos capturas del mismo
// mercado nunca casarían— pero sí en la identidad de la COTIZACIÓN (`claveCotizacion`), que es la fila
// inmutable que pide el registro: cuota, línea, selección, casa y hora, juntas y sin poder separarse.
//
// ── DOS HÁNDICAPS NO SE EMPAREJAN POR VALOR ABSOLUTO ────────────────────────────────────────────────────
// A−2,5 / B+2,5 es UN mercado. A+2,5 / B−2,5 es OTRO. Emparejarlos por `abs(linea)` mezcla dos contratos
// con pagos opuestos. La normalización canónica de este módulo es **a la línea del lado A**: la línea se
// guarda siempre como la vería A, y la cara de B se convierte cambiándole el signo. Con eso, la misma
// apuesta descrita por un proveedor que lista al visitante primero produce la MISMA clave y el MISMO pago.
// En los totales no hay nada que voltear: over 2,5 y under 2,5 comparten línea; lo que cambia es la cara.
//
// ── LAS DOS CARAS TIENEN QUE SER DEL MISMO MOMENTO ──────────────────────────────────────────────────────
// `parContrario` exige la MISMA casa y la MISMA captura. Coger la mejor cara de las 10:00 y la mejor cara
// de las 18:00 fabrica un mercado que no existió nunca —y con él un margen que nadie cobró y un arbitraje
// que nadie pudo tomar—. Cuando las horas se separan más del umbral, este módulo devuelve `null` y dice por
// qué. Es la misma disciplina que `lib/margen.js` y `lib/ev.js`: antes que un número inventado, un hueco.
'use strict';

// ── 0. TOLERANCIAS Y NORMALIZACIÓN ──────────────────────────────────────────────────────────────────────
// Las líneas llegan como 2.5, "2.5", 2.50 y 2.499999 según el proveedor: se comparan con tolerancia, nunca
// con `===`. La tolerancia es mucho menor que el cuarto de punto (0,25), así que jamás confunde dos líneas
// realmente distintas.
const TOL_LINEA = 0.001;
// Dos capturas se consideran el mismo momento si distan menos de esto. Tres minutos es la pasada típica de
// los barridos de la casa; el llamador puede apretarlo o aflojarlo según su cadencia.
const TOL_MS = 3 * 60e3;

const normTxt = (x) => String(x == null ? '' : x).trim().toLowerCase().replace(/\s+/g, ' ');
const normLinea = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? +n.toFixed(3) : null;
};
const msDe = (x) => {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const t = Date.parse(String(x));
  return Number.isFinite(t) ? t : null;
};

// ── 1. QUÉ TIPO DE LÍNEA TIENE LA FAMILIA ───────────────────────────────────────────────────────────────
// De esto depende si la línea se voltea al cambiar de cara:
//   · `handicap` — la línea es del lado que la lleva: A−2,5 ⇔ B+2,5. Se normaliza a la de A.
//   · `total`    — la línea es común a las dos caras: over 2,5 y under 2,5 son el mismo 2,5.
//   · `ninguna`  — ganador, ambos marcan, prórroga: no hay línea que normalizar.
// El llamador puede imponerlo con `tipoLinea`; si no, se deduce del nombre de la familia. La deducción es
// una comodidad, no una autoridad: cuando el proveedor publica el tipo, se pasa explícito.
const RE_HANDICAP = /(handicap|hándicap|hcp|spread|linea_equipo|asian|margen)/i;
const RE_TOTAL = /(total|over|under|puntos|kills|rondas|goles|corners|córners|cards|tarjetas|juegos|games|legs|180)/i;
function tipoDeLinea(familia, tipoLinea = null) {
  if (tipoLinea) return normTxt(tipoLinea);
  const f = String(familia == null ? '' : familia);
  if (RE_HANDICAP.test(f)) return 'handicap';
  if (RE_TOTAL.test(f)) return 'total';
  return 'ninguna';
}

// ── 2. LA CARA: A o B ───────────────────────────────────────────────────────────────────────────────────
// Dentro de un contrato de dos caras solo hay dos posibilidades, y cada deporte las llama distinto. Se
// reducen a `a` y `b` para que una familia de tenis y una de CS2 se puedan comparar sin traducir a mano.
// En los totales `over` es la cara A y `under` la B, por convenio y para que la clave sea estable.
const CARA_A = new Set(['a', 'home', 'local', 'over', 'mas', 'más', 'yes', 'si', 'sí', 'radiant', '1', 'player1', 'p1']);
const CARA_B = new Set(['b', 'away', 'visitante', 'visita', 'under', 'menos', 'no', 'dire', '2', 'player2', 'p2']);
function caraDe(seleccion) {
  const s = normTxt(seleccion);
  if (!s) return null;
  if (CARA_A.has(s)) return 'a';
  if (CARA_B.has(s)) return 'b';
  return null;                       // no es una cara conocida: puede ser el nombre de un participante
}

// La línea vista desde A. Es la única normalización que este módulo hace sobre el número: en hándicap, la
// cara B lleva la línea con el signo cambiado; en total y en ninguna, la línea es la que es.
function lineaDesdeA(linea, cara, tipo) {
  const l = normLinea(linea);
  if (l == null) return null;
  if (tipo !== 'handicap') return l;
  return cara === 'b' ? normLinea(-l) : l;
}

// ── 3. LAS PARTES CANÓNICAS DE UN CONTRATO ──────────────────────────────────────────────────────────────
// `c` admite los nombres que ya usan los motores de la casa (`side`/`lado`, `family`/`familia`,
// `line`/`linea`, `book`/`casa`…) porque obligar a diez motores a renombrar sus campos a la vez es cómo se
// rompe producción un lunes.
//
// ORIENTACIÓN. Si el llamador pasa `participantes: [X, Y]`, el orden canónico es el alfabético de los dos
// nombres normalizados, y `orientacion` dice si lo guardado venía en ese orden (`directa`) o al revés
// (`invertida`). Así, un proveedor que lista al visitante primero y otro que lista al local primero
// producen la MISMA clave para la MISMA apuesta. Sin `participantes` no hay nada que reordenar y la
// orientación se declara `tal_cual`: es responsabilidad del llamador ser coherente consigo mismo.
function partes(c = {}) {
  const familia = normTxt(c.familia != null ? c.familia : c.family);
  const tipo = tipoDeLinea(familia, c.tipoLinea || c.tipo_linea || null);
  const brutoSel = c.seleccion != null ? c.seleccion : (c.lado != null ? c.lado : (c.side != null ? c.side : c.selection));
  const parts = Array.isArray(c.participantes) && c.participantes.length === 2
    ? c.participantes.map(normTxt) : null;

  let orientacion = 'tal_cual';
  let cara = caraDe(brutoSel);
  if (parts) {
    const invertida = parts[0] > parts[1];           // el orden canónico es el alfabético
    orientacion = invertida ? 'invertida' : 'directa';
    const nombre = normTxt(brutoSel);
    // OJO: el índice hay que buscarlo en el orden CANÓNICO (alfabético), no en el que trajo el proveedor.
    // Buscarlo en el orden del proveedor hacía que la misma apuesta —los Chiefs dando 2,5— saliera con cara
    // 'a' o 'b' según cómo hubiera ordenado el partido quien la escribió, que es exactamente la confusión
    // que este módulo existe para eliminar.
    const ordenados = parts.slice().sort();
    const iNombre = ordenados.indexOf(nombre);
    if (iNombre >= 0) cara = iNombre === 0 ? 'a' : 'b';   // la selección venía como nombre de participante
    // si la selección venía como `home`/`away` (o `a`/`b`) se refiere al orden GUARDADO: al reordenar hay
    // que voltearla, o la misma apuesta saldría con caras distintas según qué proveedor la escribió
    if (iNombre < 0 && cara && invertida && tipo !== 'total') cara = cara === 'a' ? 'b' : 'a';
  }

  const evento = parts
    ? [parts[0], parts[1]].sort().join(' vs ')
    : normTxt(c.evento != null ? c.evento : (c.event != null ? c.event : c.event_id));

  return {
    deporte: normTxt(c.deporte != null ? c.deporte : c.sport),
    competicion: normTxt(c.competicion != null ? c.competicion : (c.competition != null ? c.competition : c.liga)),
    fase: normTxt(c.fase != null ? c.fase : c.stage),
    evento,
    orientacion,
    periodo: normTxt(c.periodo != null ? c.periodo : (c.period != null ? c.period : (c.mapa != null ? c.mapa : c.map))) || 'completo',
    familia,
    tipo_linea: tipo,
    seleccion: cara,                                       // `null` si no se pudo resolver: no se inventa
    seleccion_bruta: normTxt(brutoSel) || null,
    linea_a: lineaDesdeA(c.linea != null ? c.linea : c.line, cara, tipo),
    reglas: normTxt(c.reglas != null ? c.reglas : c.rules) || 'sin_declarar',
    casa: normTxt(c.casa != null ? c.casa : (c.book != null ? c.book : c.sportsbook)),
    fuente: normTxt(c.fuente != null ? c.fuente : c.source) || null,
    at: msDe(c.at != null ? c.at : (c.hora != null ? c.hora : (c.observed_at != null ? c.observed_at : c.timestamp))),
  };
}

// La clave del CONTRATO: lo que hay que compartir para que dos filas hablen del mismo pago.
// `conSeleccion: false` da la clave del MERCADO (las dos caras del mismo contrato comparten esa).
// `conCasa: false` da la clave del contrato con independencia de dónde se cotice, que es la que necesita el
// motor de ejecución para preguntar "¿dónde se compra más barato ESTE pago?".
// Acepta tanto un contrato en crudo como la salida de `partes()`: se reconoce por `linea_a`, que solo
// existe una vez normalizado. Volver a normalizar lo ya normalizado sería inofensivo salvo en un caso —el
// hándicap de la cara B, que se voltearía dos veces— y ese caso es justo el que este módulo existe para
// no equivocar.
function clave(c = {}, { conSeleccion = true, conCasa = true } = {}) {
  const p = c && Object.prototype.hasOwnProperty.call(c, 'linea_a') ? c : partes(c);
  const linea = p.linea_a == null ? 'sin_linea' : p.linea_a.toFixed(3);
  const campos = [p.deporte, p.competicion, p.fase, p.evento, p.periodo, p.familia, p.reglas, linea];
  if (conSeleccion) campos.push(p.seleccion || 'sin_cara');
  if (conCasa) campos.push(p.casa || 'sin_casa');
  return campos.join('|');
}
const claveMercado = (c) => clave(c, { conSeleccion: false });
// La clave de la COTIZACIÓN: el contrato MÁS de dónde salió y cuándo. Es la fila inmutable del registro —
// nunca se usa para emparejar mercados, solo para identificar una captura sin ambigüedad.
const claveCotizacion = (c) => {
  const p = Object.prototype.hasOwnProperty.call(c || {}, 'linea_a') ? c : partes(c);
  return [clave(p), p.fuente || 'sin_fuente', p.at == null ? 'sin_hora' : new Date(p.at).toISOString()].join('|');
};

// ── 4. ¿ES LA MISMA LÍNEA? ──────────────────────────────────────────────────────────────────────────────
// Compara la línea CANÓNICA (la del lado A) de dos contratos, con tolerancia. Comprueba también familia,
// periodo y evento CUANDO las dos filas los declaran: si una no lo trae, no se inventa una diferencia, pero
// tampoco se finge una coincidencia. Lo que este módulo NO hará nunca es casar por `abs(linea)`.
function mismaLinea(a, b, { tolerancia = TOL_LINEA } = {}) {
  if (!a || !b) return false;
  const pa = partes(a), pb = partes(b);
  if (pa.familia && pb.familia && pa.familia !== pb.familia) return false;
  if (pa.evento && pb.evento && pa.evento !== pb.evento) return false;
  if (pa.periodo && pb.periodo && pa.periodo !== pb.periodo) return false;
  if (pa.linea_a == null || pb.linea_a == null) return pa.linea_a === pb.linea_a;   // sin línea ⇔ sin línea
  return Math.abs(pa.linea_a - pb.linea_a) <= tolerancia;
}

// ── 5. EL MEJOR PRECIO, CON SU FILA ENTERA ──────────────────────────────────────────────────────────────
// Devuelve LA FILA, no la cuota: `{ fila, cuota, linea, casa, at }`. Solo compite entre filas que comparten
// familia, cara y línea EXACTA con lo que se va a valorar. Todo lo demás se descarta con motivo y se cuenta,
// porque ese contador es el que dice cuántas picks se estaban valorando contra el precio de otro mercado.
//
// El objetivo (`familia`, `lado`, `linea`) es lo que el MODELO valoró. Si nadie cotiza esa línea, la
// respuesta correcta es `fila: null` y un motivo — no la cuota más alta de la línea de al lado.
function mejorPrecio(filas, { familia, lado, linea, tipoLinea = null, participantes = null,
  evento = null, periodo = null, tolerancia = TOL_LINEA } = {}) {
  const objetivo = partes({ familia, seleccion: lado, linea, tipoLinea, participantes, evento, periodo });
  const descartes = { familia_distinta: 0, lado_distinto: 0, linea_distinta: 0, sin_cuota: 0, evento_distinto: 0, periodo_distinto: 0 };
  const lineas_vistas = new Set();
  let mejor = null, mejorP = null;
  for (const f of filas || []) {
    if (!f) continue;
    const p = partes({ participantes, evento, periodo, tipoLinea, ...f });
    const cuota = Number(f.cuota != null ? f.cuota : (f.odds != null ? f.odds : (f.precio != null ? f.precio : f.price)));
    if (p.familia && objetivo.familia && p.familia !== objetivo.familia) { descartes.familia_distinta++; continue; }
    if (objetivo.evento && p.evento && p.evento !== objetivo.evento) { descartes.evento_distinto++; continue; }
    if (p.periodo !== objetivo.periodo) { descartes.periodo_distinto++; continue; }
    if (p.seleccion !== objetivo.seleccion) { descartes.lado_distinto++; continue; }
    if (p.linea_a != null) lineas_vistas.add(p.linea_a);
    const mismaL = (objetivo.linea_a == null && p.linea_a == null)
      || (objetivo.linea_a != null && p.linea_a != null && Math.abs(p.linea_a - objetivo.linea_a) <= tolerancia);
    if (!mismaL) { descartes.linea_distinta++; continue; }
    if (!(cuota > 1)) { descartes.sin_cuota++; continue; }
    if (!mejor || cuota > mejor.cuota) { mejor = { fila: f, cuota, linea: p.linea_a, casa: p.casa || null, at: p.at }; mejorP = p; }
  }
  const total = (filas || []).length;
  if (!mejor) {
    return { fila: null, cuota: null, linea: objetivo.linea_a, casa: null, at: null, descartes, evaluadas: total,
      motivo: descartes.linea_distinta
        ? `ninguna casa cotiza la línea evaluada (${objetivo.linea_a}); ${descartes.linea_distinta} filas eran de otra línea (${[...lineas_vistas].sort((x, y) => x - y).join(', ')}) y valorar esa probabilidad con ese precio infla la ventaja`
        : 'ninguna fila comparte familia, cara y línea con lo que se valoró' };
  }
  return { ...mejor, clave: clave(mejorP), descartes, evaluadas: total, motivo: null };
}

// ── 6. LA CARA CONTRARIA DEL MISMO CONTRATO ─────────────────────────────────────────────────────────────
// Para desvigar hace falta la OTRA cara del MISMO mercado, en la MISMA casa y en la MISMA captura. Las tres
// condiciones son igual de duras:
//   · mismo mercado — misma clave sin selección (evento, periodo, familia, reglas y línea canónica);
//   · misma casa — con una cara de Pinnacle y otra de Bovada se fabrica un mercado que no existe;
//   · misma captura — con caras de momentos distintos se fabrica un margen que nadie cobró.
// Cuando hay candidata pero la hora no acompaña, se devuelve `null` con motivo, nunca la candidata.
// `{ detalle: true }` devuelve `{ fila, motivo }` para el llamador que quiera contar por qué falló.
function parContrario(fila, filas, { toleranciaMs = TOL_MS, detalle = false } = {}) {
  const salida = (f, motivo) => (detalle ? { fila: f, motivo } : f);
  if (!fila) return salida(null, 'sin fila de referencia');
  const p = partes(fila);
  if (!p.seleccion) return salida(null, 'la fila de referencia no declara cara: sin saber qué lado es, no hay contraria');
  const mercado = clave(p, { conSeleccion: false });
  const otra = p.seleccion === 'a' ? 'b' : 'a';
  let fueraDeHora = null;
  let mejor = null;
  for (const f of filas || []) {
    if (!f || f === fila) continue;
    const q = partes(f);
    if (q.seleccion !== otra) continue;
    if (clave(q, { conSeleccion: false }) !== mercado) continue;
    if (p.at != null && q.at != null && Math.abs(p.at - q.at) > toleranciaMs) {
      if (fueraDeHora == null || Math.abs(p.at - q.at) < fueraDeHora) fueraDeHora = Math.abs(p.at - q.at);
      continue;
    }
    const cuota = Number(f.cuota != null ? f.cuota : (f.odds != null ? f.odds : f.precio));
    if (!mejor || (cuota > 1 && cuota > Number(mejor.cuota != null ? mejor.cuota : (mejor.odds != null ? mejor.odds : mejor.precio)))) mejor = f;
  }
  if (mejor) return salida(mejor, null);
  if (fueraDeHora != null) {
    return salida(null, `hay cara contraria del mismo contrato y la misma casa, pero la captura más cercana está a ${Math.round(fueraDeHora / 1000)} s (umbral ${Math.round(toleranciaMs / 1000)} s): emparejar caras de momentos distintos fabrica un mercado que no existió`);
  }
  return salida(null, 'no hay cara contraria del mismo contrato en la misma casa');
}

module.exports = {
  clave, claveMercado, claveCotizacion, partes, mejorPrecio, mismaLinea, parContrario,
  // piezas sueltas, para los tests y para quien componga otra cosa
  tipoDeLinea, caraDe, lineaDesdeA, normLinea, TOL_LINEA, TOL_MS,
};
