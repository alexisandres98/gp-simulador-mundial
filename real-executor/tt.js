// real-executor/tt.js — TENIS DE MESA AL DINERO REAL: TOTAL DE PUNTOS EN CLOUDBET, $5 PLANOS (9-sep, orden de Alexis)
//
// "Coloca total points de table tenis en el ejecutor de dinero real en Cloudbet, apostando siempre 5 dólares."
// Es un canal APARTE del perímetro de tarjetas (`store.js` sigue escrito en piedra: CARDS · under · cloudbet):
// aquí la familia es POINTS_TOTAL del partido (`table_tennis.totals`), el lado el que diga la tesis de la sombra
// (over o under), la casa Cloudbet, y el stake PLANO de $5 — o el máximo de la casa si es menor, nunca más.
// Comparte con tarjetas todo lo que protege el dinero: el libro mayor, la referencia idempotente, los frenos de
// cartera, la puerta cerrada de la casa, la confirmación de lo que queda en el aire y la liquidación por
// referencia contra el estado de la casa. Lo único distinto es de dónde sale la señal y cómo se localiza la
// selección: las filas de Cloudbet de tenis de mesa ya traen el id del evento y `market_key`/`params`.
//
// Por qué esta familia (chat 9-sep): Cloudbet cotiza los totales de tenis de mesa con una plantilla (73,5 / 75,5)
// y no los mueve hasta el saque (CLV propio plano en los cinco cubos), y nuestro compilador los saca del proceso
// de punto validado fuera de muestra. El ganador queda fuera: es el mercado eficiente.
'use strict';

const RE = require('./store');
const CB = require('../market-scanner/venues/cloudbet');

const FAMILIA = 'TT_POINTS';
const SEGMENTO = 'tt_points_total_v1';
const MARKET_KEY = 'table_tennis.totals';
const CASA = 'cloudbet';
const FAMILIA_SOMBRA = 'POINTS_TOTAL';

const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const ttOn = () => !/^(0|false|no|off)$/i.test(String(process.env.GP_REAL_TT_ENABLED == null ? 'true' : process.env.GP_REAL_TT_ENABLED).trim());
const STAKE = () => num('GP_REAL_TT_STAKE', 5);
const REINTENTOS_MAX = 60;
const CON_DINERO = new Set(['PLACED', 'EN_ACEPTACION', 'SETTLED']);
const hoy = () => new Date().toISOString().slice(0, 10);

function ocupada(L, fila) {
  return (L.bets || []).find((b) => b !== fila && b.pick_id !== fila.pick_id && CON_DINERO.has(b.status)
    && b.cb_event_id && fila.cb_event_id && String(b.cb_event_id) === String(fila.cb_event_id)
    && String(b.side || '').toLowerCase() === String(fila.side || '').toLowerCase()
    && b.line != null && fila.line != null && Number(b.line) === Number(fila.line)) || null;
}

// la fila nace de la tesis de la sombra de tenis de mesa (tt-engine/store.js picks.json)
function crear(pick) {
  const L = RE.load();
  if (L.bets.some((b) => b.pick_id === pick.key)) return null;
  const fila = {
    ref_id: RE.refIdDe(pick.key, 0), envios: 0, pick_id: pick.key, shadow_id: pick.key,
    familia: FAMILIA, segment: SEGMENTO, canal: 'auto', deporte: 'tt',
    match: `${pick.a} vs ${pick.b}`, league: pick.tournament || null, sub: pick.sub || null,
    line: pick.line, side: String(pick.side || '').toLowerCase(), kickoff_at: pick.start_at || null,
    cb_event_id: pick.cb_event_id ? String(pick.cb_event_id) : null, market_key: pick.market_key || MARKET_KEY,
    odds_sombra: pick.odds, model_prob: pick.p_model, edge_pp: pick.edge_pp, unc_pp: pick.unc_pp,
    stake: STAKE(), at: new Date().toISOString(), status: 'PENDIENTE', intentos: 0,
  };
  L.bets.push(fila);
  RE.save();
  return fila;
}

