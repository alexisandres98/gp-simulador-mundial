// real-executor/reconciliar.js — CUADRAR NUESTRO LIBRO CONTRA EL DE LA CASA (4-sep-2026).
//
// POR QUÉ EXISTE. El 4-sep una restauración del disco devolvió el libro del ejecutor al estado de 11 horas
// antes: ocho apuestas REALES colocadas en esa ventana desaparecieron de nuestras cuentas. La casa seguía
// teniéndolas —el dinero estaba comprometido de verdad— y nosotros no. Un libro que no cuadra con el de la
// casa es peor que no tener libro: da una exposición, un P&L y un banco nocional falsos, y todo lo que se
// decida con esas cifras está mal.
//
// LA CASA MANDA. Aquí no se inventa nada: la verdad es el libro de Cloudbet, leído por el reenviador
// (`/historial`), y este módulo solo dice en qué se diferencia el nuestro y —si se le pide— lo corrige.
//
// LO QUE HACE Y LO QUE NO
//   · Compara por REFERENCIA, que es el único identificador que las dos partes comparten.
//   · `huerfanas`  — están en la casa y no en nuestro libro. Son las peligrosas: dinero comprometido que no
//                    contamos. Se reconstruyen.
//   · `fantasmas`  — las damos por colocadas y la casa no las tiene. Nunca se borran automáticamente: que
//                    la casa no la devuelva puede ser una página que no llegó, y borrar dinero por una
//                    lectura incompleta es justo el error que este módulo existe para no repetir.
//   · `descuadres` — misma referencia, distinto importe o precio. Se listan; no se tocan.
//   · `desconocidas` — están en la casa y su referencia no corresponde a ninguna pick nuestra. Se listan
//                    para mirarlas a mano: pueden ser apuestas que Alexis colocó por la web.
//
// NO REHACE LA CONTABILIDAD DEL RESULTADO. Una huérfana se reinserta como PLACED aunque la casa ya la haya
// resuelto: `liquidar()` la cerrará en la pasada siguiente con la aritmética que ya existe y está probada.
// Duplicar aquí ese cálculo sería duplicar también la forma de equivocarse.
//
// POR QUÉ SE PUEDE RECONSTRUIR UNA FILA PERDIDA. La referencia no es aleatoria: es
// `sha256('gp-real:' + pick_id + ':' + envío)` con forma de UUID (ver `refIdDe` en store.js). Así que
// recorriendo las picks conocidas y sus primeros envíos se regenera la tabla referencia → pick y se
// reconoce a qué pick pertenece cada apuesta de la casa.
//
// USO
//   const R = require('./real-executor/reconciliar');
//   await R.comparar({ pickIds, sombra });          // solo mira
//   await R.reparar({ pickIds, sombra, aplicar: true });
'use strict';

const S = require('./store');

const RELAY = () => String(process.env.GP_REAL_RELAY_URL || '').trim().replace(/\/$/, '');
const TOKEN = () => String(process.env.GP_REAL_RELAY_TOKEN || '');
// hasta qué número de envío se regenera la tabla de referencias. Los envíos solo suben cuando la casa
// RECHAZA, y una pick que ha sido rechazada ocho veces no se coloca ya: ocho cubre de sobra.
const ENVIOS_MAX = 8;
const ESTADOS_VIVOS = new Set(['ACCEPTED', 'PENDING_ACCEPTANCE', 'PENDING']);

