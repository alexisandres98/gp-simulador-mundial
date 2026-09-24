// real-executor/amfoot.js — COLLEGE AL DINERO REAL: TOTALES Y HÁNDICAPS EN CLOUDBET, $10 PLANOS (24-sep, orden de Alexis)
//
// "Abre college totales y spread en Cloudbet, con stake de 10 dólares en el ejecutor real; quiero ver cómo nos
// va este fin de semana." Es el tercer canal aparte del perímetro de tarjetas (`store.js`, en piedra) y el
// molde es el de tenis de mesa (`tt.js`): comparte con los demás TODO lo que protege el dinero —libro mayor,
// referencia idempotente, frenos de cartera, puerta cerrada de la casa, confirmación de lo que queda en el
// aire y liquidación por referencia contra el estado de la casa— y lo único propio es de dónde sale la señal
// y cómo se localiza la selección.
//
// LA SEÑAL es la tesis ABIERTA de la sombra de college (`amfoot-engine/store.js`, `ncaaf-picks.json`): familia
// TOTAL (over/under) o SPREAD (home/away) con la línea del consenso. Lo medido antes de abrir (24-sep, 748
// filas): a precio de Cloudbet en la MISMA línea, TOTAL 86 · +16,7 % · t 1,72 y SPREAD 99 · +19,0 % · t 2,07;
// la ganancia del total vive en el tramo de ventaja ≥ 10 pp (+28 % en 42) y el hándicap tiene un solo sábado
// bueno. El CLV contra el propio cierre de Cloudbet es plano (−1,5 % / +0,6 %): si esto gana, gana por precio
// y momento, no porque el mercado nos dé la razón. Alexis lo sabe y ordenó abrir para verlo con dinero.
//
// LA SELECCIÓN se localiza en el evento crudo de Cloudbet: `american_football.totals` (outcome over/under,
// params `total=<línea>`) y `american_football.handicap` (outcome home/away, params `handicap=<hándicap del
// LOCAL>`, el mismo en las dos selecciones). Nuestra línea de hándicap va en la convención de The Odds API
// (puntos que DA el local), así que `handicap = −línea`. Comprobado contra el evento 36420354 (Coastal
// Carolina v Liberty, 24-sep) y fijado en `tests/real-amfoot.test.js` con ese mismo evento como fixture. Solo
// el partido entero (submercado `period=ot&period=ft`): las mitades y los cuartos son otro mercado y otra
// apuesta. La línea tiene que ser EXACTA: apostar 48 cuando la tesis decía 50 no es un redondeo.
//
// UNA POSICIÓN POR PARTIDO Y FAMILIA. Dos totales del mismo partido se liquidan con el mismo marcador; la
// primera que llega se queda con el partido, la segunda se para con `posicion_ya_apostada`.
'use strict';

const RE = require('./store');
const CB = require('../market-scanner/venues/cloudbet');
const CBAF = require('../data-providers/amfoot/cloudbet');

const FAMILIA = 'AMFOOT';
const SEGMENTO = 'college_total_spread_v1';
const CASA = 'cloudbet';
const MARKET_KEY = { TOTAL: 'american_football.totals', SPREAD: 'american_football.handicap' };
const LADOS = { TOTAL: new Set(['over', 'under']), SPREAD: new Set(['home', 'away']) };

const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
const lista = (k, d) => String(process.env[k] == null || process.env[k] === '' ? d : process.env[k]).split(',').map((s) => s.trim()).filter(Boolean);
const amfootOn = () => !/^(0|false|no|off)$/i.test(String(process.env.GP_REAL_AMFOOT_ENABLED == null ? 'true' : process.env.GP_REAL_AMFOOT_ENABLED).trim());
const STAKE = () => num('GP_REAL_AMFOOT_STAKE', 10) || 10;
const EDGE_MIN = () => num('GP_REAL_AMFOOT_EDGE_MIN', 0);          // 0 = todas las tesis de la sombra; ≥10 = solo el tramo alto
const LIGAS = () => lista('GP_REAL_AMFOOT_LIGAS', 'ncaaf');
const FAMILIAS = () => lista('GP_REAL_AMFOOT_FAMILIAS', 'TOTAL,SPREAD').map((s) => s.toUpperCase()).filter((f) => MARKET_KEY[f]);
const REINTENTOS_MAX = 60;
const CON_DINERO = new Set(['PLACED', 'EN_ACEPTACION', 'SETTLED']);
const hoy = () => new Date().toISOString().slice(0, 10);