async function colocar(fila) {
  const C = RE.CFG(), L = RE.load();
  if (fila.familia !== FAMILIA) return fila;
  const parar = (motivo, extra, definitivo = false) => { Object.assign(fila, { motivo, ...(extra || {}) }); fila.status = definitivo ? 'DESCARTADA' : 'PENDIENTE'; RE.save(); return fila; };
  const ko = fila.kickoff_at ? Date.parse(fila.kickoff_at) : null;
  if (ko && ko <= Date.now()) { fila.status = 'CADUCADA'; RE.save(); return fila; }
  fila.intentos = (fila.intentos || 0) + 1;
  fila.ultimo_intento_at = new Date().toISOString();
  if (fila.intentos > REINTENTOS_MAX) { fila.status = 'CADUCADA'; fila.motivo = 'demasiados_intentos'; RE.save(); return fila; }
  if (!ttOn()) return parar('canal_apagado', { detalle: 'GP_REAL_TT_ENABLED=false' });
  if (!fila.cb_event_id) return parar('sin_id_de_evento');
  if (String(fila.side) !== 'over' && String(fila.side) !== 'under') return parar('lado_raro', { side: fila.side }, true);
  if (!(Number(fila.line) > 0)) return parar('linea_rara', { line: fila.line }, true);
  const oc = ocupada(L, fila);
  if (oc) return parar('linea_ya_apostada', { detalle: `ya hay ${oc.status} a ${fila.side} ${fila.line} en el evento ${fila.cb_event_id} (pick ${oc.pick_id})` }, true);

  // el precio VIVO y las coordenadas de colocación, del evento crudo de la casa
  const ev = await CB.eventRaw(process.env.CLOUDBET_API_KEY || '', fila.cb_event_id).catch(() => null);
  if (!ev) return parar('evento_ilegible');
  const sel = CB.selectionFor(ev, MARKET_KEY, fila.line, fila.side);
  if (!sel) return parar('linea_no_cotizada', { mercados: Object.keys(ev.markets || {}).filter((k) => /table_tennis/.test(k)).slice(0, 8) });
  fila.precio_vivo = sel.price; fila.market_url = sel.marketUrl; fila.max_stake = sel.maxStake; fila.min_stake = sel.minStake; fila.estado_seleccion = sel.status;
  if (sel.status && /DISABLED|SUSPENDED|CLOSED/i.test(sel.status)) return parar('seleccion_cerrada', { estado: sel.status });
  if (!(sel.price > 1)) return parar('sin_precio');
  if (!sel.marketUrl) return parar('sin_market_url');
  // deslizamiento: si la casa empeoró el precio más de lo tolerado, se vuelve a mirar en la siguiente pasada
  const minAceptable = fila.odds_sombra * (1 - C.minOddsSlipPct);
  if (sel.price < minAceptable) return parar('precio_peor', { ofrecido: sel.price, minimo: +minAceptable.toFixed(3) });

  // $5 planos, o el máximo de la casa si es menor; jamás más
  const tope = STAKE();
  let stake = Math.round(Math.min(tope, sel.maxStake != null ? sel.maxStake : tope) * 100) / 100;
  if (sel.minStake != null && stake < sel.minStake) return parar('minimo_de_la_casa', { minimo: sel.minStake });
  if (!(stake >= 1)) return parar('tope_de_la_casa_muy_bajo', { max_casa: sel.maxStake });
  fila.stake = stake; fila.recorte_pct = +(100 * (stake / tope - 1)).toFixed(2);

  // los MISMOS frenos de cartera que tarjetas y CS2 (apagado maestro, ventana, parada diaria, exposición, casa, fondos)
  const f = RE.frenos(stake, fila.kickoff_at);
  if (f) return parar('freno:' + f.freno, { detalle: f.detalle, saldo: L.saldo && L.saldo.amount });

  const peticion = { currency: C.currency, eventId: String(fila.cb_event_id), marketUrl: sel.marketUrl, price: sel.price, stake, referenceId: fila.ref_id, acceptPriceChange: 'BETTER' };
  fila.peticion = peticion;
  if (C.dry) return parar('ensayo');

  fila.enviado_at = new Date().toISOString();
  const r = await CB.placeBet(process.env.CLOUDBET_API_KEY || '', peticion);
  fila.respuesta = r.body || r.raw || null; fila.http = r.status || null; fila.via = r.via || null;
  if (r.cortafuegos) {
    L.cortafuegos = { seguidos: ((L.cortafuegos && L.cortafuegos.seguidos) || 0) + 1, ultimo: new Date().toISOString(), desde: (L.cortafuegos && L.cortafuegos.desde) || new Date().toISOString() };
    return parar('cortafuegos_de_la_casa', { http: r.status });
  }
  if (L.cortafuegos && L.cortafuegos.seguidos) L.cortafuegos = { seguidos: 0, reabierto: new Date().toISOString() };
  const cuerpo = r.body || {};
  const est = String(r.betStatus || cuerpo.betStatus || '').toUpperCase();
  const cod = String(r.betError || cuerpo.betErrorCode || '').toUpperCase();
  fila.error_casa = cod || null;
  if (cod === 'DUPLICATE_REQUEST') { fila.status = 'EN_ACEPTACION'; fila.motivo = 'referencia_ya_usada'; fila.stake_comprometido = stake; RE.save(); return fila; }
  const rechazoExplicito = est === 'REJECTED' && !!(r.body || cuerpo.betStatus);
  if (!r.ok && !rechazoExplicito && Number(r.status) >= 200) {
    // la casa contestó sin veredicto legible: puede haber dinero puesto → se pregunta por la referencia, jamás se reenvía
    fila.status = 'EN_ACEPTACION'; fila.motivo = 'respuesta_no_reconocida'; fila.stake_comprometido = stake; fila.confirmaciones_sin_rastro = 0; RE.save(); return fila;
  }
  if (!r.ok || est === 'REJECTED') {
    if (['RESTRICTED', 'VERIFICATION_REQUIRED', 'MALFORMED_REQUEST'].includes(cod)) {
      fila.status = 'DESCARTADA'; fila.motivo = 'cuenta_o_peticion:' + cod.toLowerCase();
      L.rechazos_cuenta = { seguidos: ((L.rechazos_cuenta && L.rechazos_cuenta.seguidos) || 0) + 1, codigo: cod, ultimo: new Date().toISOString(), via: r.via || null };
      RE.save(); return fila;
    }
    if (L.rechazos_cuenta && L.rechazos_cuenta.seguidos) L.rechazos_cuenta = { seguidos: 0, limpiado: new Date().toISOString() };
    // la referencia solo se quema si la casa llegó a hablar (rechazo explícito con código HTTP)
    const hablo = Number(r.status) >= 200;
    if (hablo) { fila.envios = (fila.envios || 0) + 1; fila.ref_id = RE.refIdDe(fila.pick_id, fila.envios); }
    return parar(hablo ? 'rechazada_por_la_casa' : 'no_llego_a_la_casa', { http: r.status, error_casa: cod || null, via: r.via || null });
  }
  if (est === 'PENDING_ACCEPTANCE' || (!est && r.ok)) { fila.status = 'EN_ACEPTACION'; fila.motivo = est ? 'esperando_aceptacion' : 'respuesta_no_reconocida'; fila.stake_comprometido = stake; RE.save(); return fila; }

  fila.status = 'PLACED'; fila.motivo = null;
  if (L.rechazos_cuenta && L.rechazos_cuenta.seguidos) L.rechazos_cuenta = { seguidos: 0, limpiado: new Date().toISOString() };
  fila.odds_real = Number(cuerpo.price || (cuerpo.bet && cuerpo.bet.price) || sel.price) || sel.price;
  fila.referencia = fila.ref_id;
  fila.placed_at = new Date().toISOString();
  fila.slippage_pct = fila.odds_sombra > 0 ? +(100 * (fila.odds_real / fila.odds_sombra - 1)).toFixed(2) : null;
  const d = (L.dias[hoy()] = L.dias[hoy()] || { pnl: 0, apostado: 0, n: 0 }); d.apostado += stake; d.n += 1;
  if (L.saldo && typeof L.saldo.amount === 'number') { L.saldo.amount = +(L.saldo.amount - stake).toFixed(2); L.saldo.estimado = true; }
  RE.save();
  return fila;
}

