// polymarket/ejecutor.js — EL CEREBRO DEL DINERO REAL EN POLYMARKET (13-sep-2026)
//
// QUÉ ES. Lo que decide qué señales se colocan, de cuánto y cuándo parar. Vive en el servidor principal; la
// firma y la clave viven en el brazo de Helsinki. Esa separación es deliberada y es la misma de Cloudbet:
// el cerebro es público y tiene mucha superficie, el brazo no sirve a nadie más.
//
// LA DOCTRINA, QUE NO SE REINVENTA — ya nos costó dinero aprenderla en Cloudbet y se aplica aquí desde el
// primer día en vez de después del primer susto:
//
//   1. UNA POSICIÓN POR EVENTO Y FAMILIA. Dos líneas del mismo partido no son dos apuestas: son la misma
//      apuesta con dos etiquetas, y se ganan y se pierden juntas. En card under eso convirtió −190 en −413.
//   2. TOPE DE EXPOSICIÓN. Con un banco pequeño, un día con muchas señales lo vacía antes del mediodía.
//   3. PARADA DIARIA. Si un día pierde más de un porcentaje del banco, se para hasta el siguiente.
//   4. LOS REINTENTOS RESPETAN EL SAQUE. Una señal sin fondos reintenta mientras el partido no empiece, no
//      un número fijo de veces.
//   5. NADA SE COLOCA SIN UN INTERRUPTOR EXPLÍCITO. Por defecto esto no coloca: ensaya.
//
// LO QUE DE VERDAD PRODUCE ESTE EJECUTOR. No es beneficio: con $200 y la varianza medida no hay forma de
// distinguir una ventaja real del ruido —harían falta unas 800 apuestas—. Lo que produce es la ÚNICA
// medición que el papel no puede dar: cuánto se aleja el fill REAL del fill SIMULADO. Por eso cada posición
// guarda los dos, y por eso el tablero compara esa diferencia antes que el P&L.
'use strict';

const path = require('path');
const JS = require('../lib/jsonstore');

const DIR = process.env.GP_PM_DIR || (require('fs').existsSync('/data') ? '/data/polymarket' : path.join(__dirname, '..', 'data', 'polymarket'));
const FNAME = 'real.json';
const GAMMA = 'https://gamma-api.polymarket.com';

// ── LA CONFIGURACIÓN: lo único que Alexis tiene que decidir ─────────────────────────────────────────────
// Tres números y una lista. Todo lo demás (tick de cada mercado, si es de riesgo negativo, el tipo de firma
// de la cuenta) lo averigua el sistema solo, porque son datos de la casa y no decisiones suyas.
const CFG = () => ({
  encendido: /^(1|true|si|sí|on|yes)$/i.test(String(process.env.GP_PM_ENABLED || '').trim()),
  banco: Number(process.env.GP_PM_BANCO || 200),
  stake: Number(process.env.GP_PM_STAKE || 5),               // dólares por apuesta, plano
  exposicion_max: Number(process.env.GP_PM_MAX_EXPOSICION || 0) || null,   // por defecto, la mitad del banco
  parada_diaria_pct: Number(process.env.GP_PM_PARADA_DIARIA_PCT || 15),
  familias: String(process.env.GP_PM_FAMILIAS || 'futbol:no').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  min_shares: Number(process.env.GP_PM_MIN_SHARES || 5),      // la casa suele exigir 5
});
const topeExposicion = (c) => (c.exposicion_max != null ? c.exposicion_max : +(c.banco / 2).toFixed(2));

const rd = () => JS.readJson(DIR, FNAME, 'pm-real') || { banco_inicial: null, efectivo: null, posiciones: {}, at: null };
const wr = (st) => JS.writeJson(DIR, FNAME, st, 'pm-real');
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const hoy = () => new Date().toISOString().slice(0, 10);