// ── EL LIBRO DE LA CASA ─────────────────────────────────────────────────────────────────────────────────
// Sale por el reenviador porque la API de apuestas de Cloudbet solo responde desde su geografía: desde
// aquí y desde el servidor principal contesta el cortafuegos. `/historial` es de solo lectura y construye
// él la consulta; nosotros solo pedimos página.
async function libroDeLaCasa({ limit = 100, maxPaginas = 30 } = {}) {
  const base = RELAY();
  if (!base || !TOKEN()) return { ok: false, why: 'reenviador_sin_configurar', bets: [], saldos: [] };
  const bets = [];
  let saldos = [], paginas = 0, completo = false;
  for (let p = 0; p < maxPaginas; p++) {
    let r = null;
    try {
      const opt = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN() },
        body: JSON.stringify({ offset: p * limit, limit }),
      };
      if (AbortSignal.timeout) opt.signal = AbortSignal.timeout(30000);
      const rr = await fetch(base + '/historial', opt);
      r = await rr.json().catch(() => null);
    } catch (e) {
      return { ok: false, why: 'reenviador_no_responde: ' + String((e && e.message) || e).slice(0, 120), bets, saldos, paginas };
    }
    const data = r && r.gql && r.gql.data;
    if (!r || !r.ok || !data) {
      return { ok: false, why: 'respuesta_ilegible', detalle: (r && (r.crudo || r.status)) || null, bets, saldos, paginas };
    }
    // UN ERROR DE LA CASA NO ES UN LIBRO VACÍO (4-sep, medido en producción). Cloudbet contesta HTTP 200 con
    // `errors: [INTERNAL_SERVER_ERROR]` y `data: { bets: null }`. La primera versión de esto miraba solo que
    // `data` existiera, convertía el null en `[]` y concluía tan tranquila que la casa no tenía ni una
    // apuesta: 47 filas nuestras salieron marcadas como fantasmas cuando la casa las tenía todas. Es el
    // mismo error que se llevó el track de esports —tratar "no pude leer" como "no hay"— y aquí habría
    // llevado a tocar el libro del dinero. Ahora cualquier error, o un `bets` que no sea una lista, corta.
    const errs = (r.gql && r.gql.errors) || null;
    if (errs && errs.length) {
      return { ok: false, why: 'la casa devolvió errores al leer su libro', paginas,
        detalle: errs.map((e) => e.message).join(' | ').slice(0, 200), bets, saldos };
    }
    if (!Array.isArray(data.bets)) {
      return { ok: false, why: 'la casa no devolvió una lista de apuestas', paginas,
        detalle: 'bets = ' + JSON.stringify(data.bets), bets, saldos };
    }
    const lote = data.bets;
    if (Array.isArray(data.accountBalances) && data.accountBalances.length) saldos = data.accountBalances;
    bets.push(...lote);
    paginas++;
    if (lote.length < limit) { completo = true; break; }
  }
  // COMPLETO O NO, Y QUE SE VEA. Si el libro de la casa se leyó a medias, cualquier "fantasma" es sospecha
  // de página que falta, no hallazgo. Quien use esto tiene que poder distinguirlo.
  return { ok: true, bets, saldos, paginas, completo, total: bets.length };
}

// ── PREGUNTAR POR UNA REFERENCIA CONCRETA ───────────────────────────────────────────────────────────────
// EL CAMINO QUE SÍ FUNCIONA HOY. El listado del libro entero depende de un resolver de la casa que está
// devolviendo error; preguntar POR REFERENCIA no, y es además el camino que ya usa la liquidación en
// producción todos los días. Así que la reconciliación no necesita el listado: necesita saber qué dice la
// casa de un conjunto ACOTADO de referencias, y eso se puede preguntar una a una.
// Va con concurrencia baja y con tope: son peticiones contra la casa, no contra nosotros.
// TRES DESENLACES, NO DOS. Esta función existe en vez de usar `CB.betByReference` porque esa devuelve
// `null` tanto cuando la casa dice "no tengo esa apuesta" como cuando la petición falla. Para liquidar da
// igual —las dos cosas significan "espera y vuelve a intentarlo"—, pero para reconciliar NO: confundirlas
// es declarar fantasma una apuesta que existe. Pasó, medido: la primera pasada contra el libro real marcó
// 21 fantasmas y al preguntar por esas mismas referencias una a una la casa las tenía. Con concurrencia 4
// la casa empezaba a fallar peticiones y cada fallo se leía como "no existe".
// Aquí se mira la respuesta de GraphQL en crudo: `errors` → no sabemos; `data.bet === null` sin errores →
// la casa dice que no la tiene; `data.bet` → existe.
async function leerApuesta(llave, ref, { reintentos = 3, esperar = true } = {}) {
  const CB = require('../market-scanner/venues/cloudbet');
  const Q = `query Apuesta($ref: String!) {
    bet(referenceId: $ref) { referenceId eventId eventName marketUrl currency price stake side returnAmount betStatus betErrorCode }
  }`;
  for (let intento = 0; intento <= reintentos; intento++) {
    const r = await CB.gql(llave, Q, { ref }).catch((e) => ({ ok: false, status: 0, errors: null, data: null, raw: String((e && e.message) || e).slice(0, 120) }));
    if (r && r.data && Object.prototype.hasOwnProperty.call(r.data, 'bet') && !(r.errors && r.errors.length)) {
      return r.data.bet ? { estado: 'existe', bet: r.data.bet } : { estado: 'no_existe' };
    }
    const porCuota = r && (r.status === 429 || /Too Many Requests/i.test(String(r.raw || '')));
    if (intento === reintentos) {
      return { estado: 'sin_respuesta', cuota: !!porCuota,
        why: ((r && r.errors) ? r.errors.map((e) => e.message).join(' | ') : (r && r.raw) || 'sin detalle').slice(0, 140) };
    }
    // A UN 429 SE LE HACE CASO. La casa nos limita de verdad —lo dice con ese código— y volver a preguntar
    // al instante solo alarga el castigo. Se espera de forma creciente y bastante: esta herramienta no tiene
    // ninguna prisa, y una respuesta tardía vale infinitamente más que una conclusión sin datos.
    if (esperar) await new Promise((s2) => setTimeout(s2, (porCuota ? 3000 : 500) * (intento + 1)));
  }
  return { estado: 'sin_respuesta', why: 'agotados los reintentos' };
}