// ── EL BARRIDO ──────────────────────────────────────────────────────────────────────────────────────────
// `picks`: las tesis ABIERTAS de la sombra de tenis de mesa (tt-engine/store.openPicks()), ya con el id de
// evento de Cloudbet. Se crean las filas nuevas, se reintentan las pendientes y se caducan las vencidas.
async function sweep({ picks = [], ahora = Date.now(), max = 20 } = {}) {
  const out = { canal: ttOn() ? 'encendido' : 'apagado', senales: 0, nuevas: 0, colocadas: 0, revisadas: 0, caducadas: 0, motivos: {} };
  if (!RE.CFG().enabled) { out.why = 'GP_REAL_ENABLED apagado'; return out; }
  const L = RE.load();
  for (const p of picks) {
    if (p.status !== 'OPEN' || p.family !== FAMILIA_SOMBRA || String(p.book || '').toLowerCase() !== CASA) continue;
    if (!p.start_at || Date.parse(p.start_at) <= ahora + 5 * 60e3) continue;
    if (p.benchmark) continue;
    out.senales++;
    if (!p.cb_event_id) { out.motivos.sin_id_cloudbet = (out.motivos.sin_id_cloudbet || 0) + 1; continue; }
    if (crear(p)) out.nuevas++;
  }
  const cola = L.bets.filter((b) => b.familia === FAMILIA && b.status === 'PENDIENTE' && (!b.kickoff_at || Date.parse(b.kickoff_at) > ahora))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0)).slice(0, max);
  for (const fila of cola) {
    const r = await colocar(fila).catch((e) => { fila.motivo = 'error:' + e.message; RE.save(); return fila; });
    out.revisadas++;
    if (r && r.status === 'PLACED') out.colocadas++;
    if (r && r.motivo) out.motivos[r.motivo] = (out.motivos[r.motivo] || 0) + 1;
  }
  for (const b of L.bets) if (b.familia === FAMILIA && b.status === 'PENDIENTE' && b.kickoff_at && Date.parse(b.kickoff_at) <= ahora) { b.status = 'CADUCADA'; out.caducadas++; }
  if (out.caducadas) RE.save();
  out.pendientes = L.bets.filter((b) => b.familia === FAMILIA && b.status === 'PENDIENTE').length;
  out.colocadas_total = L.bets.filter((b) => b.familia === FAMILIA && CON_DINERO.has(b.status)).length;
  return out;
}