// ── QUÉ SEÑALES SE TOMAN ────────────────────────────────────────────────────────────────────────────────
// La lista de familias es del tipo `deporte:lado`. `futbol:no` es la que Alexis quiere probar. Se compara
// en minúsculas y se acepta `*` para "todo de ese deporte", pero por defecto va lo mínimo: abrir la puerta
// entera con dinero real es justo lo contrario de lo que dice la doctrina.
function familiaDe(s) {
  const dep = String(s.deporte || s.game || (/^Will .+ win on /i.test(String(s.mercado || '')) ? 'futbol' : '?')).toLowerCase();
  return `${dep}:${String(s.lado || '').toLowerCase()}`;
}
function permitida(s, c) {
  const f = familiaDe(s);
  return c.familias.includes(f) || c.familias.includes(f.split(':')[0] + ':*');
}

// ── EL BARRIDO ──────────────────────────────────────────────────────────────────────────────────────────
// `colocarFn(orden)` es lo que habla con el brazo; se inyecta para poder probar todo esto sin red y sin
// clave. `simular(s)` devuelve el fill que la sombra habría conseguido, para guardarlo al lado del real.
async function barrer({ senales = {}, colocarFn, simularFn = null, ahora = Date.now(), forzarSeco = false } = {}) {
  const c = CFG();
  const st = rd();
  if (st.banco_inicial == null) { st.banco_inicial = c.banco; st.efectivo = c.banco; }
  const out = { at: new Date().toISOString(), encendido: c.encendido, seco: forzarSeco || !c.encendido,
    revisadas: 0, colocadas: 0, rechazadas: 0, sin_fondos: 0, apiladas: 0, fuera_de_familia: 0,
    por_tope: 0, por_parada_diaria: 0, ya_estaban: 0, sin_token: 0, detalle: [] };

  const vivas = Object.values(st.posiciones || {});
  const expuesto = vivas.filter((p) => p.estado === 'COLOCADA').reduce((a, p) => a + (p.costo || 0), 0);
  // parada diaria: lo perdido HOY contra el banco
  const pnlHoy = vivas.filter((p) => (p.resuelto_at || '').slice(0, 10) === hoy())
    .reduce((a, p) => a + (p.pnl || 0), 0);
  const paradaDiaria = pnlHoy < -(c.banco * c.parada_diaria_pct / 100);
  out.expuesto = r2(expuesto); out.pnl_hoy = r2(pnlHoy); out.parada_diaria = paradaDiaria;

  // (evento, familia) que ya tienen posición: el antiapilamiento.
  // OJO: este conjunto se actualiza DENTRO del bucle, en cuanto se decide colocar. Calcularlo solo al
  // empezar deja pasar dos señales del mismo partido en la MISMA pasada — que es exactamente el fallo que
  // convirtió −190 en −413 en card under. Lo detectó la prueba en seco: dos señales de "Alfa vs Beta"
  // entraron las dos y el contador de apiladas marcaba cero.
  const ocupado = new Set();
  for (const p of vivas) if (p.estado !== 'RECHAZADA') ocupado.add(`${p.evento}|${p.familia}`);

  let expo = expuesto;
  for (const s of Object.values(senales)) {
    if (s.estado !== 'ABIERTA' || s.tipo === 'modelo_sombra') continue;
    const ko = Date.parse(s.ko || 0);
    if (!(ko > ahora)) continue;                                    // el partido ya empezó: la ventana se cerró
    out.revisadas++;
    const prev = st.posiciones[s.id];
    if (prev && prev.estado !== 'SIN_FONDOS') { out.ya_estaban++; continue; }
    if (!permitida(s, c)) { out.fuera_de_familia++; continue; }
    if (!s.token) { out.sin_token++; continue; }
    const fam = familiaDe(s);
    const clave = `${s.evento}|${fam}`;
    if (!prev && ocupado.has(clave)) { out.apiladas++; continue; }
    if (paradaDiaria) { out.por_parada_diaria++; continue; }

    const precio = Number(s.limite != null ? s.limite : s.precio_pm);
    if (!(precio > 0 && precio < 1)) { out.rechazadas++; continue; }
    const shares = Math.floor(c.stake / precio);
    if (shares < c.min_shares) {
      // con stake pequeño y precio alto no se llega al mínimo de la casa: es una medición, no un fallo
      out.rechazadas++; out.detalle.push({ id: s.id, why: `${shares} acciones < mínimo ${c.min_shares}` });
      continue;
    }
    const coste = +(shares * precio).toFixed(2);
    if (expo + coste > topeExposicion(c)) { out.por_tope++; continue; }
    if (coste > (st.efectivo || 0)) {
      st.posiciones[s.id] = { ...(prev || {}), ...base(s, fam), estado: 'SIN_FONDOS',
        intentos: ((prev && prev.intentos) || 0) + 1, ultimo_intento: new Date().toISOString() };
      out.sin_fondos++; continue;
    }

    const orden = { tokenId: String(s.token), side: 'BUY', price: precio, size: shares, ref: s.id };
    // el hueco se RESERVA aquí, antes de colocar: si dos señales del mismo partido y familia llegan en la
    // misma pasada, la segunda ya lo encuentra ocupado
    ocupado.add(clave);
    if (out.seco) {
      out.detalle.push({ id: s.id, seco: true, ...orden, coste });
      continue;                                                     // en seco NO se anota posición
    }
    let r = null;
    try { r = await colocarFn(orden); } catch (e) { r = { ok: false, error: e.message }; }
    const sim = simularFn ? await simularFn(s, { shares, precio }).catch(() => null) : null;
    const aceptada = !!(r && r.ok && r.respuesta && (r.respuesta.success !== false));
    const id = (r && r.respuesta && (r.respuesta.orderID || r.respuesta.orderId || r.respuesta.id)) || null;
    st.posiciones[s.id] = {
      ...base(s, fam),
      estado: aceptada ? 'COLOCADA' : 'RECHAZADA',
      orden_id: id, precio_limite: precio, shares, costo: aceptada ? coste : 0,
      // EL DATO POR EL QUE SE HACE TODO ESTO: lo que la sombra decía que costaría, al lado de lo real.
      fill_simulado: sim ? { precio: sim.precio_medio, shares: sim.shares, costo: sim.costo } : null,
      respuesta: r && r.respuesta ? { status: r.status, ...recorta(r.respuesta) } : { status: r && r.status, error: (r && (r.error || r.rechazado_por_el_brazo)) || null },
      colocada_at: new Date().toISOString(),
    };
    if (aceptada) { expo += coste; st.efectivo = r2((st.efectivo || 0) - coste); out.colocadas++; }
    else out.rechazadas++;
    out.detalle.push({ id: s.id, evento: s.evento, aceptada, coste, orden_id: id,
      why: aceptada ? null : ((r && (r.rechazado_por_el_brazo || r.error)) || (r && r.respuesta && r.respuesta.error) || 'rechazada') });
  }
  st.at = new Date().toISOString();
  if (!out.seco) wr(st);
  return out;
}
const base = (s, fam) => ({
  senal_id: s.id, evento: s.evento, mercado: s.mercado, familia: fam, lado: s.lado,
  deporte: s.deporte || s.game || null, token: s.token, outcome_idx: s.outcome_idx, pm_mid: s.pm_mid,
  ko: s.ko, precio_senal: s.precio_pm, consenso: s.consenso, edge_pp: s.edge_pp,
  at: new Date().toISOString(),
});
// la respuesta de la casa se guarda RECORTADA: lo que hace falta para reconciliar, no un volcado entero
const recorta = (r) => ({ orderID: r.orderID || r.orderId || r.id || null, success: r.success,
  status: r.status, errorMsg: r.errorMsg || r.error || null,
  making: r.makingAmount || null, taking: r.takingAmount || null });