// ── LA SELECCIÓN EN EL EVENTO CRUDO ─────────────────────────────────────────────────────────────────────
const esPartidoEntero = (subKey) => !/period=(1h|2h|q[1-4])\b/i.test(String(subKey || ''));
function paramDe(params, k) {
  const m = String(params || '').match(new RegExp('(?:^|&)' + k + '=(-?[\\d.]+)'));
  return m ? Number(m[1]) : null;
}
// familia TOTAL: `total=<línea>` y outcome over/under · familia SPREAD: `handicap=<−línea>` y outcome home/away
function selectionAmfoot(evRaw, { familia, side, line }) {
  const fam = String(familia || '').toUpperCase();
  const key = MARKET_KEY[fam];
  if (!key || !evRaw || !evRaw.markets) return null;
  const mkName = Object.keys(evRaw.markets).find((k) => k === key || new RegExp('^' + key.replace('.', '\\.') + '\\.v\\d+$').test(k));
  const m = mkName ? evRaw.markets[mkName] : null;
  if (!m || !m.submarkets) return null;
  const objetivo = fam === 'TOTAL' ? Number(line) : -Number(line);
  const param = fam === 'TOTAL' ? 'total' : 'handicap';
  for (const [sk, sm] of Object.entries(m.submarkets)) {
    if (!esPartidoEntero(sk)) continue;
    for (const s of ((sm && sm.selections) || [])) {
      if (String(s.outcome || '').toLowerCase() !== String(side || '').toLowerCase()) continue;
      const l = paramDe(s.params, param);
      if (l == null || Math.abs(l - objetivo) > 1e-9) continue;
      return { marketUrl: s.marketUrl || null, price: Number(s.price) || 0,
        minStake: Number(s.minStake) > 0 ? Number(s.minStake) : null, maxStake: Number(s.maxStake) > 0 ? Number(s.maxStake) : null,
        status: s.status || null, submercado: sk, market_key: mkName };
    }
  }
  return null;
}

// ── EL EVENTO DE CLOUDBET DE CADA PICK ──────────────────────────────────────────────────────────────────
// La pick nace con los nombres de The Odds API; Cloudbet escribe los suyos. Los dos pasan por el resolutor
// de la liga (el mismo que funde Cloudbet con The Odds API en la sombra) y si resuelven al mismo equipo y el
// saque está a menos de 12 h, es el mismo partido. Índice cacheado 10 min: una llamada por pasada como mucho.
const _idx = {};
async function indiceEventos(lg) {
  const c = _idx[lg];
  if (c && Date.now() - c.at < 10 * 60e3) return c.evs;
  let evs = [];
  try { evs = await CBAF.events(lg, { days: 8 }); } catch { evs = []; }
  _idx[lg] = { at: Date.now(), evs };
  return evs;
}
function eventoDe(evs, pick, resolver) {
  const R = (n) => { try { return resolver(n) || null; } catch { return null; } };
  const nrm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const h = R(pick.home_full || pick.home), a = R(pick.away_full || pick.away);
  const ko = Date.parse(pick.kickoff || 0);
  for (const e of evs || []) {
    const cerca = !Number.isFinite(ko) || !e.cutoff || Math.abs(Date.parse(e.cutoff) - ko) < 12 * 3600e3;
    if (!cerca) continue;
    const eh = R(e.home), ea = R(e.away);
    if (h && a && eh && ea && eh === h && ea === a) return e;
    if (nrm(e.home) === nrm(pick.home_full || pick.home) && nrm(e.away) === nrm(pick.away_full || pick.away)) return e;
  }
  return null;
}

// ── LA FILA ─────────────────────────────────────────────────────────────────────────────────────────────
// La referencia de precio para el deslizamiento es la cuota de CLOUDBET al nacer la pick cuando la casa
// cotizaba la misma línea (es la columna que se midió); si no la tenía, la mejor del mercado, y la tolerancia
// del 3 % hace de filtro: un Cloudbet muy por debajo del mercado no se toma.
const ocupada = (L, fila) => RE.posicionOcupada(L, fila)
  || (L.bets || []).find((b) => b !== fila && b.familia === FAMILIA && CON_DINERO.has(b.status)
    && String(b.cb_event_id) === String(fila.cb_event_id) && b.familia_sombra === fila.familia_sombra) || null;