function resumen() {
  const L = RE.load();
  const mias = L.bets.filter((b) => b.familia === FAMILIA);
  const por = (s) => mias.filter((b) => b.status === s).length;
  const set = mias.filter((b) => b.status === 'SETTLED');
  return { canal: ttOn() ? 'encendido' : 'apagado', stake: STAKE(), segmento: SEGMENTO, mercado: MARKET_KEY,
    total: mias.length, pendientes: por('PENDIENTE'), placed: por('PLACED'), en_aceptacion: por('EN_ACEPTACION'), settled: set.length, descartadas: por('DESCARTADA'), caducadas: por('CADUCADA'),
    pnl: +set.reduce((s, b) => s + (b.pnl || 0), 0).toFixed(2), apostado: +mias.filter((b) => CON_DINERO.has(b.status)).reduce((s, b) => s + (b.stake || 0), 0).toFixed(2),
    ultimas: mias.slice(-12).reverse().map((b) => ({ match: b.match, side: b.side, line: b.line, odds_sombra: b.odds_sombra, odds_real: b.odds_real || null, stake: b.stake, status: b.status, motivo: b.motivo || null, kickoff_at: b.kickoff_at, ref: b.ref_id })) };
}

module.exports = { FAMILIA, SEGMENTO, MARKET_KEY, crear, colocar, sweep, resumen, ttOn, STAKE };