// ── LIQUIDAR ────────────────────────────────────────────────────────────────────────────────────────────
// Mismo camino que la sombra: la resolución la da el PROPIO venue. Si ejecutamos de verdad, Polymarket
// paga según SU resolución, no según nuestro liquidador — usar el nuestro sería medir otra cosa.
async function liquidar({ fetchJson, ahora = Date.now(), tope = 25 } = {}) {
  const st = rd();
  const pend = Object.values(st.posiciones || {}).filter((p) => p.estado === 'COLOCADA'
    && p.pm_mid && Date.parse(p.ko || 0) < ahora - 30 * 60e3);
  const out = { liquidadas: 0, esperando: 0, sin_mercado: 0, pendientes: pend.length };
  let toques = 0;
  for (const p of pend) {
    if (toques >= tope) { out.esperando++; continue; }
    toques++;
    let m = null;
    try { m = await fetchJson(`${GAMMA}/markets/${encodeURIComponent(p.pm_mid)}`); } catch { m = null; }
    if (!m || !m.id) { out.esperando++; out.sin_mercado++; continue; }
    const precios = (() => { try { return JSON.parse(m.outcomePrices || '[]').map(Number); } catch { return []; } })();
    const win = precios.findIndex((x) => x >= 0.99);
    if (!m.closed || win < 0) { out.esperando++; continue; }
    const gana = win === p.outcome_idx;
    p.estado = gana ? 'WIN' : 'LOSS';
    p.resuelto_at = new Date().toISOString();
    p.pnl = gana ? r2(p.shares - p.costo) : r2(-p.costo);           // cada acción ganadora paga $1
    if (gana) st.efectivo = r2((st.efectivo || 0) + p.shares);
    out.liquidadas++;
  }
  if (out.liquidadas) { st.at = new Date().toISOString(); wr(st); }
  return out;
}