function crear(pick, cbEventId, lg) {
  const L = RE.load();
  if (L.bets.some((b) => b.pick_id === pick.key)) return null;
  const cbNace = pick.cb && pick.cb.misma_linea && pick.cb.price > 1 ? pick.cb.price : null;
  const fila = {
    ref_id: RE.refIdDe(pick.key, 0), envios: 0, pick_id: pick.key, shadow_id: pick.key,
    familia: FAMILIA, familia_sombra: String(pick.family).toUpperCase(), segment: SEGMENTO, canal: 'auto', deporte: 'amfoot',
    match: `${pick.home_full || pick.home} vs ${pick.away_full || pick.away}`, league: lg, week: pick.week || null,
    line: pick.line, side: String(pick.side || '').toLowerCase(), kickoff_at: pick.kickoff || null,
    cb_event_id: String(cbEventId), market_key: MARKET_KEY[String(pick.family).toUpperCase()],
    odds_sombra: cbNace || pick.odds, odds_mejor_mercado: pick.odds, casa_mejor: pick.book || null, odds_cloudbet_al_nacer: cbNace,
    model_prob: pick.p_model, edge_pp: pick.edge_pp, unc_pts: pick.unc_pts,
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
  if (!amfootOn()) return parar('canal_apagado', { detalle: 'GP_REAL_AMFOOT_ENABLED=false' });
  if (!fila.cb_event_id) return parar('sin_id_de_evento');
  const fam = String(fila.familia_sombra || '').toUpperCase();
  if (!MARKET_KEY[fam]) return parar('familia_rara', { familia_sombra: fila.familia_sombra }, true);
  if (!LADOS[fam].has(String(fila.side))) return parar('lado_raro', { side: fila.side }, true);
  if (!Number.isFinite(Number(fila.line))) return parar('linea_rara', { line: fila.line }, true);
  const oc = ocupada(L, fila);
  if (oc) return parar('posicion_ya_apostada', { detalle: `ya hay ${oc.status} a ${oc.familia_sombra || oc.side} ${oc.side} ${oc.line} en el evento ${fila.cb_event_id} (pick ${oc.pick_id}); esta pedía ${fam} ${fila.side} ${fila.line}` }, true);

  const ev = await CB.eventRaw(process.env.CLOUDBET_API_KEY || '', fila.cb_event_id).catch(() => null);
  if (!ev) return parar('evento_ilegible');
  if (ev.status && /RESULTED|CANCELLED|CLOSED|INTERRUPTED/i.test(String(ev.status))) return parar('evento_cerrado', { estado: ev.status }, true);
  const sel = selectionAmfoot(ev, { familia: fam, side: fila.side, line: fila.line });
  if (!sel) return parar('linea_no_cotizada', { mercados: Object.keys(ev.markets || {}).filter((k) => /american_football\.(totals|handicap)/.test(k)).slice(0, 6) });
  fila.precio_vivo = sel.price; fila.market_url = sel.marketUrl; fila.max_stake = sel.maxStake; fila.min_stake = sel.minStake; fila.estado_seleccion = sel.status;
  if (sel.status && /DISABLED|SUSPENDED|CLOSED/i.test(sel.status)) return parar('seleccion_cerrada', { estado: sel.status });
  if (!(sel.price > 1)) return parar('sin_precio');
  if (!sel.marketUrl) return parar('sin_market_url');
  const minAceptable = fila.odds_sombra * (1 - C.minOddsSlipPct);
  if (sel.price < minAceptable) return parar('precio_peor', { ofrecido: sel.price, minimo: +minAceptable.toFixed(3) });

  const tope = STAKE();
  let stake = Math.round(Math.min(tope, sel.maxStake != null ? sel.maxStake : tope) * 100) / 100;
  if (sel.minStake != null && stake < sel.minStake) return parar('minimo_de_la_casa', { minimo: sel.minStake });
  if (!(stake >= 1)) return parar('tope_de_la_casa_muy_bajo', { max_casa: sel.maxStake });
  fila.stake = stake; fila.recorte_pct = +(100 * (stake / tope - 1)).toFixed(2);

  const f = RE.frenos(stake, fila.kickoff_at, FAMILIA);
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
    fila.status = 'EN_ACEPTACION'; fila.motivo = 'respuesta_no_reconocida'; fila.stake_comprometido = stake; fila.confirmaciones_sin_rastro = 0; RE.save(); return fila;
  }
  if (!r.ok || est === 'REJECTED') {
    if (['RESTRICTED', 'VERIFICATION_REQUIRED', 'MALFORMED_REQUEST'].includes(cod)) {
      fila.status = 'DESCARTADA'; fila.motivo = 'cuenta_o_peticion:' + cod.toLowerCase();
      L.rechazos_cuenta = { seguidos: ((L.rechazos_cuenta && L.rechazos_cuenta.seguidos) || 0) + 1, codigo: cod, ultimo: new Date().toISOString(), via: r.via || null };
      RE.save(); return fila;
    }
    if (L.rechazos_cuenta && L.rechazos_cuenta.seguidos) L.rechazos_cuenta = { seguidos: 0, limpiado: new Date().toISOString() };
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
// `picksDe(lg)` devuelve las tesis de la sombra de esa liga y `resolver(lg)` el resolutor de nombres. Se crean
// las filas nuevas (con el evento de Cloudbet ya casado), se reintentan las pendientes y se caducan las vencidas.
async function sweep({ picksDe, resolver, ahora = Date.now(), max = 12 } = {}) {
  const out = { canal: amfootOn() ? 'encendido' : 'apagado', stake: STAKE(), ligas: LIGAS(), familias: FAMILIAS(), edge_min: EDGE_MIN(),
    senales: 0, nuevas: 0, colocadas: 0, revisadas: 0, caducadas: 0, sin_evento_cloudbet: 0, motivos: {} };
  if (!RE.CFG().enabled) { out.why = 'GP_REAL_ENABLED apagado'; return out; }
  const L = RE.load();
  for (const lg of LIGAS()) {
    let picks = [];
    try { picks = (typeof picksDe === 'function' ? picksDe(lg) : []) || []; } catch { picks = []; }
    const cand = picks.filter((p) => p.status === 'OPEN' && FAMILIAS().includes(String(p.family).toUpperCase())
      && p.kickoff && Date.parse(p.kickoff) > ahora + 5 * 60e3 && Date.parse(p.kickoff) < ahora + 8 * 864e5
      && (Number(p.edge_pp) || 0) >= EDGE_MIN());
    if (!cand.length) continue;
    const evs = await indiceEventos(lg);
    const res = typeof resolver === 'function' ? resolver(lg) : ((n) => n);
    for (const p of cand) {
      out.senales++;
      if (L.bets.some((b) => b.pick_id === p.key)) continue;
      const e = eventoDe(evs, p, res);
      if (!e) { out.sin_evento_cloudbet++; continue; }
      if (crear(p, e.id, lg)) out.nuevas++;
    }
  }
  const L2 = RE.load();
  const cola = L2.bets.filter((b) => b.familia === FAMILIA && b.status === 'PENDIENTE' && (!b.kickoff_at || Date.parse(b.kickoff_at) > ahora))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0)).slice(0, max);
  for (const fila of cola) {
    const r = await colocar(fila).catch((e) => { fila.motivo = 'error:' + e.message; RE.save(); return fila; });
    out.revisadas++;
    if (r && r.status === 'PLACED') out.colocadas++;
    if (r && r.motivo) out.motivos[r.motivo] = (out.motivos[r.motivo] || 0) + 1;
  }
  const L3 = RE.load();
  for (const b of L3.bets) if (b.familia === FAMILIA && b.status === 'PENDIENTE' && b.kickoff_at && Date.parse(b.kickoff_at) <= ahora) { b.status = 'CADUCADA'; out.caducadas++; }
  if (out.caducadas) RE.save();
  out.pendientes = L3.bets.filter((b) => b.familia === FAMILIA && b.status === 'PENDIENTE').length;
  out.colocadas_total = L3.bets.filter((b) => b.familia === FAMILIA && CON_DINERO.has(b.status)).length;
  return out;
}