// CONCURRENCIA 2 Y NO 4, y con una pausa entre tandas: la casa empieza a fallar peticiones cuando se la
// aprieta, y aquí un fallo no cuesta lentitud, cuesta una conclusión equivocada sobre dinero.
// CONCURRENCIA 1 Y PAUSA DE VERDAD (4-sep, medido): con 2 en paralelo y 60 ms la casa contestó al 4,7 % y
// devolvió 429 en el resto. Esta herramienta se ejecuta a mano una vez por semana; no hay ninguna razón
// para ir rápido y sí una muy buena para llegar entera.
async function preguntarPorReferencias(refs, { concurrencia = 1, cap = 400, pausaMs = 350, esperar = true } = {}) {
  const llave = process.env.CLOUDBET_API_KEY || '';
  if (!llave) return { ok: false, why: 'sin CLOUDBET_API_KEY', respuestas: new Map() };
  const lista = [...new Set(refs)].slice(0, cap);
  const respuestas = new Map();   // ref → apuesta de la casa | null (la casa dice que NO la tiene)
  const dudosas = [];             // ref → no se pudo saber
  let porCuota = 0;               // de esas, cuántas fueron porque la casa nos limitó (429)
  let i = 0;
  const obrero = async () => {
    while (i < lista.length) {
      const ref = lista[i++];
      const r = await leerApuesta(llave, ref, { esperar });
      if (r.estado === 'existe') respuestas.set(ref, r.bet);
      else if (r.estado === 'no_existe') respuestas.set(ref, null);
      else { dudosas.push({ ref, why: r.why }); if (r.cuota) porCuota++; }
      if (pausaMs) await new Promise((s2) => setTimeout(s2, pausaMs));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrencia) }, obrero));
  return { ok: true, preguntadas: lista.length, contestadas: respuestas.size, fallos: dudosas.length,
    limitados_por_la_casa: porCuota, dudosas: dudosas.slice(0, 10), truncado: refs.length > cap, respuestas };
}

// ── TABLA REFERENCIA → PICK ─────────────────────────────────────────────────────────────────────────────
function tablaReferencias(pickIds) {
  const t = new Map();
  for (const pid of new Set(pickIds.filter(Boolean))) {
    for (let e = 0; e <= ENVIOS_MAX; e++) t.set(S.refIdDe(pid, e), { pick_id: pid, envio: e });
  }
  return t;
}

// la línea del mercado viaja dentro de la url ("soccer.total_bookings/under?total=5.5")
const lineaDe = (marketUrl) => {
  const m = String(marketUrl || '').match(/total=([\d.]+)/);
  return m ? Number(m[1]) : null;
};