// ── EL TABLERO ──────────────────────────────────────────────────────────────────────────────────────────
function estado() {
  const c = CFG();
  const st = rd();
  const pos = Object.values(st.posiciones || {});
  const col = pos.filter((p) => p.estado === 'COLOCADA');
  const cer = pos.filter((p) => p.estado === 'WIN' || p.estado === 'LOSS');
  const pnl = cer.reduce((a, p) => a + (p.pnl || 0), 0);
  const coste = cer.reduce((a, p) => a + (p.costo || 0), 0);
  const expuesto = col.reduce((a, p) => a + (p.costo || 0), 0);

  // LO QUE IMPORTA DE VERDAD: real contra simulado. Con 200 dólares el P&L no dice nada; esto sí.
  const conAmbos = pos.filter((p) => p.fill_simulado && p.fill_simulado.precio > 0 && p.precio_limite > 0 && p.costo > 0);
  const difs = conAmbos.map((p) => (p.costo / p.shares) - p.fill_simulado.precio);
  const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sd = (a) => { if (a.length < 2) return null; const m = media(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

  return {
    at: st.at, cfg: { encendido: c.encendido, banco: c.banco, stake: c.stake,
      exposicion_max: topeExposicion(c), parada_diaria_pct: c.parada_diaria_pct, familias: c.familias },
    banco_inicial: st.banco_inicial, efectivo: st.efectivo, expuesto: r2(expuesto),
    equity: r2((st.efectivo || 0) + expuesto),
    abiertas: col.length, w: cer.filter((p) => p.estado === 'WIN').length, l: cer.filter((p) => p.estado === 'LOSS').length,
    rechazadas: pos.filter((p) => p.estado === 'RECHAZADA').length,
    sin_fondos: pos.filter((p) => p.estado === 'SIN_FONDOS').length,
    pnl_usd: r2(pnl), roi_pct: coste > 0 ? r2(100 * pnl / coste) : null,
    ejecucion: {
      n: difs.length,
      deslizamiento_real_vs_simulado_pp: difs.length ? r2(100 * media(difs)) : null,
      sd_pp: difs.length > 1 ? r2(100 * sd(difs)) : null,
      lectura: !difs.length ? 'sin fills todavía'
        : `el fill real sale ${r2(100 * media(difs))} pp ${media(difs) >= 0 ? 'PEOR' : 'mejor'} que el simulado sobre ${difs.length} órdenes`,
      porque_importa: 'con este banco el P&L no puede distinguir ventaja de ruido; esta diferencia sí se mide con pocas órdenes, y es lo que invalida o confirma toda la sombra',
    },
    ultimas: pos.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15).map((p) => ({
      evento: p.evento, familia: p.familia, estado: p.estado, limite: p.precio_limite,
      shares: p.shares, costo: p.costo, simulado: p.fill_simulado ? p.fill_simulado.precio : null,
      pnl: p.pnl != null ? p.pnl : null, why: p.respuesta && p.respuesta.errorMsg })),
  };
}

function reset() {
  const c = CFG();
  const st = { banco_inicial: c.banco, efectivo: c.banco, posiciones: {}, at: new Date().toISOString(), reset_at: new Date().toISOString() };
  wr(st);
  return { ok: true, banco: c.banco };
}

// ── LOS CINCO ESCALONES DEL ALTA ────────────────────────────────────────────────────────────────────────
// Vive aquí, separado de la ruta, porque es la PUERTA DE SALIDA A DINERO REAL: lo que decide si el ejecutor
// arranca. Y porque ya falló de la forma más tonta posible — la ruta leía los campos del diagnóstico un
// nivel por encima de donde están, así que los tres primeros escalones salían en rojo con el brazo
// perfectamente sano. Se descubrió probando el alta entera con la cuenta de pruebas; sin esa prueba habría
// aparecido el día del dinero de verdad, y con las prisas de ese día.
//
// Recibe lo que ya contestaron el brazo y la casa; no llama a nadie. Así se puede probar entera.
function pasosAlta({ diag, tipoFirma, transporteDiag, transporteTipo } = {}) {
  const d = diag || {};
  const paso = [];
  paso.push({ n: 1, pregunta: '¿el brazo responde y la región deja colocar?',
    ok: !!(d.clave_presente && d.bloqueado_por_region === false),
    detalle: { pais: d.donde_estamos && d.donde_estamos.pais, region_bloqueada: d.bloqueado_por_region,
      lectura: d.lectura, trading: d.trading, veredicto: d.veredicto, transporte: transporteDiag } });
  paso.push({ n: 2, pregunta: '¿la clave da la dirección del firmante que muestra Polymarket?',
    ok: !!d.firmante, firmante: d.firmante, maker: d.maker_configurado,
    comprueba: d.firmante ? 'que este firmante sea el que muestra Polymarket en Ajustes' : null,
    nota: d.maker_igual_firmante === false ? 'la cuenta y el firmante son distintos: es Proxy o Safe' : null });
  paso.push({ n: 3, pregunta: '¿la casa nos entrega credenciales de trading?',
    ok: !!(d.credenciales && d.credenciales.ok), detalle: d.credenciales });
  const listo3 = paso.every((x) => x.ok);
  if (listo3 && tipoFirma !== undefined) {
    const tf = tipoFirma || {};
    // NO basta con que la casa nos diga el tipo: el brazo tiene que estar FIRMANDO con ese tipo. Si mide
    // uno y firma otro, todas las órdenes se rechazan y el alta habría salido en verde — que fue justo lo
    // que pasó la primera vez que se probó esto entero.
    paso.push({ n: 4, pregunta: '¿cuál es el tipo de firma de esta cuenta, y es el que usa el brazo?',
      ok: !!(tf.ok && tf.coincide !== false),
      tipo_firma: tf.tipo_firma, tipo_en_uso: tf.tipo_en_uso, coincide: tf.coincide,
      AVISO: tf.AVISO, cancelada: tf.cancelada, intentos: tf.intentos, mercado: tf.mercado,
      nota: tf.nota, falta: tf.falta, why: tf.why, siguiente: tf.siguiente_paso, transporte: transporteTipo });
  } else if (listo3) {
    paso.push({ n: 4, pregunta: '¿cuál es el tipo de firma de esta cuenta?', ok: false,
      falta: 'pásame `&token=<token_id de un mercado abierto>` y lo averiguo con una orden que no puede llenarse (coste cero)' });
  }
  const c = CFG();
  paso.push({ n: 5, pregunta: '¿la política del ejecutor está puesta?',
    ok: !!(c.banco > 0 && c.stake > 0 && c.familias.length),
    politica: { encendido: c.encendido, banco: c.banco, stake: c.stake, exposicion_max: topeExposicion(c),
      parada_diaria_pct: c.parada_diaria_pct, familias: c.familias } });
  const todos = paso.every((x) => x.ok);
  return { alta_completa: todos, paso,
    veredicto: todos
      ? (c.encendido ? 'LISTO Y ENCENDIDO: el ejecutor colocará en el próximo barrido.'
        : 'LISTO PERO EN SECO: falta poner GP_PM_ENABLED=1 para que coloque de verdad.')
      : 'FALTA algo — mira el primer paso con ok:false.' };
}

module.exports = { CFG, topeExposicion, familiaDe, permitida, barrer, liquidar, estado, reset, pasosAlta, DIR };