function resumen() {
  const L = RE.load();
  const mias = L.bets.filter((b) => b.familia === FAMILIA);
  const por = (s) => mias.filter((b) => b.status === s).length;
  const set = mias.filter((b) => b.status === 'SETTLED');
  const porFam = {};
  for (const b of mias) {
    const k = b.familia_sombra || '?';
    const F = porFam[k] = porFam[k] || { total: 0, con_dinero: 0, settled: 0, w: 0, l: 0, pnl: 0, apostado: 0 };
    F.total++;
    if (CON_DINERO.has(b.status)) { F.con_dinero++; F.apostado = +(F.apostado + (b.stake || 0)).toFixed(2); }
    if (b.status === 'SETTLED') { F.settled++; if (b.resultado === 'WIN') F.w++; if (b.resultado === 'LOSS') F.l++; F.pnl = +(F.pnl + (b.pnl || 0)).toFixed(2); }
  }
  return { canal: amfootOn() ? 'encendido' : 'apagado', stake: STAKE(), edge_min: EDGE_MIN(), ligas: LIGAS(), familias: FAMILIAS(), segmento: SEGMENTO,
    total: mias.length, pendientes: por('PENDIENTE'), placed: por('PLACED'), en_aceptacion: por('EN_ACEPTACION'), settled: set.length, descartadas: por('DESCARTADA'), caducadas: por('CADUCADA'),
    pnl: +set.reduce((s, b) => s + (b.pnl || 0), 0).toFixed(2), apostado: +mias.filter((b) => CON_DINERO.has(b.status)).reduce((s, b) => s + (b.stake || 0), 0).toFixed(2),
    por_familia: porFam,
    ultimas: mias.slice(-16).reverse().map((b) => ({ match: b.match, familia: b.familia_sombra, side: b.side, line: b.line, odds_sombra: b.odds_sombra, odds_real: b.odds_real || null, precio_vivo: b.precio_vivo || null, stake: b.stake, status: b.status, motivo: b.motivo || null, kickoff_at: b.kickoff_at, ref: b.ref_id })) };
}

module.exports = { FAMILIA, SEGMENTO, MARKET_KEY, selectionAmfoot, eventoDe, crear, colocar, sweep, resumen, amfootOn, STAKE, EDGE_MIN };
