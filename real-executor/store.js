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
// EL SEGUNDO ARGUMENTO NO ES DECORACIÓN. La casa consume la referencia en cuanto recibe el envío, gane o
// pierda la petición: si RECHAZA una apuesta y quisiéramos reintentarla con la misma referencia, la
// rechazaría por duplicada para siempre. Así que la referencia va por (pick, número de ENVÍO), y el número
// de envío solo sube cuando de verdad se mandó algo y la casa contestó que NO la aceptó.
//
// La idempotencia se conserva donde importa: todo lo que falla ANTES de enviar (frenos, precio, id del
// partido) no gasta referencia, y un envío cuyo desenlace desconocemos —se cortó la red, expiró el
// tiempo— NO estrena referencia nueva: se pregunta por la vieja. Estrenar referencia sin saber qué pasó
// con la anterior es la única forma de colocar dos veces la misma apuesta, y es exactamente lo que este
// diseño impide.
function refIdDe(pickId, envio = 0) {
  const h = crypto.createHash('sha256').update('gp-real:' + String(pickId) + ':' + String(envio)).digest('hex');
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
// LO EN EL AIRE TAMBIÉN CUENTA COMO EXPUESTO. Una apuesta que la casa está evaluando puede tener el dinero
// ya retenido; dejarla fuera del cálculo haría que el tope de exposición permitiera comprometer más de lo
// que creemos. Ante la duda, el dinero se cuenta como comprometido, no como libre.
const enElAire = () => load().bets.filter((b) => b.status === 'EN_ACEPTACION');
const expuesto = () => +[...abiertas(), ...enElAire()]
  .reduce((a, b) => a + (b.stake || b.stake_comprometido || 0), 0).toFixed(2);

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
  // si la casa no contesta, se CONSERVA el saldo estimado en vez de ponerlo a null: pasar de "sé
  // aproximadamente cuánto queda" a "no lo sé" apagaría el freno de fondos justo cuando menos conviene.
  if (a == null && L.saldo && typeof L.saldo.amount === 'number') { L.saldo.stale_at = new Date().toISOString(); save(); return L.saldo.amount; }
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
// UN INTENTO FALLIDO NO ES UNA APUESTA PERDIDA (25-ago, corregido antes de mover un dólar).
// La primera versión sellaba la fila al primer fallo y no volvía a mirarla nunca. Parecía prudente y era un
// agujero: el sombra ofrece cada señal UNA sola vez —después la mete en su lista de vistas—, así que
// cualquier tropiezo pasajero (el reenviador reiniciándose tras un despliegue, la casa tardando, el saldo
// corto durante media hora, el id del partido aún sin resolver) borraba esa apuesta para siempre. Con
// despliegues varias veces al día, eso no es un caso raro: es el caso normal.
//
// Ahora la fila NACE en PENDIENTE y se reintenta en cada barrido hasta que se coloca o hasta que el partido
// empieza. Lo que cambia entre intentos es justo lo que hacía fallar: el saldo se recarga, el índice se
// llena, el reenviador vuelve, el precio se recupera. Lo único definitivo es que el modelo no le vea valor
// —eso no cambia— y que se acabe el tiempo.
const REINTENTOS_MAX = 80;                 // freno de bucle, no de política: 80 barridos son ~13 horas
const DEFINITIVOS = new Set(['sin_ventaja', 'fuera_de_perimetro']);

function filaNueva(sb, pick) {
  return {
    ref_id: refIdDe(sb.pick_id, 0), envios: 0, pick_id: sb.pick_id, shadow_id: sb.id || null,
    match: sb.match, league: sb.league, line: sb.line, side: LADO,
    kickoff_at: sb.kickoff_at || null,
    ceid: (pick && pick.event && pick.event.canonical_event_id) || null,
    odds_sombra: sb.odds, model_prob: sb.model_prob,
    at: new Date().toISOString(),
    status: 'PENDIENTE', intentos: 0,
  };
}

// EL INTENTO, sobre una fila que ya existe en el libro. Devuelve la fila.
async function colocar(fila, { cbIdx = {} } = {}) {
  const C = CFG(), L = load();
  fila.intentos = (fila.intentos || 0) + 1;
  fila.ultimo_intento_at = new Date().toISOString();
  fila.dry = C.dry;

  // se para porque no da tiempo, no porque el intento fallara: la distinción importa para el informe.
  const ko = fila.kickoff_at ? Date.parse(fila.kickoff_at) : null;
  if (ko && ko <= Date.now()) { fila.status = 'CADUCADA'; save(); return fila; }
  if (fila.intentos > REINTENTOS_MAX) { fila.status = 'CADUCADA'; fila.motivo = 'demasiados_intentos'; save(); return fila; }

  const parar = (motivo, extra) => {
    Object.assign(fila, { motivo, ...(extra || {}) });
    fila.status = DEFINITIVOS.has(motivo) ? 'DESCARTADA' : 'PENDIENTE';
    save(); return fila;
  };

  // 1) la ventaja y el stake. Si el modelo no le da valor a este precio no hay nada que apostar, y eso no
  //    va a cambiar en el próximo barrido: es lo único que se descarta de verdad.
  if (kellyDe(fila.model_prob, fila.odds_sombra) <= 0) return parar('sin_ventaja', { prob: fila.model_prob });
  const stake = stakeDe(fila.model_prob, fila.odds_sombra);
  fila.stake = stake;

  const f = frenos(stake);
  if (f) return parar(f.freno, { detalle: f.detalle, saldo: L.saldo && L.saldo.amount });

  // 2) el id del partido en la casa
  const idx = fila.ceid ? (cbIdx || {})[fila.ceid] : null;
  if (!idx || !idx.cb_id) return parar('sin_id_de_evento');
  fila.cb_event_id = idx.cb_id;

  // 3) el precio VIVO y sus coordenadas de colocación
  const ev = await CB.eventRaw(process.env.CLOUDBET_API_KEY || '', idx.cb_id).catch(() => null);
  if (!ev) return parar('evento_ilegible');
  const sel = CB.selectionFor(ev, MARKET_KEY, fila.line, LADO);
  if (!sel) return parar('linea_no_cotizada');
  fila.precio_vivo = sel.price; fila.market_url = sel.marketUrl;
  fila.max_stake = sel.maxStake; fila.min_stake = sel.minStake; fila.estado_seleccion = sel.status;

  if (sel.status && /DISABLED|SUSPENDED|CLOSED/i.test(sel.status)) return parar('seleccion_cerrada', { estado: sel.status });
  if (!(sel.price > 1)) return parar('sin_precio');
  if (!sel.marketUrl) return parar('sin_market_url');

  // 4) el deslizamiento. Si la casa empeoró el precio más de lo tolerado no se apuesta AHORA — pero se
  //    vuelve a mirar: los precios se mueven en las dos direcciones y aquí no hay prisa.
  const minAceptable = fila.odds_sombra * (1 - C.minOddsSlipPct);
  if (sel.price < minAceptable) return parar('precio_peor', { ofrecido: sel.price, minimo: +minAceptable.toFixed(3) });

  // 5) la profundidad de la casa. Si acepta menos de lo que queremos, se apuesta lo que acepta y se anota el
  //    recorte — que es exactamente el dato de capacidad que este mes existe para medir. Si ni siquiera
  //    llega al mínimo nuestro, no se apuesta: una apuesta de $2 no mide nada y ensucia el registro.
  let stakeFinal = stake;
  if (sel.maxStake != null && sel.maxStake < stakeFinal) stakeFinal = Math.floor(sel.maxStake * 100) / 100;
  if (sel.minStake != null && stakeFinal < sel.minStake) return parar('minimo_de_la_casa', { minimo: sel.minStake });
  if (stakeFinal < C.stakeMin) return parar('tope_de_la_casa_muy_bajo', { max_casa: sel.maxStake });
  fila.stake = stakeFinal;
  fila.recorte_pct = stake > 0 ? +(100 * (stakeFinal / stake - 1)).toFixed(2) : 0;

  const peticion = { currency: C.currency, eventId: idx.cb_id, marketUrl: sel.marketUrl,
    price: sel.price, stake: stakeFinal, referenceId: fila.ref_id, acceptPriceChange: 'BETTER' };
  fila.peticion = peticion;

  // 6) ENSAYO: todo lo de arriba se ha ejecutado de verdad; lo único que no ocurre es el movimiento de
  //    dinero. La fila se queda PENDIENTE para que, el día que se encienda el dinero real, se coloque de
  //    verdad en vez de quedarse como un ensayo eterno.
  if (C.dry) return parar('ensayo');

  // 7) el momento. A partir de aquí puede haber dinero comprometido, así que cada rama importa.
  fila.enviado_at = new Date().toISOString();
  const r = await CB.placeBet(process.env.CLOUDBET_API_KEY || '', peticion);
  fila.respuesta = r.body || r.raw || null;
  fila.http = r.status || null;
  fila.via = r.via || null;

  // UN 200 DE LA CASA NO SIGNIFICA APUESTA COLOCADA. La primera versión daba por buena cualquier respuesta
  // con HTTP correcto, y la casa devuelve 200 con `status: REJECTED` cuando NO la acepta. Eso habría
  // anotado en el libro apuestas que no existen: el banco compondría con dinero imaginario y el informe
  // presumiría de un volumen que nunca se jugó. Hay tres desenlaces y cada uno lleva a un sitio distinto.
  const cuerpo = r.body || {};
  const est = String(cuerpo.status || (cuerpo.bet && cuerpo.bet.status) || '').toUpperCase();

  if (!r.ok || est === 'REJECTED') {
    // rechazo explícito: la referencia queda quemada, así que el próximo intento estrena una.
    fila.envios = (fila.envios || 0) + 1;
    fila.ref_id = refIdDe(fila.pick_id, fila.envios);
    return parar('rechazada_por_la_casa', { http: r.status, error_casa: cuerpo.error || null });
  }

  if (est === 'PENDING_ACCEPTANCE' || (!est && r.ok)) {
    // la casa la está evaluando, o contestó algo que no sabemos leer. En los dos casos PUEDE haber dinero
    // comprometido, así que NO se reenvía nunca: se pregunta por esta misma referencia hasta saberlo.
    fila.status = 'EN_ACEPTACION';
    fila.motivo = est ? 'esperando_aceptacion' : 'respuesta_no_reconocida';
    fila.stake_comprometido = stakeFinal;
    save();
    return fila;
  }

  fila.status = 'PLACED';
  fila.motivo = null;
  fila.odds_real = Number(cuerpo.price || (cuerpo.bet && cuerpo.bet.price) || sel.price) || sel.price;
  fila.placed_at = new Date().toISOString();
  fila.slippage_pct = fila.odds_sombra > 0 ? +(100 * (fila.odds_real / fila.odds_sombra - 1)).toFixed(2) : null;
  const d = dia(hoy()); d.apostado += stakeFinal; d.n += 1;
  // EL SALDO BAJA AQUÍ, sin esperar a preguntarle a la casa. Un barrido puede colocar seis apuestas
  // seguidas —180 dólares— y el suelo de cartera se estaba juzgando contra el saldo de la pasada anterior:
  // las seis pasaban el freno mirando un dinero que ya no estaba. Se descuenta en el momento y la próxima
  // consulta real lo corrige; equivocarse por abajo es la dirección segura.
  if (L.saldo && typeof L.saldo.amount === 'number') {
    L.saldo.amount = +(L.saldo.amount - stakeFinal).toFixed(2);
    L.saldo.estimado = true;
  }
  save();
  return fila;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// CONFIRMAR LO QUE QUEDÓ EN EL AIRE
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Todo envío cuyo desenlace no supimos —la casa dijo "la estoy evaluando", o se cortó la red a mitad—
// termina aquí, y NUNCA en un reenvío. Se pregunta por la referencia: si la aceptó, es una apuesta puesta;
// si la rechazó, se libera para reintentar con referencia nueva; si sigue evaluándola, se espera.
// Sin este paso, la única salida honesta sería no reintentar nada, y la única salida cómoda sería
// reenviar a ciegas y arriesgarse a apostar dos veces lo mismo.
async function confirmar() {
  const L = load();
  const enAire = L.bets.filter((b) => b.status === 'EN_ACEPTACION');
  let aceptadas = 0, rechazadas = 0, siguen = 0;
  for (const fila of enAire) {
    const st = await CB.betByReference(process.env.CLOUDBET_API_KEY || '', fila.ref_id).catch(() => null);
    if (!st) { siguen++; continue; }
    const raw = st.bet || st;
    const est = String(raw.status || '').toUpperCase();
    if (est === 'ACCEPTED') {
      fila.status = 'PLACED'; fila.motivo = null;
      fila.odds_real = Number(raw.price) || fila.precio_vivo || fila.odds_sombra;
      fila.stake = Number(raw.stake) || fila.stake;
      fila.placed_at = fila.placed_at || new Date().toISOString();
      fila.slippage_pct = fila.odds_sombra > 0 ? +(100 * (fila.odds_real / fila.odds_sombra - 1)).toFixed(2) : null;
      const d = dia(String(fila.placed_at).slice(0, 10)); d.apostado += fila.stake; d.n += 1;
      aceptadas++;
    } else if (est === 'REJECTED') {
      fila.envios = (fila.envios || 0) + 1;
      fila.ref_id = refIdDe(fila.pick_id, fila.envios);
      fila.status = 'PENDIENTE'; fila.motivo = 'rechazada_por_la_casa';
      fila.error_casa = raw.error || null;
      rechazadas++;
    } else siguen++;
  }
  if (aceptadas || rechazadas) save();
  return { en_aire: enAire.length, aceptadas, rechazadas, siguen };
}

// LA PUERTA DE ENTRADA: una señal nueva del sombra. Crea la fila y hace el primer intento.
async function intentar(sb, pick, { cbIdx = {} } = {}) {
  const L = load();

  // 0) el perímetro. Cinco condiciones, y ninguna es configurable.
  if (!sb || sb.segment !== SEGMENTO) return null;
  if (String(sb.family || '').toUpperCase() !== FAMILIA) return null;
  if (String(sb.side || '').toLowerCase() !== LADO) return null;
  if (String(sb.book || '').toLowerCase() !== CASA) return null;
  if (!(sb.line > 0)) return null;

  // se busca por PICK, no por referencia: la referencia cambia cuando la casa rechaza un envío, así que
  // buscar por ella crearía una fila nueva para la misma apuesta y podría duplicarla.
  if (L.bets.some((b) => b.pick_id === sb.pick_id)) return null;   // ya está en el libro; de reintentarla
                                                                   // se encarga `reintentar`, no esta puerta
  const fila = filaNueva(sb, pick);
  L.bets.push(fila);
  return colocar(fila, { cbIdx });
}

// LOS REINTENTOS. Se llama una vez por barrido, después de la puerta de entrada. Recorre lo pendiente cuyo
// partido no ha empezado y lo vuelve a intentar. Es lo que convierte un fallo pasajero en un retraso en vez
// de en una apuesta perdida.
async function reintentar({ cbIdx = {}, max = 25 } = {}) {
  const L = load();
  const ahora = Date.now();
  const cola = L.bets.filter((b) => b.status === 'PENDIENTE'
    && (!b.kickoff_at || Date.parse(b.kickoff_at) > ahora))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0))
    .slice(0, max);
  let colocadas = 0;
  for (const fila of cola) {
    const r = await colocar(fila, { cbIdx }).catch(() => null);
    if (r && r.status === 'PLACED') colocadas++;
  }
  // y las que se quedaron sin tiempo: se cierran para que no se reintenten eternamente ni figuren como
  // pendientes en el informe. Una apuesta que no llegó a tiempo es un dato, no un limbo.
  let caducadas = 0;
  for (const b of L.bets) {
    if (b.status === 'PENDIENTE' && b.kickoff_at && Date.parse(b.kickoff_at) <= ahora) {
      b.status = 'CADUCADA'; caducadas++;
    }
  }
  if (caducadas) save();
  return { revisadas: cola.length, colocadas, caducadas, pendientes: L.bets.filter((b) => b.status === 'PENDIENTE').length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// PRE-VUELO: LA MISMA RESOLUCIÓN, SIN ESCRIBIR NADA
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Recorre los mismos pasos que `intentar` —id del partido en la casa, precio vivo, coordenadas, topes,
// deslizamiento— y no toca el libro mayor ni la cuenta. Existe porque la alternativa para saber si la cadena
// funciona es esperar a que nazca una señal y luego mirar el registro, y eso son horas. Con esto se
// comprueba en un segundo, sobre las apuestas que el sombra ya tiene abiertas, que cada eslabón resuelve.
async function preflight(pares, { cbIdx = {} } = {}) {
  const C = CFG();
  const out = [];
  for (const { sb, pick } of pares) {
    const f = { match: sb.match, league: sb.league, line: sb.line, odds_sombra: sb.odds };
    const ceid = (pick && pick.event && pick.event.canonical_event_id) || null;
    f.ceid = ceid;
    const idx = ceid ? (cbIdx || {})[ceid] : null;
    if (!idx || !idx.cb_id) { f.paso = 'sin_id_de_evento'; out.push(f); continue; }
    f.cb_event_id = idx.cb_id;
    const ev = await CB.eventRaw(process.env.CLOUDBET_API_KEY || '', idx.cb_id).catch(() => null);
    if (!ev) { f.paso = 'evento_ilegible'; out.push(f); continue; }
    f.partido_casa = `${(ev.home || {}).name} v ${(ev.away || {}).name}`;
    const sel = CB.selectionFor(ev, MARKET_KEY, sb.line, LADO);
    if (!sel) {
      f.paso = 'linea_no_cotizada';
      f.familias_del_evento = Object.keys(ev.markets || {}).slice(0, 12);
      out.push(f); continue;
    }
    f.paso = 'resuelta';
    f.precio_vivo = sel.price; f.market_url = sel.marketUrl;
    f.max_stake = sel.maxStake; f.min_stake = sel.minStake; f.estado = sel.status;
    f.stake_que_pondriamos = stakeDe(sb.model_prob, sb.odds);
    f.deslizamiento_pct = sb.odds > 0 ? +(100 * (sel.price / sb.odds - 1)).toFixed(2) : null;
    f.pasaria_el_deslizamiento = sel.price >= sb.odds * (1 - C.minOddsSlipPct);
    out.push(f);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// LIQUIDAR
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Contra la casa, no contra nosotros. Nuestro liquidador sirve para medir el modelo; el dinero lo dice
// Cloudbet, y cuando los dos no coinciden manda la casa y la discrepancia se anota para mirarla.
// EL RESULTADO NO PUEDE SALIR DE LA CASA, Y LA PRIMERA VERSIÓN LO INTENTABA (corregido el 25-ago contra la
// documentación oficial). Buscaba en el campo `status` valores como WON o LOST que no existen: la casa solo
// dice ACCEPTED / PENDING_ACCEPTANCE / REJECTED, que es si ACEPTÓ la apuesta, no si ganó. Una apuesta
// perdida y una todavía sin resolver son las dos ACCEPTED con `returnAmount: "0.0"`. De ahí no se puede
// deducir el resultado, y el código anterior simplemente no habría liquidado nunca nada — el banco no
// habría compuesto y la exposición abierta habría crecido hasta bloquear el ejecutor por su propio tope.
//
// El reparto correcto de autoridades es este:
//   · el RESULTADO lo pone NUESTRA liquidación, la misma que cierra la pick del sombra. Sabe cuándo acabó
//     el partido y con cuántas tarjetas.
//   · el DINERO lo pone la casa, con `returnAmount`. Es lo que de verdad entró en la cuenta.
//   · si los dos no cuadran, no se toca el banco y se marca `discrepancia`. Un descuadre entre lo que
//     creemos y lo que nos pagaron es justo el fallo que un ejecutor automático NO puede tapar solo.
//
// `resultados` es un mapa pick_id → { result_code, } que el llamador saca de sus propias picks liquidadas.
async function liquidar(resultados = {}) {
  const C = CFG();
  if (!process.env.CLOUDBET_API_KEY) return { settled: 0, why: 'sin_api_key' };
  const L = load();
  const pend = L.bets.filter((b) => b.status === 'PLACED');
  let settled = 0, esperando = 0, descuadres = 0;
  for (const b of pend) {
    const nuestro = String((resultados[b.pick_id] || {}).result_code || '').toUpperCase();
    if (!nuestro) { esperando++; continue; }              // el partido aún no se ha resuelto para nosotros

    const st = await CB.betByReference(process.env.CLOUDBET_API_KEY, b.ref_id).catch(() => null);
    const raw = (st && (st.bet || st)) || null;
    const ret = raw && raw.returnAmount != null ? Number(raw.returnAmount) : null;
    const stake = Number(b.stake) || 0;
    const cuota = b.odds_real || b.precio_vivo || b.odds_sombra || 0;

    if (nuestro === 'WIN') {
      // una ganada TIENE que traer dinero de vuelta. Si la casa aún no ha pagado, se espera: dar por
      // ganada una apuesta que nadie ha pagado es inventarse el saldo.
      if (!(ret > 0)) { b.espera_pago = (b.espera_pago || 0) + 1; esperando++; continue; }
      const esperado = +(stake * cuota).toFixed(2);
      if (Math.abs(ret - esperado) > Math.max(0.05, esperado * 0.02)) {
        b.discrepancia = { esperado, pagado: ret }; descuadres++;
      }
      b.pnl = +(ret - stake).toFixed(2);
      b.resultado = 'WIN';
    } else if (nuestro === 'LOSS') {
      // una perdida no devuelve nada, y aquí `returnAmount: 0` es consistente con nuestra lectura. Si la
      // casa SÍ pagó algo, es que uno de los dos se equivocó de resultado: se anota y se cree a la casa.
      if (ret > 0) {
        b.discrepancia = { esperado: 0, pagado: ret }; descuadres++;
        b.pnl = +(ret - stake).toFixed(2); b.resultado = 'WIN';
      } else { b.pnl = -stake; b.resultado = 'LOSS'; }
    } else if (/VOID|PUSH|CANCEL/.test(nuestro)) {
      // anulada: devuelve el stake. Si todavía no ha vuelto, se espera igual que con una ganada.
      if (!(ret > 0)) { b.espera_pago = (b.espera_pago || 0) + 1; esperando++; continue; }
      b.pnl = +(ret - stake).toFixed(2); b.resultado = 'VOID';
    } else { esperando++; continue; }                      // SUPERSEDED u otro código que no resuelve dinero

    b.status = 'SETTLED';
    b.settled_at = new Date().toISOString();
    b.pagado_por_la_casa = ret;
    b.resultado_nuestro = nuestro;
    L.realizado = +((L.realizado || 0) + b.pnl).toFixed(2);
    L.nocional = +((L.nocional || C.nocional) + b.pnl).toFixed(2);
    const d = dia(String(b.settled_at).slice(0, 10)); d.pnl = +(d.pnl + b.pnl).toFixed(2);
    settled++;
  }
  if (settled || descuadres) save();
  await refrescarSaldo().catch(() => null);
  return { settled, esperando, descuadres, abiertas: abiertas().length, en_el_aire: enElAire().length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// EL TABLERO
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
function board({ limit = 40 } = {}) {
  const C = CFG(), L = load();
  const colocadas = L.bets.filter((b) => b.status === 'PLACED' || b.status === 'SETTLED');
  const pendientes = L.bets.filter((b) => b.status === 'PENDIENTE');
  const caducadas = L.bets.filter((b) => b.status === 'CADUCADA');
  const liq = L.bets.filter((b) => b.status === 'SETTLED');
  const w = liq.filter((b) => b.resultado === 'WIN').length;
  const l = liq.filter((b) => b.resultado === 'LOSS').length;
  const staked = liq.reduce((a, b) => a + (b.stake || 0), 0);
  const pnl = liq.reduce((a, b) => a + (b.pnl || 0), 0);
  const slip = colocadas.map((b) => b.slippage_pct).filter((x) => typeof x === 'number');
  // el motivo de las PENDIENTES es "por qué todavía no", y el de las CADUCADAS es "por qué nunca". Contarlos
  // juntos mezcla un retraso con una pérdida, que es justo la confusión que este ejecutor tiene que evitar.
  const cuenta = (rows) => { const o = {}; for (const b of rows) if (b.motivo) o[b.motivo] = (o[b.motivo] || 0) + 1; return o; };
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
    senales: L.bets.length, colocadas: colocadas.length, abiertas: abiertas().length,
    en_el_aire: enElAire().length,
    descuadres: L.bets.filter((b) => b.discrepancia).length,
    pendientes: pendientes.length, caducadas: caducadas.length,
    descartadas: L.bets.filter((b) => b.status === 'DESCARTADA').length,
    liquidadas: liq.length, w, l,
    apostado: +staked.toFixed(2), pnl: +pnl.toFixed(2),
    roi_pct: staked ? +(100 * pnl / staked).toFixed(2) : null,
    // EL NÚMERO DEL PRIMER MES: cuánto se pierde entre el precio de papel y el precio real. Si esto es cero
    // el sombra era una buena maqueta; si es −2 %, la ventaja medida en papel era medio punto más pequeña.
    deslizamiento_medio_pct: slip.length ? +(slip.reduce((a, x) => a + x, 0) / slip.length).toFixed(3) : null,
    deslizamiento_n: slip.length,
    recorte_por_tope_n: colocadas.filter((b) => (b.recorte_pct || 0) < 0).length,
    por_que_pendiente: cuenta(pendientes),
    por_que_caducada: cuenta(caducadas),
    dias: L.dias,
    ultimas: L.bets.slice(-limit).reverse(),
  };
}

module.exports = { intentar, reintentar, confirmar, colocar, preflight, liquidar, board, refrescarSaldo, stakeDe, kellyDe, refIdDe, load, save, CFG,
  SEGMENTO, FAMILIA, LADO, CASA, LEDGER };
