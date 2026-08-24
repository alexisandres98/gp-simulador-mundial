// real-executor/store.js — EL EJECUTOR CON DINERO REAL (25-ago).
//
// QUÉ ES Y QUÉ NO ES
// Este módulo coloca apuestas de verdad en Cloudbet. Es el hermano gemelo del ejecutor en la sombra que
// lleva corriendo desde el 12-ago, con UNA sola diferencia: al final hay una llamada que mueve dinero.
// Todo lo demás —qué señal, qué precio, qué stake— sale del mismo sitio, a propósito. Si el papel y el
// dinero divergen, la divergencia es EL DATO que este primer mes existe para medir: cuánto se pierde entre
// el precio de papel y el fill real, cuántas se rechazan, cuál es el tope de la casa.
//
// LO QUE NO DECIDE. No elige partidos, no calcula probabilidades, no valora nada. Recibe una apuesta ya
// decidida por el sombra y responde una sola pregunta: ¿se puede colocar esto, ahora, con seguridad?
//
// EL PERÍMETRO, CERRADO POR CÓDIGO Y NO POR CONFIGURACIÓN
// Solo `cards_under_v1`. Solo familia CARDS. Solo lado under. Solo casa cloudbet. Solo fútbol. Esas cinco
// condiciones no son variables de entorno: están escritas abajo y hay que tocar el archivo para cambiarlas.
// Un ejecutor de dinero real cuyo alcance se pueda ampliar poniendo una variable en un panel es un
// accidente esperando a que alguien se equivoque de casilla.
//
// EL BANCO NOCIONAL vs LA CARTERA
// El stake se calcula sobre un banco NOCIONAL (por defecto $2.000) aunque la cartera de Cloudbet tenga
// menos. Es una decisión explícita de Alexis: quiere el tamaño de apuesta del sombra desde el primer día,
// fondeando poco a poco. La consecuencia hay que decirla en voz alta y este módulo la mide: cuando la
// cartera no alcanza, la apuesta NO se coloca y se anota como `sin_fondos` con el saldo que había. Al final
// del mes esa lista es la factura exacta de haber fondeado corto.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CB = require('../market-scanner/venues/cloudbet');

// ── dónde vive el libro mayor ────────────────────────────────────────────────────────────────────────────
// Al lado de db.json, en el disco persistente. Un libro mayor de dinero real que se borra en cada despliegue
// no es un libro mayor.
const DISK_DIR = path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json'));
const LEDGER = path.join(DISK_DIR, 'real-ledger.json');

// ── el perímetro, escrito en piedra ──────────────────────────────────────────────────────────────────────
const SEGMENTO = 'cards_under_v1';
const FAMILIA = 'CARDS';
const LADO = 'under';
const CASA = 'cloudbet';
const MARKET_KEY = 'soccer.total_bookings';

// ── los frenos ───────────────────────────────────────────────────────────────────────────────────────────
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const on = (k, d = false) => { const v = String(process.env[k] || '').trim().toLowerCase();
  return v ? ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(v) : d; };

const CFG = () => ({
  // interruptor maestro. APAGADO por defecto: encenderlo tiene que ser un acto deliberado, no el estado
  // en que quedó el repositorio.
  enabled: on('GP_REAL_ENABLED', false),
  // ensayo: hace TODO —resuelve el evento, relee el precio, calcula el stake, pasa los frenos— y en el
  // último paso, en vez de llamar a la casa, escribe la petición exacta que habría enviado.
  dry: on('GP_REAL_DRY', true),
  currency: String(process.env.GP_REAL_CURRENCY || 'USDT').toUpperCase(),
  nocional: num('GP_REAL_NOTIONAL', 2000),          // el banco sobre el que se calcula el stake
  stakePct: num('GP_REAL_STAKE_CAP_PCT', 1.5) / 100, // tope de Kelly/4
  stakeMin: num('GP_REAL_STAKE_MIN', 5),
  stakeMax: num('GP_REAL_MAX_STAKE', 45),            // tope duro en dólares, por si el banco se descuadra
  maxOpen: num('GP_REAL_MAX_OPEN', 400),             // exposición abierta simultánea
  minBalance: num('GP_REAL_MIN_BALANCE', 40),        // suelo de cartera: por debajo, no se apuesta
  dayStopPct: num('GP_REAL_DAY_STOP_PCT', 6) / 100,  // pérdida diaria que apaga hasta mañana
  avisoSaldo: num('GP_REAL_LOW_BALANCE', 150),       // por debajo de esto, avisar a Alexis
  minOddsSlipPct: num('GP_REAL_MAX_SLIP_PCT', 3) / 100, // cuánto peor que el precio del sombra se acepta
});