// ── LA COMPARACIÓN, PREGUNTANDO POR REFERENCIA (modo por defecto) ───────────────────────────────────────
// POR QUÉ ESTE MODO Y NO EL LISTADO. El listado del libro entero depende de un resolver de la casa que hoy
// devuelve INTERNAL_SERVER_ERROR; preguntar por una referencia concreta funciona —es lo que usa la
// liquidación a diario—. Así que en vez de pedirle a la casa "dame todo lo que tienes" y razonar sobre esa
// lista, se le pregunta por un conjunto ACOTADO de referencias que nos interesan:
//   · las de NUESTRAS filas dadas por colocadas  → si la casa no la tiene, es fantasma DE VERDAD
//   · las de las picks recientes que NO están en nuestro libro → si la casa sí la tiene, es huérfana
// Lo que este modo no puede ver son apuestas ajenas a nuestras picks (las que Alexis coloque por la web):
// para eso hace falta el listado, y se dice en el resultado en vez de fingir que se miró.
// `soloPicks` (5-sep): reconciliación DIRIGIDA a unas picks concretas — solo sus referencias, sin candidatas.
// Existe porque la pasada completa son ~400 preguntas a una casa que hoy contesta una de cada cinco, y para
// registrar dos duplicadas ya confirmadas no hace falta volver a preguntar por todo el libro.
async function compararPorReferencia({ pickIds = [], sombra = [], dias = 7, cap = 400, concurrencia = 1, pausaMs = 350, esperar = true, soloPicks = null } = {}) {
  const L = S.load();
  const soloSet = Array.isArray(soloPicks) && soloPicks.length ? new Set(soloPicks) : null;
  const filas = (Array.isArray(L.bets) ? L.bets : []).filter((f) => !soloSet || soloSet.has(f.pick_id));
  const porPick = new Map(sombra.filter((s) => s.pick_id).map((s) => [s.pick_id, s]));
  const enElLibro = new Set(filas.map((f) => f.pick_id));
  const corte = Date.now() - dias * 864e5;

  // 1) las nuestras que decimos tener colocadas (las manuales no: la casa no las conoce por referencia)
  // fuera las colocadas A MANO por la web: la casa no las conoce por nuestra referencia, así que
  // preguntarle por ellas solo puede producir fantasmas falsos. `via: 'manual'` marca las de tarjetas y
  // `motivo: 'solo_manual'` las de CS2, cuyo mercado la API ni siquiera cotiza.
  const esManual = (f) => f.via === 'manual' || f.motivo === 'solo_manual';
  // también las LIQUIDADAS recientes: una duplicada de la casa no desaparece porque nuestra fila ya cerrara
  const nuestras = filas.filter((f) => f.pick_id && !esManual(f)
    && (f.status === 'PLACED' || f.status === 'EN_ACEPTACION'
      || (f.status === 'SETTLED' && Date.parse(f.settled_at || f.placed_at || f.at || 0) >= corte)));
  const refsNuestras = new Map();     // ref → fila
  for (const f of nuestras) {
    if (f.ref_id) refsNuestras.set(f.ref_id, f);
    for (let e = 0; e <= Math.min(2, Number(f.envios) || 0); e++) refsNuestras.set(S.refIdDe(f.pick_id, e), f);
  }

  // 2) las picks recientes que NO tenemos en el libro: si la casa tiene alguna, la perdimos nosotros.
  // LAS CANDIDATAS SALEN DEL SOMBRA, NO DEL FEED ENTERO DE CLUBES. El ejecutor solo puede haber apostado
  // algo que antes fue apuesta del sombra dentro de su perímetro; meter las 3.600 picks del feed multiplica
  // por veinte las preguntas a la casa para buscar donde por construcción no puede haber nada, y encima
  // hace saltar el tope y truncar justo lo que sí importa. `pickIds` solo se usa si no vino el sombra.
  // Y DENTRO DEL PERÍMETRO. El ejecutor solo apuesta su segmento (familia, lado y casa fijos): una pick de
  // otra familia no puede estar en la casa a nombre nuestro, y preguntarlo son cientos de peticiones para
  // mirar donde por construcción no hay nada. Con la casa limitando peticiones, ese gasto no es neutro:
  // desplaza a las preguntas que sí importan y las deja sin respuesta.
  const enPerimetro = (sb) => {
    if (!sb) return true;                                    // sin datos no se descarta
    if (sb.segment && sb.segment !== S.SEGMENTO) return false;
    if (sb.family && String(sb.family).toUpperCase() !== S.FAMILIA) return false;
    if (sb.side && String(sb.side).toLowerCase() !== S.LADO) return false;
    if (sb.book && String(sb.book).toLowerCase() !== S.CASA) return false;
    return true;
  };
  // dirigida a unas picks: sin candidatas — solo se pregunta por las referencias de esas filas
  const universo = soloSet ? [] : (sombra.length ? sombra.filter(enPerimetro).map((s) => s.pick_id) : pickIds);
  const candidatas = [...new Set(universo)]
    .filter((pid) => pid && !enElLibro.has(pid))
    .filter((pid) => {
      const sb = porPick.get(pid);
      const t = sb && (sb.kickoff_at || sb.at) ? Date.parse(sb.kickoff_at || sb.at) : null;
      return t == null || t >= corte;   // sin fecha se pregunta igual: no perder una por no saber cuándo fue
    });
  const refsCandidatas = new Map();    // ref → {pick_id, envio}
  for (const pid of candidatas) for (let e = 0; e <= 2; e++) refsCandidatas.set(S.refIdDe(pid, e), { pick_id: pid, envio: e });

  const todas = [...refsNuestras.keys(), ...refsCandidatas.keys()];
  const q = await preguntarPorReferencias(todas, { concurrencia, cap, pausaMs, esperar });
  if (!q.ok) return { ok: false, why: q.why };

  const huerfanas = [], fantasmas = [], descuadres = [], sin_respuesta = [];
  for (const [ref, fila] of refsNuestras) {
    if (!q.respuestas.has(ref)) continue;               // no se preguntó (tope) o no contestó
    const b = q.respuestas.get(ref);
    if (b) {
      const dif = {};
      const stC = Number(b.stake), stN = Number(fila.stake);
      const prC = Number(b.price), prN = Number(fila.odds_real);
      if (Number.isFinite(stC) && Number.isFinite(stN) && Math.abs(stC - stN) > 0.011) dif.stake = { casa: stC, libro: stN };
      if (Number.isFinite(prC) && Number.isFinite(prN) && Math.abs(prC - prN) > 0.011) dif.precio = { casa: prC, libro: prN };
      if (Object.keys(dif).length) descuadres.push({ ref_id: ref, pick_id: fila.pick_id, evento: fila.match, ...dif });
    }
  }
  // una fila es fantasma solo si la casa CONTESTÓ que no tiene NINGUNA de sus referencias
  // DUPLICADAS (5-sep, tras Parma–Monza under 4,5): una fila con DOS O MÁS referencias que la casa tiene
  // como apuestas vivas o resueltas. Pasa cuando se quemó una referencia sin que la casa hubiera rechazado
  // de verdad el envío: cada referencia es una apuesta distinta en la casa y el libro solo cuenta una. Es
  // la categoría más cara de todas —dinero real puesto dos veces en la misma posición— y hasta hoy el
  // reconciliador no la veía, porque las dos referencias "pertenecían" a la misma fila y con que una
  // existiera daba la fila por cuadrada.
  const duplicadas = [];
  const RESUELTAS_O_VIVAS = new Set(['ACCEPTED', 'PENDING_ACCEPTANCE', 'WIN', 'LOSS', 'PUSH', 'HALF_WIN', 'HALF_LOSS', 'PARTIAL']);
  for (const f of nuestras) {
    const suyas = [f.ref_id, ...Array.from({ length: Math.min(3, (Number(f.envios) || 0) + 1) }, (_, e) => S.refIdDe(f.pick_id, e))].filter(Boolean);
    const contestadas = suyas.filter((r) => q.respuestas.has(r));
    if (!contestadas.length) { sin_respuesta.push({ pick_id: f.pick_id, match: f.match }); continue; }
    const vivas = [...new Set(contestadas)].filter((r) => { const b = q.respuestas.get(r); return b && RESUELTAS_O_VIVAS.has(String(b.betStatus || '').toUpperCase()); });
    if (vivas.length >= 2) {
      // la referencia que el libro conoce es la "oficial"; las demás son las apuestas de más
      const extra = vivas.filter((r) => r !== f.ref_id);
      duplicadas.push({
        pick_id: f.pick_id, match: f.match, line: f.line, side: f.side, ref_oficial: f.ref_id, stake_libro: f.stake,
        referencias_en_la_casa: vivas.length,
        de_mas: extra.map((r) => { const b = q.respuestas.get(r); return { ref_id: r, envio: suyas.indexOf(r) >= 1 ? suyas.indexOf(r) - 1 : null, precio: Number(b.price) || null, stake: Number(b.stake) || null, estado_casa: String(b.betStatus || '').toUpperCase(), retorno: b.returnAmount != null && b.returnAmount !== '' ? Number(b.returnAmount) : null, event_id: b.eventId || null, market_url: b.marketUrl || null, moneda: b.currency || null }; }),
      });
    }
    if (contestadas.some((r) => q.respuestas.get(r))) continue;      // la casa sí la tiene
    fantasmas.push({ ref_id: f.ref_id, pick_id: f.pick_id, match: f.match, stake: f.stake, status: f.status, placed_at: f.placed_at || f.at });
  }
  for (const [ref, quien] of refsCandidatas) {
    const b = q.respuestas.get(ref);
    if (!b) continue;
    huerfanas.push({
      ref_id: ref, pick_id: quien.pick_id, envio: quien.envio,
      evento: b.eventName || null, market_url: b.marketUrl || null,
      precio: Number(b.price) || null, stake: Number(b.stake) || null,
      estado_casa: String(b.betStatus || '').toUpperCase() || null,
      retorno: b.returnAmount != null ? Number(b.returnAmount) : null,
      moneda: b.currency || null, event_id: b.eventId || null,
    });
  }

  // "CUADRA" ES UNA AFIRMACIÓN, NO UNA AUSENCIA DE HALLAZGOS. Si la casa contestó a una de cada veinte
  // preguntas, no encontrar nada no significa que no haya nada: significa que no se miró. Una pasada así
  // devolviendo `cuadra: true` sería un semáforo en verde para encender el ejecutor sin haber comprobado
  // nada, que es justo la decisión que esto tiene que impedir. Por debajo del 80% de respuesta, `cuadra`
  // vale null y se dice por qué.
  const tasa = q.preguntadas ? q.contestadas / q.preguntadas : 1;
  const concluyente = tasa >= 0.8;
  const limpio = huerfanas.length === 0 && fantasmas.length === 0 && descuadres.length === 0 && duplicadas.length === 0;
  return {
    ok: true, modo: 'referencias',
    casa: { preguntadas: q.preguntadas, contestadas: q.contestadas, fallos: q.fallos, truncado: q.truncado,
      limitados_por_la_casa: q.limitados_por_la_casa || 0, tasa_respuesta: +(100 * tasa).toFixed(1) + '%', dudosas: q.dudosas || [] },
    libro: { filas: filas.length, colocadas: filas.filter((f) => f.status === 'PLACED').length },
    huerfanas, fantasmas, descuadres, duplicadas, desconocidas: [], sin_respuesta,
    cuadra: concluyente ? limpio : null,
    concluyente,
    por_que_no_concluyente: concluyente ? null
      : `la casa solo contestó ${q.contestadas} de ${q.preguntadas} preguntas (${(100 * tasa).toFixed(1)}%): no encontrar nada aquí no prueba nada`,
    aviso_fantasmas: sin_respuesta.length ? `${sin_respuesta.length} filas se quedaron sin respuesta de la casa: no son concluyentes` : null,
    nota_desconocidas: 'este modo pregunta solo por NUESTRAS referencias: no puede ver apuestas ajenas (las colocadas por la web)',
    sombra_disponible: porPick.size,
  };
}

