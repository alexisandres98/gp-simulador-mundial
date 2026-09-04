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
    const lote = Array.isArray(data.bets) ? data.bets : [];
    if (Array.isArray(data.accountBalances) && data.accountBalances.length) saldos = data.accountBalances;
    bets.push(...lote);
    paginas++;
    if (lote.length < limit) { completo = true; break; }
  }
  // COMPLETO O NO, Y QUE SE VEA. Si el libro de la casa se leyó a medias, cualquier "fantasma" es sospecha
  // de página que falta, no hallazgo. Quien use esto tiene que poder distinguirlo.
  return { ok: true, bets, saldos, paginas, completo, total: bets.length };
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

// ── LA COMPARACIÓN ──────────────────────────────────────────────────────────────────────────────────────
// `pickIds` son todas las picks que pudieron llegar a apostarse (las del propio libro, las del sombra y las
// del feed de clubes). `sombra` es opcional y solo sirve para enriquecer una fila reconstruida con los
// datos que la casa no tiene: cuota del sombra, probabilidad del modelo, liga y saque.
async function comparar({ pickIds = [], sombra = [], casa = null, limit = 100, maxPaginas = 30 } = {}) {
  const libro = casa || await libroDeLaCasa({ limit, maxPaginas });
  if (!libro.ok) return { ok: false, why: libro.why, detalle: libro.detalle || null };

  const L = S.load();
  const filas = Array.isArray(L.bets) ? L.bets : [];
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
async function reparar({ pickIds = [], sombra = [], aplicar = false, limit = 100, maxPaginas = 30 } = {}) {
  const cmp = await comparar({ pickIds, sombra, limit, maxPaginas });
  if (!cmp.ok) return cmp;
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

  if (!aplicar) {
    return { ...cmp, aplicado: false, insertaria: nuevas.length,
      muestra: nuevas.slice(0, 10).map((n) => ({ pick_id: n.pick_id, match: n.match, stake: n.stake, odds_real: n.odds_real, estado_casa: n.estado_casa_al_reconciliar })) };
  }

  const L = S.load();
  let insertadas = 0;
  const saltadas = [];
  for (const n of nuevas) {
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

module.exports = { libroDeLaCasa, comparar, reparar, tablaReferencias, ENVIOS_MAX };