// ── el libro ─────────────────────────────────────────────────────────────────────────────────────────────
function blank() {
  return {
    version: 1,
    created_at: new Date().toISOString(),
    nocional_inicial: CFG().nocional,
    nocional: CFG().nocional,      // sube y baja con el P&L real: el stake compone solo
    realizado: 0,                  // P&L acumulado en la moneda de la cuenta
    bets: [],                      // cada intento, colocado o no
    dias: {},                      // 'YYYY-MM-DD' → { pnl, apostado, n }
    saldo: { amount: null, at: null },
    avisos: {},                    // dedup de avisos (saldo bajo, parada diaria)
  };
}
let _L = null;
function load() {
  if (_L) return _L;
  try { _L = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { _L = blank(); }
  if (!_L || !Array.isArray(_L.bets)) _L = blank();
  _L.dias = _L.dias || {}; _L.avisos = _L.avisos || {}; _L.saldo = _L.saldo || { amount: null, at: null };
  return _L;
}
function save() {
  try { fs.writeFileSync(LEDGER, JSON.stringify(load())); return true; }
  catch (e) { console.error('[real] no se pudo guardar el libro:', e.message); return false; }
}

const hoy = () => new Date().toISOString().slice(0, 10);
const dia = (d) => { const L = load(); L.dias[d] = L.dias[d] || { pnl: 0, apostado: 0, n: 0 }; return L.dias[d]; };

// referencia IDEMPOTENTE derivada del id de la pick. La casa rechaza referencias repetidas, así que esto
// convierte "no colocar dos veces la misma apuesta" en algo que no depende de que nuestro código sea
// correcto: aunque el barrido se ejecute dos veces, la segunda la rechaza la casa.
function refIdDe(pickId) {
  const h = crypto.createHash('sha256').update('gp-real:' + String(pickId)).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join('-');
}

// Kelly/4 con tope, sobre el banco nocional VIVO. Es la misma fórmula del sombra a propósito: si aquí se
// calculara distinto, la comparación entre papel y dinero dejaría de medir la ejecución y pasaría a medir
// la diferencia entre dos fórmulas.
function kellyDe(prob, odds) {
  return (prob > 0 && odds > 1) ? Math.max(0, (prob * odds - 1) / (odds - 1)) / 4 : 0;
}
function stakeDe(prob, odds) {
  const C = CFG(), L = load();
  const banco = L.nocional > 0 ? L.nocional : C.nocional;
  const f = kellyDe(prob, odds);
  // `f || C.stakePct` es la fórmula EXACTA del sombra, y se conserva a propósito aunque tenga una arista:
  // con f = 0 cae al tope en vez de a cero. Cambiarla aquí rompería la única cosa que este ejecutor existe
  // para medir —la diferencia entre papel y dinero sería la diferencia entre dos fórmulas—. La arista se
  // tapa donde corresponde: una apuesta con Kelly no positiva no se coloca (ver `sin_ventaja` en intentar).
  const st = Math.min(C.stakePct, f || C.stakePct) * banco;
  return Math.min(C.stakeMax, Math.max(C.stakeMin, Math.round(st * 100) / 100));
}

const abiertas = () => load().bets.filter((b) => b.status === 'PLACED');
const expuesto = () => +abiertas().reduce((a, b) => a + (b.stake || 0), 0).toFixed(2);

// ── los frenos, en orden de gravedad ─────────────────────────────────────────────────────────────────────
// Devuelve null si se puede apostar, o el motivo por el que no. El orden importa: primero lo que apaga todo,
// después lo que solo bloquea esta apuesta.
function frenos(stake) {
  const C = CFG(), L = load();
  if (!C.enabled) return { freno: 'apagado', detalle: 'GP_REAL_ENABLED no está encendido' };
  if (!process.env.CLOUDBET_API_KEY) return { freno: 'sin_api_key' };
  const d = dia(hoy());
  const tope = C.dayStopPct * (L.nocional || C.nocional);
  if (d.pnl <= -tope) return { freno: 'parada_diaria', detalle: `${d.pnl.toFixed(2)} en el día, tope ${(-tope).toFixed(2)}` };
  const exp = expuesto();
  if (exp + stake > C.maxOpen) return { freno: 'exposicion_maxima', detalle: `${exp.toFixed(2)} abiertas + ${stake} > ${C.maxOpen}` };
  const s = L.saldo && typeof L.saldo.amount === 'number' ? L.saldo.amount : null;
  // saldo NULL no frena: "no lo sé" no es "está vacía", y la casa rechaza por fondos con autoridad que
  // nosotros no tenemos. Saldo conocido y corto sí frena, y se anota con la cifra para poder facturarlo.
  if (s != null && s - stake < C.minBalance) return { freno: 'sin_fondos', detalle: `saldo ${s.toFixed(2)}, apuesta ${stake}, suelo ${C.minBalance}` };
  return null;
}

// ── refrescar el saldo ───────────────────────────────────────────────────────────────────────────────────
async function refrescarSaldo() {
  const C = CFG();
  const a = await CB.balance(process.env.CLOUDBET_API_KEY || '', C.currency).catch(() => null);
  const L = load();
  L.saldo = { amount: a, at: new Date().toISOString(), currency: C.currency };
  save();
  return a;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// COLOCAR UNA APUESTA
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// `sb` es la apuesta que el ejecutor en la sombra acaba de anotar; `pick` es la pick del motor. De ahí sale
// TODO menos el precio: el precio se relee de la casa en este mismo instante, porque el del barrido puede
// tener veinte minutos y en veinte minutos una línea de tarjetas de segunda división desaparece.
async function intentar(sb, pick, { cbIdx = {} } = {}) {
  const C = CFG();
  const L = load();

  // 0) el perímetro. Cinco condiciones, y ninguna es configurable.
  if (!sb || sb.segment !== SEGMENTO) return null;
  if (String(sb.family || '').toUpperCase() !== FAMILIA) return null;
  if (String(sb.side || '').toLowerCase() !== LADO) return null;
  if (String(sb.book || '').toLowerCase() !== CASA) return null;
  if (!(sb.line > 0)) return null;

  const refId = refIdDe(sb.pick_id);
  if (L.bets.some((b) => b.ref_id === refId)) return null;   // ya intentada: no se repite jamás

  const fila = {
    ref_id: refId, pick_id: sb.pick_id, shadow_id: sb.id || null,
    match: sb.match, league: sb.league, line: sb.line, side: LADO,
    kickoff_at: sb.kickoff_at || null,
    odds_sombra: sb.odds, model_prob: sb.model_prob,
    at: new Date().toISOString(),
    status: 'RECHAZADA', dry: C.dry,
  };
  const sellar = (motivo, extra) => { Object.assign(fila, { motivo, ...(extra || {}) }); L.bets.push(fila); save(); return fila; };

  // 1) el stake, antes que nada: los frenos se juzgan contra la cifra real.
  //    Y antes del stake, la ventaja: si el modelo no le da valor a este precio, no hay nada que apostar.
  //    En el sombra da igual porque el motor solo publica picks con valor; con dinero real un cero de
  //    ventaja no puede acabar en el tope de stake por un descuido aritmético.
  if (kellyDe(sb.model_prob, sb.odds) <= 0) return sellar('sin_ventaja', { prob: sb.model_prob, odds: sb.odds });
  const stake = stakeDe(sb.model_prob, sb.odds);
  fila.stake = stake;

  const f = frenos(stake);
  if (f) return sellar(f.freno, { detalle: f.detalle, saldo: L.saldo && L.saldo.amount });

  // 2) el id del partido en la casa
  const ceid = (pick && pick.event && pick.event.canonical_event_id) || null;
  const idx = ceid ? (cbIdx || {})[ceid] : null;
  if (!idx || !idx.cb_id) return sellar('sin_id_de_evento', { ceid });
  fila.cb_event_id = idx.cb_id;

  // 3) el precio VIVO y sus coordenadas de colocación
  const ev = await CB.eventRaw(process.env.CLOUDBET_API_KEY || '', idx.cb_id).catch(() => null);
  if (!ev) return sellar('evento_ilegible');
  const sel = CB.selectionFor(ev, MARKET_KEY, sb.line, LADO);
  if (!sel) return sellar('linea_no_cotizada', { linea: sb.line });
  fila.precio_vivo = sel.price; fila.market_url = sel.marketUrl;
  fila.max_stake = sel.maxStake; fila.min_stake = sel.minStake; fila.estado_seleccion = sel.status;

  if (sel.status && /DISABLED|SUSPENDED|CLOSED/i.test(sel.status)) return sellar('seleccion_cerrada', { estado: sel.status });
  if (!(sel.price > 1)) return sellar('sin_precio');
  if (!sel.marketUrl) return sellar('sin_market_url');

  // 4) el deslizamiento. Si la casa empeoró el precio más de lo tolerado, no se apuesta: la ventaja de esta
  //    familia es de un dígito, y un 3 % de precio se la come entera.
  const minAceptable = sb.odds * (1 - C.minOddsSlipPct);
  if (sel.price < minAceptable) return sellar('precio_peor', { pedido: sb.odds, ofrecido: sel.price, minimo: +minAceptable.toFixed(3) });

  // 5) la profundidad de la casa. Si acepta menos de lo que queremos, se apuesta lo que acepta y se anota el
  //    recorte — que es exactamente el dato de capacidad que este mes existe para medir. Si ni siquiera
  //    llega al mínimo nuestro, no se apuesta: una apuesta de $2 no mide nada y ensucia el registro.
  let stakeFinal = stake;
  if (sel.maxStake != null && sel.maxStake < stakeFinal) stakeFinal = Math.floor(sel.maxStake * 100) / 100;
  if (sel.minStake != null && stakeFinal < sel.minStake) return sellar('minimo_de_la_casa', { minimo: sel.minStake, queriamos: stake });
  if (stakeFinal < C.stakeMin) return sellar('tope_de_la_casa_muy_bajo', { max_casa: sel.maxStake, queriamos: stake });
  fila.stake = stakeFinal;
  fila.recorte_pct = stake > 0 ? +(100 * (stakeFinal / stake - 1)).toFixed(2) : 0;

  const peticion = { currency: C.currency, eventId: idx.cb_id, marketUrl: sel.marketUrl,
    price: sel.price, stake: stakeFinal, referenceId: refId, acceptPriceChange: 'BETTER' };

  // 6) ENSAYO: todo lo de arriba se ha ejecutado de verdad; lo único que no ocurre es el movimiento de dinero
  if (C.dry) { fila.status = 'ENSAYO'; return sellar('ensayo', { peticion }); }

  // 7) el momento
  const r = await CB.placeBet(process.env.CLOUDBET_API_KEY || '', peticion);
  fila.respuesta = r.body || r.raw || null;
  fila.http = r.status || null;
  if (!r.ok) return sellar('rechazada_por_la_casa', { peticion });

  fila.status = 'PLACED';
  fila.motivo = null;
  fila.odds_real = Number((r.body && (r.body.price || (r.body.bet && r.body.bet.price))) || sel.price) || sel.price;
  fila.placed_at = new Date().toISOString();
  fila.slippage_pct = sb.odds > 0 ? +(100 * (fila.odds_real / sb.odds - 1)).toFixed(2) : null;
  const d = dia(hoy()); d.apostado += stakeFinal; d.n += 1;
  L.bets.push(fila); save();
  return fila;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// LIQUIDAR
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Contra la casa, no contra nosotros. Nuestro liquidador sirve para medir el modelo; el dinero lo dice
// Cloudbet, y cuando los dos no coinciden manda la casa y la discrepancia se anota para mirarla.
async function liquidar() {
  const C = CFG();
  if (!process.env.CLOUDBET_API_KEY) return { settled: 0, why: 'sin_api_key' };
  const L = load();
  const pend = L.bets.filter((b) => b.status === 'PLACED');
  let settled = 0;
  for (const b of pend) {
    const st = await CB.betByReference(process.env.CLOUDBET_API_KEY, b.ref_id).catch(() => null);
    if (!st) continue;
    const raw = st.bet || st;
    const estado = String(raw.status || raw.state || '').toUpperCase();
    if (!/WON|LOST|VOID|CANCEL|PUSH|REFUND|SETTLED/.test(estado)) continue;
    const ret = Number(raw.returnAmount != null ? raw.returnAmount : raw.payout);
    const stake = Number(b.stake) || 0;
    let pnl;
    if (/VOID|CANCEL|REFUND|PUSH/.test(estado)) pnl = 0;
    else if (Number.isFinite(ret)) pnl = +(ret - stake).toFixed(2);
    else pnl = /WON/.test(estado) ? +(stake * ((b.odds_real || b.odds_sombra) - 1)).toFixed(2) : -stake;
    b.status = 'SETTLED';
    b.resultado = /WON/.test(estado) ? 'WIN' : /LOST/.test(estado) ? 'LOSS' : 'VOID';
    b.pnl = pnl; b.settled_at = new Date().toISOString(); b.casa_estado = estado;
    L.realizado = +((L.realizado || 0) + pnl).toFixed(2);
    L.nocional = +((L.nocional || C.nocional) + pnl).toFixed(2);
    const d = dia(String(b.settled_at).slice(0, 10)); d.pnl = +(d.pnl + pnl).toFixed(2);
    settled++;
  }
  if (settled) save();
  await refrescarSaldo().catch(() => null);
  return { settled, abiertas: abiertas().length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// EL TABLERO
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
function board({ limit = 40 } = {}) {
  const C = CFG(), L = load();
  const colocadas = L.bets.filter((b) => b.status === 'PLACED' || b.status === 'SETTLED');
  const liq = L.bets.filter((b) => b.status === 'SETTLED');
  const w = liq.filter((b) => b.resultado === 'WIN').length;
  const l = liq.filter((b) => b.resultado === 'LOSS').length;
  const staked = liq.reduce((a, b) => a + (b.stake || 0), 0);
  const pnl = liq.reduce((a, b) => a + (b.pnl || 0), 0);
  const slip = colocadas.map((b) => b.slippage_pct).filter((x) => typeof x === 'number');
  const porMotivo = {};
  for (const b of L.bets) if (b.motivo) porMotivo[b.motivo] = (porMotivo[b.motivo] || 0) + 1;
  return {
    config: {
      encendido: C.enabled, ensayo: C.dry, moneda: C.currency,
      perimetro: { segmento: SEGMENTO, familia: FAMILIA, lado: LADO, casa: CASA },
      nocional_inicial: L.nocional_inicial, nocional_vivo: L.nocional,
      stake_tope_pct: +(C.stakePct * 100).toFixed(2), stake_max: C.stakeMax, stake_min: C.stakeMin,
      exposicion_max: C.maxOpen, suelo_saldo: C.minBalance,
      parada_diaria_pct: +(C.dayStopPct * 100).toFixed(1), deslizamiento_max_pct: +(C.minOddsSlipPct * 100).toFixed(1),
    },
    saldo: L.saldo,
    exposicion_abierta: expuesto(),
    intentos: L.bets.length, colocadas: colocadas.length, abiertas: abiertas().length,
    liquidadas: liq.length, w, l,
    apostado: +staked.toFixed(2), pnl: +pnl.toFixed(2),
    roi_pct: staked ? +(100 * pnl / staked).toFixed(2) : null,
    // EL NÚMERO DEL PRIMER MES: cuánto se pierde entre el precio de papel y el precio real. Si esto es cero
    // el sombra era una buena maqueta; si es −2 %, la ventaja medida en papel era medio punto más pequeña.
    deslizamiento_medio_pct: slip.length ? +(slip.reduce((a, x) => a + x, 0) / slip.length).toFixed(3) : null,
    deslizamiento_n: slip.length,
    recorte_por_tope_n: colocadas.filter((b) => (b.recorte_pct || 0) < 0).length,
    por_motivo: porMotivo,
    dias: L.dias,
    ultimas: L.bets.slice(-limit).reverse(),
  };
}

module.exports = { intentar, liquidar, board, refrescarSaldo, stakeDe, kellyDe, refIdDe, load, save, CFG,
  SEGMENTO, FAMILIA, LADO, CASA, LEDGER };