// ── LA COMPARACIÓN POR LISTADO ──────────────────────────────────────────────────────────────────────────
// `pickIds` son todas las picks que pudieron llegar a apostarse (las del propio libro, las del sombra y las
// del feed de clubes). `sombra` es opcional y solo sirve para enriquecer una fila reconstruida con los
// datos que la casa no tiene: cuota del sombra, probabilidad del modelo, liga y saque.
async function comparar({ pickIds = [], sombra = [], casa = null, limit = 100, maxPaginas = 30 } = {}) {
  const libro = casa || await libroDeLaCasa({ limit, maxPaginas });
  if (!libro.ok) return { ok: false, why: libro.why, detalle: libro.detalle || null };

  const L = S.load();
  const filas = Array.isArray(L.bets) ? L.bets : [];
  // UN LIBRO VACÍO NO PRUEBA NADA cuando el nuestro dice que hay apuestas colocadas. Es muchísimo más
  // probable que la lectura haya fallado a que la casa haya perdido 84 apuestas, y sacar de ahí una lista
  // de "fantasmas" es exactamente cómo se toma una decisión destructiva sobre el libro del dinero.
  if (!libro.bets.length && filas.some((f) => f.status === 'PLACED')) {
    return { ok: false, why: 'la casa devolvió un libro vacío y el nuestro tiene apuestas colocadas: se asume lectura fallida, no libro vacío',
      libro: { filas: filas.length, colocadas: filas.filter((f) => f.status === 'PLACED').length } };
  }
  // una fila puede haber usado varias referencias (una por envío): se indexan TODAS o una apuesta colocada
  // con la referencia vieja parecería huérfana y se duplicaría al repararla.
  const porRef = new Map();
  for (const f of filas) {
    for (let e = 0; e <= Math.max(ENVIOS_MAX, Number(f.envios) || 0); e++) {
      if (f.pick_id) porRef.set(S.refIdDe(f.pick_id, e), f);
    }
    if (f.ref_id) porRef.set(f.ref_id, f);
  }
  const tabla = tablaReferencias([...pickIds, ...filas.map((f) => f.pick_id), ...sombra.map((s) => s.pick_id)]);
  const porPick = new Map(sombra.filter((s) => s.pick_id).map((s) => [s.pick_id, s]));

  const huerfanas = [], descuadres = [], desconocidas = [];
  const vistasEnLaCasa = new Set();
  for (const b of libro.bets) {
    const ref = b.referenceId;
    if (!ref) continue;
    vistasEnLaCasa.add(ref);
    const fila = porRef.get(ref);
    if (!fila) {
      const quien = tabla.get(ref);
      const reg = {
        ref_id: ref, evento: b.eventName || null, market_url: b.marketUrl || null,
        precio: Number(b.price) || null, stake: Number(b.stake) || null,
        estado_casa: String(b.betStatus || '').toUpperCase() || null,
        retorno: b.returnAmount != null ? Number(b.returnAmount) : null,
        moneda: b.currency || null, event_id: b.eventId || null,
      };
      if (quien) huerfanas.push({ ...reg, pick_id: quien.pick_id, envio: quien.envio });
      else desconocidas.push(reg);
      continue;
    }
    // misma apuesta en los dos libros: ¿dicen lo mismo?
    const dif = {};
    const stC = Number(b.stake), stN = Number(fila.stake);
    const prC = Number(b.price), prN = Number(fila.odds_real);
    if (Number.isFinite(stC) && Number.isFinite(stN) && Math.abs(stC - stN) > 0.011) dif.stake = { casa: stC, libro: stN };
    if (Number.isFinite(prC) && Number.isFinite(prN) && Math.abs(prC - prN) > 0.011) dif.precio = { casa: prC, libro: prN };
    if (Object.keys(dif).length) {
      descuadres.push({ ref_id: ref, pick_id: fila.pick_id, evento: b.eventName || fila.match, ...dif });
    }
  }

  // fantasmas: las damos por vivas o colocadas y la casa no las devuelve
  const fantasmas = filas
    .filter((f) => (f.status === 'PLACED' || f.status === 'EN_ACEPTACION') && f.via !== 'manual')
    .filter((f) => {
      for (let e = 0; e <= Math.max(ENVIOS_MAX, Number(f.envios) || 0); e++) {
        if (vistasEnLaCasa.has(S.refIdDe(f.pick_id, e))) return false;
      }
      return !(f.ref_id && vistasEnLaCasa.has(f.ref_id));
    })
    .map((f) => ({ ref_id: f.ref_id, pick_id: f.pick_id, match: f.match, stake: f.stake,
      status: f.status, placed_at: f.placed_at || f.at }));

  return {
    ok: true,
    casa: { apuestas: libro.bets.length, paginas: libro.paginas, completo: !!libro.completo, saldos: libro.saldos },
    libro: { filas: filas.length, colocadas: filas.filter((f) => f.status === 'PLACED').length },
    huerfanas, fantasmas, descuadres, desconocidas,
    cuadra: huerfanas.length === 0 && fantasmas.length === 0 && descuadres.length === 0,
    // sin el libro entero, "fantasma" no significa nada: se dice explícitamente.
    aviso_fantasmas: libro.completo ? null : 'el libro de la casa se leyó a medias: los fantasmas no son concluyentes',
    // enriquecer necesita el sombra; si no vino, las filas reconstruidas irán sin cuota de referencia
    sombra_disponible: porPick.size,
  };
}

// ── LA REPARACIÓN ───────────────────────────────────────────────────────────────────────────────────────
// Solo inserta huérfanas, y solo las que se pudieron atribuir a una pick. Nunca borra ni modifica una fila
// existente: lo único que este módulo puede hacerle al libro es AÑADIR lo que la casa demuestra que existe.
async function reparar({ pickIds = [], sombra = [], aplicar = false, limit = 100, maxPaginas = 30,
  modo = 'referencias', dias = 7, cap = 400, concurrencia = 1, pausaMs = 350, esperar = true, soloPicks = null } = {}) {
  // POR DEFECTO SE PREGUNTA POR REFERENCIA: es el camino que la casa contesta hoy. El listado queda como
  // segundo modo porque ve una cosa que el otro no —las apuestas ajenas a nuestras picks— y volverá a ser
  // útil el día que la casa arregle su resolver.
  const cmp = modo === 'listado'
    ? await comparar({ pickIds, sombra, limit, maxPaginas })
    : await compararPorReferencia({ pickIds, sombra, dias, cap, concurrencia, pausaMs, esperar, soloPicks });
  if (!cmp.ok) return cmp;
  // no se toca el libro con una comparación que no vio lo suficiente
  if (aplicar && cmp.concluyente === false) {
    return { ...cmp, aplicado: false, insertadas: 0,
      why: 'no se aplica nada: la comparación no fue concluyente — ' + cmp.por_que_no_concluyente };
  }
  const porPick = new Map(sombra.filter((s) => s.pick_id).map((s) => [s.pick_id, s]));

  const nuevas = cmp.huerfanas.map((h) => {
    const sb = porPick.get(h.pick_id) || null;
    const vivaOResuelta = h.estado_casa && !ESTADOS_VIVOS.has(h.estado_casa) ? h.estado_casa : null;
    return {
      ref_id: h.ref_id, envios: h.envio, pick_id: h.pick_id,
      shadow_id: (sb && sb.id) || null,
      match: h.evento || (sb && sb.match) || null,
      league: (sb && sb.league) || null,
      line: lineaDe(h.market_url) != null ? lineaDe(h.market_url) : ((sb && sb.line) || null),
      side: S.LADO,
      kickoff_at: (sb && sb.kickoff_at) || null,
      ceid: null,
      // la cuota del sombra y la probabilidad del modelo NO están en el libro de la casa. Si no vienen del
      // sombra se quedan a null: una cifra inventada aquí contaminaría el análisis de deslizamiento.
      odds_sombra: (sb && sb.odds) || null,
      model_prob: (sb && sb.model_prob) || null,
      at: new Date().toISOString(),
      status: 'PLACED',
      intentos: 0,
      odds_real: h.precio,
      stake: h.stake,
      placed_at: null,   // la casa no publica la hora; se deja vacío en vez de inventarla
      slippage_pct: (sb && sb.odds > 0 && h.precio > 0) ? +(100 * (h.precio / sb.odds - 1)).toFixed(2) : null,
      moneda: h.moneda || null,
      // marca de origen: estas filas no las colocó el ejecutor en esta vida, se rescataron del libro de la
      // casa. El informe tiene que poder separarlas, y `liquidar()` las cerrará como a cualquier otra.
      origen: 'reconciliacion',
      reconciliado_at: new Date().toISOString(),
      estado_casa_al_reconciliar: vivaOResuelta || h.estado_casa || null,
    };
  });

  // LAS DUPLICADAS TAMBIÉN ENTRAN AL LIBRO (5-sep): la apuesta de más existe en la casa con su dinero y su
  // resultado, y el libro tiene que verla para que la exposición, el P&L y la parada diaria sean verdad.
  // Entra como fila propia, hermana de la oficial: mismo partido, misma línea, la referencia quemada, el
  // precio y el stake que dice la casa, y marcada `duplicada_de` para que el informe la separe y para que
  // nadie la lea como una decisión del modelo. `liquidar()` la cierra contra la casa como a cualquier otra.
  // El pick_id lleva sufijo para no chocar con la puerta "una fila por pick" del ejecutor.
  const filasLibro = S.load().bets || [];
  const porPickLibro = new Map(filasLibro.map((f) => [f.pick_id, f]));
  const nuevasDup = [];
  for (const d of (cmp.duplicadas || [])) {
    const oficial = porPickLibro.get(d.pick_id) || null;
    for (const x of d.de_mas) {
      nuevasDup.push({
        ref_id: x.ref_id, envios: x.envio != null ? x.envio : 0, pick_id: `${d.pick_id}~dup${x.envio != null ? x.envio : 'x'}`,
        shadow_id: (oficial && oficial.shadow_id) || null,
        match: d.match || null, league: (oficial && oficial.league) || null, banda: (oficial && oficial.banda) || null,
        line: d.line != null ? d.line : lineaDe(x.market_url), side: d.side || S.LADO,
        kickoff_at: (oficial && oficial.kickoff_at) || null, ceid: (oficial && oficial.ceid) || null,
        cb_event_id: x.event_id || (oficial && oficial.cb_event_id) || null,
        odds_sombra: (oficial && oficial.odds_sombra) || null, model_prob: (oficial && oficial.model_prob) || null,
        at: new Date().toISOString(), status: 'PLACED', intentos: 0,
        odds_real: x.precio, stake: x.stake, placed_at: null,
        slippage_pct: (oficial && oficial.odds_sombra > 0 && x.precio > 0) ? +(100 * (x.precio / oficial.odds_sombra - 1)).toFixed(2) : null,
        moneda: x.moneda || null, via: (oficial && oficial.via) || null,
        origen: 'reconciliacion', duplicada_de: d.pick_id, reconciliado_at: new Date().toISOString(),
        estado_casa_al_reconciliar: x.estado_casa || null,
        detalle: `apuesta DE MÁS en la casa: la fila ${d.pick_id} tenía ${d.referencias_en_la_casa} referencias aceptadas`,
      });
    }
  }

  if (!aplicar) {
    return { ...cmp, aplicado: false, insertaria: nuevas.length, insertaria_duplicadas: nuevasDup.length,
      muestra: nuevas.slice(0, 10).map((n) => ({ pick_id: n.pick_id, match: n.match, stake: n.stake, odds_real: n.odds_real, estado_casa: n.estado_casa_al_reconciliar })),
      muestra_duplicadas: nuevasDup.slice(0, 10).map((n) => ({ pick_id: n.pick_id, match: n.match, line: n.line, stake: n.stake, odds_real: n.odds_real, ref_id: n.ref_id })) };
  }

  const L = S.load();
  let insertadas = 0;
  const saltadas = [];
  for (const n of nuevas.concat(nuevasDup)) {
    // SEGUNDA PUERTA, y a propósito redundante con la comparación: nunca dos filas para la misma referencia
    // ni para la misma pick. La comparación ya debería haberlas descartado; si aquí salta alguna es que algo
    // no cuadra en el razonamiento de arriba, y eso se anota en vez de tragárselo.
    const choca = L.bets.find((b) => b.ref_id === n.ref_id || b.pick_id === n.pick_id);
    if (choca) { saltadas.push({ pick_id: n.pick_id, ref_id: n.ref_id, ya_existe_como: choca.status }); continue; }
    L.bets.push(n);
    // el importe cuenta para el día en que se reconcilia: la casa no dice cuándo se colocó, y dejarlo fuera
    // haría que la parada diaria juzgara con menos dinero apostado del que hay de verdad
    const d = new Date().toISOString().slice(0, 10);
    L.dias[d] = L.dias[d] || { pnl: 0, apostado: 0, n: 0 };
    L.dias[d].apostado += Number(n.stake) || 0;
    L.dias[d].n += 1;
    insertadas++;
  }
  if (insertadas) S.save();
  return { ...cmp, aplicado: true, insertadas, saltadas,
    nota: 'las filas entran como PLACED; liquidar() las cerrará contra la casa en la pasada siguiente' };
}

module.exports = { libroDeLaCasa, leerApuesta, preguntarPorReferencias, comparar, compararPorReferencia, reparar, tablaReferencias, ENVIOS_MAX };
