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
  // stake PLANO (2-sep, orden de Alexis): si está puesto, toda apuesta automática entra con esta cantidad en
  // vez de Kelly/4. Se respetan igual el tope duro, el mínimo y todos los frenos. CS2 tiene su propia regla
  // plana (GP_REAL_CS2_STAKE) y no se toca. Sin la variable, la fórmula sigue siendo la del sombra.
  stakeFlat: num('GP_REAL_STAKE_FLAT', 0),
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
// Lectura/escritura a prueba de pérdida (4-sep-2026). Esto es el libro de DINERO REAL: si una lectura falla
// y se guarda un libro en blanco encima, el ejecutor pierde la pista de las apuestas abiertas. `jsonstore`
// distingue "no existe" de "no se pudo leer" y bloquea la escritura en el segundo caso. Ver lib/jsonstore.js.
const JS = require('../lib/jsonstore');
const LEDGER_F = path.basename(LEDGER);
const LEDGER_DIR = path.dirname(LEDGER);
function load() {
  if (_L) return _L;
  _L = JS.readJson(LEDGER_DIR, LEDGER_F, 'real') || blank();
  if (!_L || !Array.isArray(_L.bets)) _L = blank();
  _L.dias = _L.dias || {}; _L.avisos = _L.avisos || {}; _L.saldo = _L.saldo || { amount: null, at: null };
  return _L;
}
// ESCRITURA ATÓMICA (4-sep-2026): temporal + rename. Escribir directo encima del archivo bueno deja el
// archivo truncado si el proceso muere a mitad —así se perdió db.json entero en el deploy de esa mañana—.
function save() { return JS.writeJson(LEDGER_DIR, LEDGER_F, load(), 'real'); }

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
  // stake plano por orden humana: manda sobre la fórmula, nunca sobre el tope duro ni el mínimo.
  if (C.stakeFlat > 0) return Math.min(C.stakeMax, Math.max(C.stakeMin, Math.round(C.stakeFlat * 100) / 100));
  const banco = L.nocional > 0 ? L.nocional : C.nocional;
  const f = kellyDe(prob, odds);
  // `f || C.stakePct` es la fórmula EXACTA del sombra, y se conserva a propósito aunque tenga una arista:
  // con f = 0 cae al tope en vez de a cero. Cambiarla aquí rompería la única cosa que este ejecutor existe
  // para medir —la diferencia entre papel y dinero sería la diferencia entre dos fórmulas—. La arista se
  // tapa donde corresponde: una apuesta con Kelly no positiva no se coloca (ver `sin_ventaja` en intentar).
  const st = Math.min(C.stakePct, f || C.stakePct) * banco;
  return Math.min(C.stakeMax, Math.max(C.stakeMin, Math.round(st * 100) / 100));
}

const CF_ESPERA_MS = num('GP_REAL_CF_ESPERA_MIN', 30) * 60e3;

// Rechazos de la casa que NO se arreglan reintentando: o es la cuenta de Alexis con la casa, o es un fallo
// nuestro construyendo la petición. Los demás códigos (precio movido, tope cambiado, mercado suspendido,
// fondos, límite de riesgo, error interno de la casa) sí se reintentan.
const COD_DEFINITIVOS = new Set(['RESTRICTED', 'VERIFICATION_REQUIRED', 'MALFORMED_REQUEST']);

const abiertas = () => load().bets.filter((b) => b.status === 'PLACED');
// LO EN EL AIRE TAMBIÉN CUENTA COMO EXPUESTO. Una apuesta que la casa está evaluando puede tener el dinero
// ya retenido; dejarla fuera del cálculo haría que el tope de exposición permitiera comprometer más de lo
// que creemos. Ante la duda, el dinero se cuenta como comprometido, no como libre.
const enElAire = () => load().bets.filter((b) => b.status === 'EN_ACEPTACION');
const expuesto = () => +[...abiertas(), ...enElAire()]
  .reduce((a, b) => a + (b.stake || b.stake_comprometido || 0), 0).toFixed(2);

// ── VENTANA DE SAQUE: hasta cuándo se puede apostar (4-sep-2026, orden de Alexis) ───────────────────────
// "No quiero que se coloque ninguna apuesta para partidos que sean después de las 8am hora UTC del lunes 7."
// Es un corte de EXPOSICIÓN, no de calidad: da igual lo buena que sea la señal, si el partido empieza
// después de ese instante no se apuesta.
//
// TEMPORAL, Y CONVIENE QUE QUIEN LO LEA LO SEPA: Alexis lo pidió como medida de circunstancia ("luego la
// quitamos"). Mientras la variable siga puesta el ejecutor deja de tomar todo lo que caiga al otro lado del
// corte, así que no es un ajuste que pueda quedarse ahí por inercia. Se levanta borrando la variable.
//
// SE BLOQUEA TAMBIÉN SIN SAQUE CONOCIDO, y es deliberado: si no se sabe cuándo empieza el partido, no se
// puede afirmar que cae dentro de la ventana, y una orden de no exponerse se cumple con el silencio, no con
// una suposición optimista. Comprobado antes de decidirlo para no romper nada: de las 216 filas del libro y
// las 576 del sombra, CERO carecen de `kickoff_at`, así que este bloqueo no deja fuera nada legítimo.
//
// Se controla con `GP_REAL_KICKOFF_MAX` (fecha ISO). Sin la variable NO hay ventana y todo sigue como antes:
// levantar el corte es borrarla, no tocar código.
function ventanaMax() {
  const v = String(process.env.GP_REAL_KICKOFF_MAX || '').trim();
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
// null = se puede apostar. Objeto = fuera de ventana, con el porqué.
function fueraDeVentana(kickoff) {
  const max = ventanaMax();
  if (max == null) return null;                       // sin ventana configurada no se frena nada
  const t = Date.parse(kickoff || '');
  if (!Number.isFinite(t)) return { motivo: 'saque_desconocido', limite: new Date(max).toISOString(), saque: kickoff || null };
  if (t > max) return { motivo: 'saque_posterior', limite: new Date(max).toISOString(), saque: new Date(t).toISOString() };
  return null;
}

// ── los frenos, en orden de gravedad ─────────────────────────────────────────────────────────────────────
// Devuelve null si se puede apostar, o el motivo por el que no. El orden importa: primero lo que apaga todo,
// después lo que solo bloquea esta apuesta.
// `kickoff` llega desde la fila y NO es opcional en la práctica: es lo que hace que la ventana de saque sea
// imposible de esquivar — los dos caminos que mueven dinero (tarjetas por `colocar`, CS2 por el brazo
// automático) pasan por aquí, así que el corte vive en un solo sitio.
function frenos(stake, kickoff) {
  const C = CFG(), L = load();
  if (!C.enabled) return { freno: 'apagado', detalle: 'GP_REAL_ENABLED no está encendido' };
  if (!process.env.CLOUDBET_API_KEY) return { freno: 'sin_api_key' };
  const fv = fueraDeVentana(kickoff);
  if (fv) {
    return { freno: 'fuera_de_ventana',
      detalle: fv.motivo === 'saque_desconocido'
        ? `sin saque conocido y hay ventana hasta ${fv.limite}: no se apuesta a ciegas`
        : `el partido empieza ${fv.saque} y la ventana acaba ${fv.limite}` };
  }
  const d = dia(hoy());
  const tope = C.dayStopPct * (L.nocional || C.nocional);
  if (d.pnl <= -tope) return { freno: 'parada_diaria', detalle: `${d.pnl.toFixed(2)} en el día, tope ${(-tope).toFixed(2)}` };
  const exp = expuesto();
  if (exp + stake > C.maxOpen) return { freno: 'exposicion_maxima', detalle: `${exp.toFixed(2)} abiertas + ${stake} > ${C.maxOpen}` };
  // EL CORTAFUEGOS DE LA CASA NO SE VENCE INSISTIENDO (25-ago). Con la puerta de colocación bloqueada,
  // ~25 apuestas pendientes reintentando cada diez minutos son 150 peticiones a la hora contra un sistema
  // de seguridad que ya nos dijo que no. No arregla nada, es una falta de educación y puede endurecer el
  // bloqueo. Tras tres respuestas seguidas de cortafuegos, el ejecutor se calla media hora y lo anota; una
  // sola respuesta normal de la casa lo reabre al instante.
  // LA CUENTA RESTRINGIDA PARA TODO EL EJECUTOR, no solo para una apuesta. Si la casa ha dicho RESTRICTED o
  // VERIFICATION_REQUIRED varias veces seguidas, el problema no es el partido: es la cuenta. Cada envío
  // nuevo sería un rechazo más contra el contador de abuso que la casa vigila, y el premio por insistir es
  // que nos bloqueen una semana. Se para y se espera a que alguien lo resuelva con la casa.
  const rc = L.rechazos_cuenta;
  if (rc && rc.seguidos >= num('GP_REAL_RECHAZOS_TOPE', 3)) {
    return { freno: 'cuenta_restringida', detalle: `la casa rechazó ${rc.seguidos} seguidas con ${rc.codigo}; hay que resolverlo con ella antes de seguir` };
  }
  const cf = L.cortafuegos;
  if (cf && cf.seguidos >= 3 && Date.now() - Date.parse(cf.ultimo || 0) < CF_ESPERA_MS) {
    return { freno: 'puerta_cerrada', detalle: `la casa bloquea la colocación (${cf.seguidos} seguidas); se reintenta tras ${Math.round(CF_ESPERA_MS / 60000)} min` };
  }
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
// `fuera_de_ventana` es DEFINITIVO: el tiempo solo va hacia adelante, así que un partido que ya cae
// fuera del corte no va a volver a entrar. Reintentarlo 80 veces sería ruido con dinero al lado.
// `banda_eficiente` también es DEFINITIVO: la banda de una liga no cambia entre dos barridos.
// `linea_ya_apostada` igual: la posición ya está tomada y no se va a destomar.
const DEFINITIVOS = new Set(['sin_ventaja', 'fuera_de_perimetro', 'fuera_de_ventana', 'banda_eficiente', 'linea_ya_apostada']);

// ── UNA POSICIÓN, UNA APUESTA (5-sep, orden de Alexis) ──────────────────────────────────────────────────
// "Se puede apostar dos veces a un mismo partido pero no a la misma línea": under 3,5 y under 4,5 del mismo
// partido está bien; dos under 4,5 duplicando el monto, no. Dos filas son la MISMA POSICIÓN si son el
// mismo partido, la misma línea y el mismo lado. El partido se reconoce por cualquiera de sus tres
// identidades —el id de la casa, el id canónico nuestro, o nombre+saque—, porque una fila recién nacida
// aún no tiene el de la casa y una rescatada de la casa no tiene el nuestro.
// Cuentan las filas con dinero puesto o posiblemente puesto: PLACED, EN_ACEPTACION y SETTLED. Una PENDIENTE
// no cuenta (todavía no hay dinero) y una DESCARTADA/CADUCADA tampoco.
const CON_DINERO = new Set(['PLACED', 'EN_ACEPTACION', 'SETTLED']);
function mismoPartido(a, b) {
  if (a.cb_event_id && b.cb_event_id && String(a.cb_event_id) === String(b.cb_event_id)) return true;
  if (a.ceid && b.ceid && a.ceid === b.ceid) return true;
  return !!(a.match && b.match && a.match === b.match && a.kickoff_at && b.kickoff_at
    && Date.parse(a.kickoff_at) === Date.parse(b.kickoff_at));
}
function mismaPosicion(a, b) {
  if (!a || !b || a === b) return false;
  if (String(a.side || '').toLowerCase() !== String(b.side || '').toLowerCase()) return false;
  if (a.line == null || b.line == null || Number(a.line) !== Number(b.line)) return false;
  return mismoPartido(a, b);
}
// la fila con dinero que ya ocupa la misma posición que `fila`, o null
function posicionOcupada(L, fila) {
  return (L.bets || []).find((b) => b !== fila && b.pick_id !== fila.pick_id && CON_DINERO.has(b.status) && mismaPosicion(b, fila)) || null;
}

// ── EL VETO A LAS LIGAS EFICIENTES (5-sep, orden de Alexis tras la revisión del rendimiento) ────────────
// El edge de tarjetas-under está en las ligas intermedias y blandas, y el motor ya lo sabe: en las
// eficientes (Premier, Championship, Bundesliga, Serie A, Ligue 1, MLS…) la pick nace en régimen `monitor`
// y NADIE la ve. La sombra las toma igual porque su regla congelada mide TODO, y el ejecutor real colgaba
// de la sombra sin distinguir. Medido el 5-sep: 47 liquidadas de papel en eficientes, 57 % de acierto con
// 54 % de break-even, ROI +0,4 % — ruido, no edge —, mientras que 26 de las 41 apuestas reales vivas (1.040
// de 1.640 USDT) estaban justo ahí. Desde hoy el dinero real no entra en la banda eficiente. La sombra NO
// cambia: sigue midiendo todas las bandas para la revisión de la regla; esto es un perímetro del dinero.
// La banda la calcula el motor (leagueEfficiency, con el prior por liga y la medición por Brier) y llega
// desde el llamador: este módulo no tiene la base y no debe adivinarla. Sin banda conocida NO se veta —
// las filas de CS2 no tienen liga— y se anota tal cual.
// `GP_REAL_BANDAS_VETADAS` (por defecto 'eficiente'; vacío = sin veto) permite ajustar sin tocar código.
function bandasVetadas() {
  const v = process.env.GP_REAL_BANDAS_VETADAS;
  const txt = v == null ? 'eficiente' : String(v);
  return new Set(txt.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
const bandaVetada = (banda) => !!banda && bandasVetadas().has(String(banda).toLowerCase());

function filaNueva(sb, pick, banda = null) {
  return {
    ref_id: refIdDe(sb.pick_id, 0), envios: 0, pick_id: sb.pick_id, shadow_id: sb.id || null,
    match: sb.match, league: sb.league, banda: banda || null, line: sb.line, side: LADO,
    kickoff_at: sb.kickoff_at || null,
    ceid: (pick && pick.event && pick.event.canonical_event_id) || null,
    odds_sombra: sb.odds, model_prob: sb.model_prob,
    at: new Date().toISOString(),
    status: 'PENDIENTE', intentos: 0,
  };
}

// ── EL SEGUNDO CAMINO PARA ENCONTRAR EL PARTIDO EN LA CASA ───────────────────────────────────────────────
// Solo se usa cuando el índice del colector todavía no tiene ese partido. Y es a propósito más estricto que
// el emparejador del colector, porque aquí un error no escribe una cuota mal: coloca dinero real en otro
// partido. Cuatro condiciones, todas obligatorias:
//   · los DOS equipos casan (en el orden que sea: la casa puede tener el local y el visitante al revés),
//   · el saque no se aleja más de seis horas del nuestro,
//   · el partido de la casa aún no ha empezado,
//   · y sale UN solo candidato. Con dos, no se apuesta: dos partidos del mismo par en la misma ventana es
//     exactamente el caso en el que una máquina se equivoca con toda confianza.
const normNombre = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|cf|sc|ac|afc|cd|ud|sd|club|deportivo|atletico|atletic|athletic|real|the)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '');
function casanNombres(a, b) {
  const x = normNombre(a), y = normNombre(b);
  if (!x || !y || x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}
// `slate` es la agenda PERSISTIDA de la casa (db.cbSlate). Se prefiere a la caché de proceso por una razón
// medida: la caché se vacía en cada despliegue y con varios al día está fría la mayor parte del tiempo —
// 121 eventos a las 15:30 y cero a las 16:26, con tres apuestas esperando por un id que sí existía.
function resolverPorNombre(fila, slate) {
  const m = String(fila.match || '').split(/\s+vs\s+/i);
  if (m.length !== 2) return null;
  const [casa1, casa2] = m;
  let lista = [];
  if (slate && Array.isArray(slate.ev) && slate.ev.length) {
    lista = slate.ev.map((e) => ({ cb_id: e.id, home: e.h, away: e.a, kickoff: e.ko }));
  } else {
    try { const c = CB.cachedSoccer && CB.cachedSoccer(); if (c && Array.isArray(c.data)) lista = c.data; } catch { return null; }
  }
  if (!lista.length) return null;
  const ko = fila.kickoff_at ? Date.parse(fila.kickoff_at) : null;
  const cands = lista.filter((e) => {
    if (!e.cb_id || !e.home || !e.away) return false;
    const directo = casanNombres(e.home, casa1) && casanNombres(e.away, casa2);
    const cruzado = casanNombres(e.home, casa2) && casanNombres(e.away, casa1);
    if (!directo && !cruzado) return false;
    const k2 = e.kickoff ? Date.parse(e.kickoff) : null;
    if (k2 && k2 < Date.now()) return false;
    if (ko && k2 && Math.abs(k2 - ko) > 6 * 3600e3) return false;
    return true;
  });
  if (cands.length !== 1) return null;
  return { cb_id: cands[0].cb_id, home: cands[0].home, away: cands[0].away, kickoff: cands[0].kickoff };
}

// POR QUÉ NO RESOLVIÓ, condición por condición. `resolverPorNombre` devuelve null por cinco motivos
// distintos y el diagnóstico los daba todos como "sin_id_de_evento", que no se puede arreglar porque no
// dice nada. Esto enseña los candidatos que SÍ casaron de nombre y qué filtro los tumbó: es la diferencia
// entre "la casa no lo tiene" y "lo tiene y nosotros lo estamos descartando".
function resolverDiag(fila, slate) {
  const m = String(fila.match || '').split(/\s+vs\s+/i);
  if (m.length !== 2) return { motivo: 'el nombre del partido no tiene la forma "A vs B"' };
  const [c1, c2] = m;
  const lista = (slate && Array.isArray(slate.ev) && slate.ev.length)
    ? slate.ev.map((e) => ({ cb_id: e.id, home: e.h, away: e.a, kickoff: e.ko })) : [];
  if (!lista.length) return { motivo: 'la agenda de la casa está vacía' };
  const ko = fila.kickoff_at ? Date.parse(fila.kickoff_at) : null;
  const porNombre = lista.filter((e) => (casanNombres(e.home, c1) && casanNombres(e.away, c2))
    || (casanNombres(e.home, c2) && casanNombres(e.away, c1)));
  if (!porNombre.length) {
    // ¿casa AL MENOS UNO de los dos equipos? Separa "no está el partido" de "está con otro nombre".
    const medio = lista.filter((e) => casanNombres(e.home, c1) || casanNombres(e.away, c1)
      || casanNombres(e.home, c2) || casanNombres(e.away, c2)).slice(0, 4);
    return { motivo: 'ningún partido casa los DOS nombres', agenda: lista.length,
      casan_uno: medio.map((e) => `${e.home} v ${e.away}`) };
  }
  return { motivo: porNombre.length > 1 ? 'más de un candidato: no se apuesta' : 'candidato único, mirar los filtros',
    candidatos: porNombre.slice(0, 4).map((e) => ({ id: e.cb_id, partido: `${e.home} v ${e.away}`,
      saque_casa: e.kickoff, saque_nuestro: fila.kickoff_at,
      horas_de_diferencia: (ko && e.kickoff) ? +((Date.parse(e.kickoff) - ko) / 3600e3).toFixed(1) : null,
      ya_empezo: e.kickoff ? Date.parse(e.kickoff) < Date.now() : null })) };
}

// EL INTENTO, sobre una fila que ya existe en el libro. Devuelve la fila.
async function colocar(fila, { cbIdx = {}, slate = null, stakeFijo = 0, banda } = {}) {
  const C = CFG(), L = load();
  // cinturón además del filtro de reintentar: una fila de otra familia (CS2 manual) apostaría al mercado
  // de tarjetas del partido equivocado. Jamás pasa de aquí.
  if (fila.familia && fila.familia !== FAMILIA) return fila;
  fila.intentos = (fila.intentos || 0) + 1;
  fila.ultimo_intento_at = new Date().toISOString();
  fila.dry = C.dry;
  // la banda de la liga viaja con la fila; si el llamador la trae fresca, manda la fresca (la medición
  // por Brier puede mover una liga de banda entre dos barridos, y el veto tiene que ver la actual).
  if (banda) fila.banda = banda;

  // se para porque no da tiempo, no porque el intento fallara: la distinción importa para el informe.
  const ko = fila.kickoff_at ? Date.parse(fila.kickoff_at) : null;
  if (ko && ko <= Date.now()) { fila.status = 'CADUCADA'; save(); return fila; }
  if (fila.intentos > REINTENTOS_MAX) { fila.status = 'CADUCADA'; fila.motivo = 'demasiados_intentos'; save(); return fila; }

  const parar = (motivo, extra) => {
    Object.assign(fila, { motivo, ...(extra || {}) });
    fila.status = DEFINITIVOS.has(motivo) ? 'DESCARTADA' : 'PENDIENTE';
    save(); return fila;
  };

  // 0) EL VETO A LA BANDA EFICIENTE va antes que nada: ni stake, ni frenos, ni una sola petición a la casa.
  //    Es un corte de PERÍMETRO, no de calidad de la señal — da igual la cuota o la ventaja que traiga.
  if (bandaVetada(fila.banda)) {
    return parar('banda_eficiente', { detalle: `${fila.league || 'liga desconocida'} está en banda ${fila.banda}: el dinero real no entra ahí (orden 5-sep)` });
  }

  // 1) LA VENTAJA: SE MIDE, PERO NO SE FILTRA (25-ago, decisión de Alexis).
  //    Este ejecutor rechazaba las señales cuyo `prob × cuota ≤ 1` —el modelo diciendo que a ese precio
  //    pierde—. Sonaba prudente y rompía lo único que este primer mes existe para medir: la sombra SÍ las
  //    toma, así que filtrarlas aquí convertía la diferencia entre los dos registros en "dos criterios
  //    distintos" en vez de "papel contra dinero". El +44,9 % del papel incluye esas apuestas; el resultado
  //    real tiene que incluirlas para poder ponerse al lado.
  //    Medido antes de decidir: son el 14 % de las señales, con EV medio −2,1 %. Incluirlas cuesta unos
  //    0,3 puntos de EV global. Romper la comparabilidad costaba el experimento entero.
  //    Se marca cada una con su EV para poder contestar dentro de un mes si de verdad perdieron, que es la
  //    única forma honesta de cerrar esta discusión: con datos y no con intuición.
  //    `GP_REAL_EXIGIR_VENTAJA=1` vuelve a filtrarlas si algún día la medición dice que hay que hacerlo.
  const evModelo = (fila.model_prob > 0 && fila.odds_sombra > 1) ? fila.model_prob * fila.odds_sombra - 1 : null;
  fila.ev_modelo_pct = evModelo == null ? null : +(100 * evModelo).toFixed(2);
  if (on('GP_REAL_EXIGIR_VENTAJA', false) && kellyDe(fila.model_prob, fila.odds_sombra) <= 0) {
    return parar('sin_ventaja', { prob: fila.model_prob });
  }
  // stake FIJO (1-sep): una orden humana explícita ("coloca esta con $29") manda sobre la fórmula.
  // Se respetan igual el tope duro y todos los frenos; solo se salta el cálculo de Kelly.
  const stake = stakeFijo > 0 ? Math.min(CFG().stakeMax, +stakeFijo) : stakeDe(fila.model_prob, fila.odds_sombra);
  fila.stake = stake;
  if (stakeFijo > 0) fila.stake_fijado = +stakeFijo;

  const f = frenos(stake, fila.kickoff_at);
  if (f) return parar(f.freno, { detalle: f.detalle, saldo: L.saldo && L.saldo.amount });

  // 1b) UNA POSICIÓN, UNA APUESTA. Si otra fila con dinero ya ocupa este partido+línea+lado, esta no sale.
  //     Cubre la re-emisión de la señal con otro pick_id (misma línea, otra pick) y cualquier camino que
  //     llegue aquí dos veces para la misma posición. Se mira antes de tocar a la casa y otra vez después
  //     de resolver el id del partido, que es la identidad más fiable.
  const ocupada1 = posicionOcupada(L, fila);
  if (ocupada1) return parar('linea_ya_apostada', { detalle: `ya hay una apuesta ${ocupada1.status} a ${fila.side} ${fila.line} en este partido (pick ${ocupada1.pick_id}, ref ${ocupada1.ref_id || 's/r'})`, ocupada_por: ocupada1.pick_id });

  // 2) el id del partido en la casa
  let idx = fila.ceid ? (cbIdx || {})[fila.ceid] : null;
  if (!idx || !idx.cb_id) {
    // el índice se llena cuando el colector empareja un partido, y no siempre llega a todos: con el cupo de
    // eventos por pasada, un partido puede tardar horas en entrar. Segundo camino, por NOMBRE, sobre lo
    // último que el colector dejó en memoria. Es deliberadamente desconfiado: apostar en el partido
    // equivocado es el peor fallo posible de todo este sistema, mucho peor que no apostar.
    const porNombre = resolverPorNombre(fila, slate);
    if (!porNombre) return parar('sin_id_de_evento');
    idx = porNombre; fila.id_resuelto_por = 'nombre';
  }
  fila.cb_event_id = idx.cb_id;
  const ocupada2 = posicionOcupada(L, fila);
  if (ocupada2) return parar('linea_ya_apostada', { detalle: `ya hay una apuesta ${ocupada2.status} a ${fila.side} ${fila.line} en el evento ${idx.cb_id} (pick ${ocupada2.pick_id})`, ocupada_por: ocupada2.pick_id });

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
  // el estado del cortafuegos se lleva aparte del resultado de la apuesta: una cosa es que la casa nos
  // rechace una apuesta y otra que no nos deje ni preguntar.
  if (r.cortafuegos) {
    L.cortafuegos = { seguidos: ((L.cortafuegos && L.cortafuegos.seguidos) || 0) + 1,
      ultimo: new Date().toISOString(), desde: (L.cortafuegos && L.cortafuegos.desde) || new Date().toISOString() };
    return parar('cortafuegos_de_la_casa', { http: r.status });
  }
  if (L.cortafuegos && L.cortafuegos.seguidos) L.cortafuegos = { seguidos: 0, reabierto: new Date().toISOString() };

  const cuerpo = r.body || {};
  const est = String(r.betStatus || cuerpo.betStatus || '').toUpperCase();
  const cod = String(r.betError || cuerpo.betErrorCode || '').toUpperCase();
  fila.error_casa = cod || null;

  // LA REFERENCIA SOLO SE QUEMA CON UN RECHAZO EXPLÍCITO DE LA CASA (5-sep, tras una doble colocación real).
  // Parma–Monza under 4,5: la primera respuesta no fue un JSON legible con `REJECTED`, sino un "no ok" con
  // código HTTP ≥ 200 (la casa o su pasarela contestando algo que no era su cuerpo normal). El código de
  // abajo lo trataba como rechazo: quemó la referencia, estrenó otra y volvió a enviar. La casa había
  // aceptado la primera. Resultado: dos apuestas de 40 USDT a la misma línea, una por referencia. La regla
  // "sin código de estado nadie nos contestó" era verdad; su inversa —"con código de estado la casa nos
  // rechazó"— NO lo era, y con dinero esa inversa vale una apuesta doble.
  // Ahora hay una sola forma de quemar la referencia en este punto: `betStatus: REJECTED` con cuerpo de la
  // casa. Cualquier otro "no ok" con respuesta HTTP deja la fila EN_ACEPTACION con la MISMA referencia y
  // `confirmar()` le pregunta a la casa qué pasó con ella. Si la casa la tiene, era nuestra; si la casa
  // dice que no la tiene varias veces seguidas, se reintenta con la misma referencia — y si resultara que
  // sí llegó, la casa contesta DUPLICATE_REQUEST, que ya se sabe leer. Así no hay ningún camino por el que
  // dos referencias distintas de la misma fila lleguen a la casa sin que ella haya rechazado la primera.
  const rechazoExplicito = est === 'REJECTED' && !!(r.body || cuerpo.betStatus);
  if (!r.ok && !rechazoExplicito && Number(r.status) >= 200) {
    fila.status = 'EN_ACEPTACION';
    fila.motivo = 'respuesta_no_reconocida';
    fila.stake_comprometido = stakeFinal;
    fila.detalle = `la casa contestó HTTP ${r.status} sin un veredicto legible: se pregunta por la referencia antes de mover nada`;
    fila.confirmaciones_sin_rastro = 0;
    save();
    return fila;
  }

  if (!r.ok || est === 'REJECTED') {
    // LA CASA AHORA DICE POR QUÉ, Y NO TODOS LOS "NO" SON IGUALES. Con la API vieja un rechazo era una
    // pared sin letrero; GraphQL devuelve un código y eso separa tres mundos que exigen tres reacciones:
    //   · el precio se movió, el tope cambió, el mercado se suspendió, faltan fondos → vuelve a intentarse,
    //     porque lo que falló puede dejar de fallar en diez minutos;
    //   · la referencia ya estaba usada → NO se estrena otra a ciegas: se pregunta por la vieja, que es el
    //     único camino que no arriesga colocar dos veces lo mismo;
    //   · la cuenta está restringida o sin verificar, o mandamos algo malformado → eso no lo arregla
    //     insistir. Se descarta y se avisa, porque o es cosa de Alexis con la casa o es un fallo nuestro.
    if (cod === 'DUPLICATE_REQUEST') {
      fila.status = 'EN_ACEPTACION'; fila.motivo = 'referencia_ya_usada'; fila.stake_comprometido = stakeFinal;
      save(); return fila;
    }
    if (COD_DEFINITIVOS.has(cod)) {
      fila.status = 'DESCARTADA'; fila.motivo = 'cuenta_o_peticion:' + cod.toLowerCase();
      // Y SE DEJA DE INTENTAR CON TODAS, no solo con esta. La casa documenta que si el ratio de rechazos
      // se dispara —hablan de más del 80 % de las últimas 100— marca la cuenta por abuso y la bloquea hasta
      // siete días. Si el motivo es la cuenta, cada apuesta nueva es un rechazo más contra ese contador:
      // seguir enviando no consigue nada y arriesga que nos cierren la única casa que podemos ejecutar.
      L.rechazos_cuenta = { seguidos: ((L.rechazos_cuenta && L.rechazos_cuenta.seguidos) || 0) + 1,
        codigo: cod, ultimo: new Date().toISOString(), via: r.via || null };
      save(); return fila;
    }
    // cualquier respuesta que NO sea de cuenta restringida limpia el contador: el problema era otro
    if (L.rechazos_cuenta && L.rechazos_cuenta.seguidos) L.rechazos_cuenta = { seguidos: 0, limpiado: new Date().toISOString() };

    // LA REFERENCIA SOLO SE QUEMA SI LA CASA LLEGÓ A HABLAR (25-ago). La casa consume la referencia cuando
    // recibe el envío, así que tras un rechazo suyo hay que estrenar otra. Pero si la petición NO llegó
    // —el reenviador caído, la red cortada, el tiempo agotado— la referencia sigue virgen, y estrenar una
    // por cada reintento haría dos cosas malas: llenar el registro de referencias muertas, y perder la
    // única protección real contra colocar dos veces lo mismo si resultara que sí llegó.
    // Se distingue por si hubo respuesta HTTP de la casa: sin código de estado, nadie nos contestó.
    const hablo = Number(r.status) >= 200;
    if (hablo) { fila.envios = (fila.envios || 0) + 1; fila.ref_id = refIdDe(fila.pick_id, fila.envios); }
    return parar(hablo ? 'rechazada_por_la_casa' : 'no_llego_a_la_casa',
      { http: r.status, error_casa: cod || null, via: r.via || null });
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
  // una aceptada demuestra que la cuenta puede operar: el contador de rechazos de cuenta se limpia
  if (L.rechazos_cuenta && L.rechazos_cuenta.seguidos) L.rechazos_cuenta = { seguidos: 0, limpiado: new Date().toISOString() };
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
  let liberadas = 0;
  for (const fila of enAire) {
    const st = await CB.betByReference(process.env.CLOUDBET_API_KEY || '', fila.ref_id).catch(() => null);
    if (!st) {
      // "NO LA TENGO" NO ES LO MISMO QUE "NO SÉ" (5-sep). `betByReference` devuelve null en los dos casos.
      // Para una fila en el aire por una respuesta no reconocida, la diferencia es la que decide si el
      // envío llegó: si la casa CONTESTA que no tiene la referencia tres veces seguidas, el envío no llegó
      // y la fila vuelve a PENDIENTE con la MISMA referencia (si llegó y no lo vimos, el reenvío chocará con
      // DUPLICATE_REQUEST y se leerá como tal). Si la casa no contesta, no se concluye nada: se espera.
      let veredicto = null;
      try { veredicto = await require('./reconciliar').leerApuesta(process.env.CLOUDBET_API_KEY || '', fila.ref_id, { reintentos: 1, esperar: true }); }
      catch { veredicto = null; }
      if (veredicto && veredicto.estado === 'existe' && veredicto.bet) {
        // la lectura fina sí la vio: se sigue abajo con ese cuerpo
        const rawX = veredicto.bet;
        const estX = String(rawX.betStatus || rawX.status || '').toUpperCase();
        if (estX === 'ACCEPTED' || CB.ESTADOS_LIQUIDADOS.has(estX)) {
          fila.status = 'PLACED'; fila.motivo = null;
          fila.odds_real = Number(rawX.price) || fila.precio_vivo || fila.odds_sombra;
          fila.stake = Number(rawX.stake) || fila.stake;
          fila.placed_at = fila.placed_at || new Date().toISOString();
          fila.slippage_pct = fila.odds_sombra > 0 ? +(100 * (fila.odds_real / fila.odds_sombra - 1)).toFixed(2) : null;
          const d = dia(String(fila.placed_at).slice(0, 10)); d.apostado += fila.stake; d.n += 1;
          aceptadas++; continue;
        }
        if (estX === 'REJECTED') {
          fila.envios = (fila.envios || 0) + 1; fila.ref_id = refIdDe(fila.pick_id, fila.envios);
          fila.status = 'PENDIENTE'; fila.motivo = 'rechazada_por_la_casa'; fila.error_casa = rawX.betErrorCode || rawX.error || null;
          rechazadas++; continue;
        }
        siguen++; continue;
      }
      if (veredicto && veredicto.estado === 'no_existe') {
        fila.confirmaciones_sin_rastro = (fila.confirmaciones_sin_rastro || 0) + 1;
        if (fila.confirmaciones_sin_rastro >= 3) {
          fila.status = 'PENDIENTE'; fila.motivo = 'no_llego_a_la_casa';
          fila.detalle = `la casa dijo ${fila.confirmaciones_sin_rastro} veces que no tiene la referencia: el envío no llegó; se reintenta con la MISMA referencia`;
          delete fila.stake_comprometido;
          liberadas++; continue;
        }
      }
      siguen++; continue;
    }
    // `betStatus`, no `status`: la API GraphQL nombra así el campo, y leer el nombre de la API vieja dejaba
    // toda apuesta en el aire atascada ahí para siempre —ni se confirmaba ni se liberaba— con el dinero
    // comprometido contando contra el tope de exposición. Lo cazó la auditoría, no la producción.
    const raw = st.bet || st;
    const est = String(raw.betStatus || raw.status || '').toUpperCase();
    // si ya se resolvió el partido mientras estaba en el aire, la apuesta existió: se acepta y que la
    // liquidación haga su trabajo en la pasada siguiente.
    if (est === 'ACCEPTED' || CB.ESTADOS_LIQUIDADOS.has(est)) {
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
  if (aceptadas || rechazadas || liberadas) save();
  return { en_aire: enAire.length, aceptadas, rechazadas, liberadas, siguen };
}

// LA PUERTA DE ENTRADA: una señal nueva del sombra. Crea la fila y hace el primer intento.
// `banda` es la banda de eficiencia de la liga según el motor ('eficiente' | 'intermedia' | 'blanda'); la
// fila nace con ella y `colocar` la veta si toca. Sin banda (CS2, o un llamador antiguo) no se veta.
async function intentar(sb, pick, { cbIdx = {}, slate = null, banda = null } = {}) {
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
  const fila = filaNueva(sb, pick, banda);
  L.bets.push(fila);
  return colocar(fila, { cbIdx, slate, banda });
}

// LOS REINTENTOS. Se llama una vez por barrido, después de la puerta de entrada. Recorre lo pendiente cuyo
// partido no ha empezado y lo vuelve a intentar. Es lo que convierte un fallo pasajero en un retraso en vez
// de en una apuesta perdida.
// `bandaDe(liga)` → banda actual según el motor. Las filas PENDIENTES de antes del veto también pasan por
// él: una que estaba esperando saldo o el id del partido no se cuela por haber nacido antes.
async function reintentar({ cbIdx = {}, slate = null, max = 25, bandaDe = null } = {}) {
  const L = load();
  const ahora = Date.now();
  // el veto por aviso_manual protegía del doble-colocado cuando el correo invitaba a Alexis a apostar a
  // mano. Con los avisos APAGADOS (1-sep: el ejecutor hace todo) ese correo ya no sale y el veto solo
  // dejaría filas varadas para siempre; se respeta únicamente mientras el canal manual siga vivo.
  const avisosOn = String(process.env.GP_REAL_AVISO_MANUAL || 'true') !== 'false';
  const cola = L.bets.filter((b) => b.status === 'PENDIENTE'
    && (!avisosOn || !b.aviso_manual)
    && b.motivo !== 'solo_manual' // filas de canal manual puro (CS2): la API no tiene su mercado
    && (!b.kickoff_at || Date.parse(b.kickoff_at) > ahora))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0))
    .slice(0, max);
  let colocadas = 0;
  for (const fila of cola) {
    let banda = null;
    if (typeof bandaDe === 'function' && fila.league) { try { banda = bandaDe(fila.league) || null; } catch { banda = null; } }
    const r = await colocar(fila, { cbIdx, slate, banda }).catch(() => null);
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
async function preflight(pares, { cbIdx = {}, slate = null } = {}) {
  const C = CFG();
  const out = [];
  for (const { sb, pick } of pares) {
    const f = { match: sb.match, league: sb.league, line: sb.line, odds_sombra: sb.odds };
    const ceid = (pick && pick.event && pick.event.canonical_event_id) || null;
    f.ceid = ceid;
    let idx = ceid ? (cbIdx || {})[ceid] : null;
    if (!idx || !idx.cb_id) idx = resolverPorNombre({ match: sb.match, kickoff_at: sb.kickoff_at }, slate);
    if (!idx || !idx.cb_id) { f.paso = 'sin_id_de_evento';
      f.por_que = resolverDiag({ match: sb.match, kickoff_at: sb.kickoff_at }, slate);
      out.push(f); continue; }
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
// P&L por el ESTADO que dice la casa, con el precio que aceptó y el stake que cobró. Null = estado que no
// sabemos convertir (PARTIAL, o uno nuevo): ahí manda el importe de la casa tal cual venga.
function pnlPorEstado(estado, stake, precio) {
  const st = String(estado || '').toUpperCase();
  if (st === 'WIN') return stake * (precio - 1);
  if (st === 'LOSS') return -stake;
  if (st === 'PUSH' || st === 'VOID' || st === 'CANCELLED') return 0;
  if (st === 'HALF_WIN') return stake * (precio - 1) / 2;
  if (st === 'HALF_LOSS') return -stake / 2;
  return null;
}

// RELIQUIDAR UNA APUESTA YA CERRADA (1-sep). Para las que se liquidaron con la lectura equivocada del
// importe: recalcula el P&L con la aritmética de arriba a partir del estado que la casa ya dio y ajusta
// el libro —realizado, nocional y el día— por la DIFERENCIA. No pregunta a la casa ni cambia el resultado;
// solo corrige el dinero. Se llama a mano por referencia (`run=reliquidar&ref=`).
function reliquidar(refId) {
  const C = CFG();
  const L = load();
  const b = L.bets.find((x) => x.ref_id === refId);
  if (!b) return { error: 'referencia no encontrada' };
  if (b.status !== 'SETTLED') return { error: 'no está liquidada', status: b.status };
  const casa = String(b.casa_estado || b.resultado || '').toUpperCase();
  const stake = Number(b.stake) || 0;
  const arit = pnlPorEstado(casa, stake, Number(b.odds_real || b.odds_sombra) || 1);
  if (arit == null) return { error: 'estado sin aritmética conocida', estado: casa };
  const antes = Number(b.pnl) || 0;
  const despues = +arit.toFixed(2);
  const delta = +(despues - antes).toFixed(2);
  if (Math.abs(delta) < 0.005) return { ok: true, sin_cambio: true, pnl: antes };
  b.pnl_antes_de_corregir = antes;
  b.pnl = despues;
  b.corregido_at = new Date().toISOString();
  if (b.pagado_por_la_casa != null) {
    const ret = Number(b.pagado_por_la_casa);
    b.importe_casa_semantica = Math.abs(ret - arit) <= 0.011 ? 'neto' : Math.abs((ret - stake) - arit) <= 0.011 ? 'bruto' : null;
    if (b.importe_casa_semantica) delete b.discrepancia_importe;
  }
  L.realizado = +((L.realizado || 0) + delta).toFixed(2);
  L.nocional = +((L.nocional || C.nocional) + delta).toFixed(2);
  const d = dia(String(b.settled_at || b.corregido_at).slice(0, 10)); d.pnl = +(d.pnl + delta).toFixed(2);
  save();
  return { ok: true, ref_id: refId, match: b.match, estado: casa, pnl_antes: antes, pnl_ahora: despues, delta, realizado: L.realizado, nocional: L.nocional };
}

// `resultados` es un mapa pick_id → { result_code, } que el llamador saca de sus propias picks liquidadas.
// `sombra` son las apuestas del ejecutor en la sombra (db.shadow.bets): la posición de papel de la que nació
// cada fila, con su liquidación propia. Solo la usan las filas manuales, y solo cuando la pick no sirve.
async function liquidar(resultados = {}, { sombra = [] } = {}) {
  const C = CFG();
  if (!process.env.CLOUDBET_API_KEY) return { settled: 0, why: 'sin_api_key' };
  const L = load();
  const pend = L.bets.filter((b) => b.status === 'PLACED');
  const sombraPorId = {};
  for (const sb of (Array.isArray(sombra) ? sombra : [])) if (sb && sb.id) sombraPorId[sb.id] = sb;
  let settled = 0, esperando = 0, descuadres = 0;
  for (const b of pend) {
    // APUESTAS COLOCADAS A MANO (25-ago). Mientras la cuenta no pueda apostar por API, Alexis coloca por la
    // web y aquí se anotan con `via: 'manual'`. La casa no nos deja preguntar por ellas —no tienen nuestra
    // referencia y su historial no es legible desde fuera—, así que se liquidan con NUESTRO resultado, el
    // mismo que cierra la pick del sombra, y quedan marcadas `verificacion: 'resultado_propio'` para que el
    // informe nunca las confunda con las verificadas contra el dinero de la casa. El saldo real de la
    // cartera, que sí es legible, sirve de contraste grueso al final del día.
    if (b.via === 'manual') {
      let mio = String((resultados[b.pick_id] || {}).result_code || '').toUpperCase();
      let fuente = 'pick';
      // UNA APUESTA COLOCADA NO SE DES-COLOCA (5-sep; el mismo fallo que la sombra corrigió el 19-ago y que
      // este camino, escrito el 25-ago, heredó sin la corrección). Cuando el motor re-emite la señal (u4,5 →
      // u5,5, o el prune la saca del feed) la pick queda SUPERSEDED, y eso es un hecho sobre la SEÑAL, no sobre
      // el dinero: la apuesta está puesta en esa línea a ese precio y el partido la resuelve igual. Con solo el
      // código de la pick, 27 apuestas manuales de fútbol —761 USDT— llevaban una semana "esperando" un
      // WIN/LOSS que jamás iba a llegar: la exposición abierta se inflaba y el P&L real las omitía. La sombra
      // ya resolvió esa misma posición contra el total real del partido y contra SU propia línea, así que
      // cuando la pick no sirve se toma ese veredicto — exigiendo mismo lado y misma línea, para no heredar
      // nunca el resultado de una posición distinta.
      if (!/^(WIN|LOSS|VOID|PUSH|CANCEL)/.test(mio)) {
        const sb = sombraPorId[b.shadow_id];
        const mismoLado = sb && String(sb.side || '').toLowerCase() === String(b.side || '').toLowerCase();
        const mismaLinea = sb && (sb.line == null || b.line == null || Number(sb.line) === Number(b.line));
        if (sb && sb.status === 'SETTLED' && /^(WIN|LOSS|VOID)$/.test(String(sb.result || '')) && mismoLado && mismaLinea) {
          mio = String(sb.result).toUpperCase(); fuente = 'sombra_linea_propia';
        }
      }
      if (!mio) { esperando++; continue; }
      const stakeM = Number(b.stake) || 0;
      if (mio === 'WIN') { b.pnl = +(stakeM * ((b.odds_real || b.odds_sombra) - 1)).toFixed(2); b.resultado = 'WIN'; }
      else if (mio === 'LOSS') { b.pnl = -stakeM; b.resultado = 'LOSS'; }
      else if (/VOID|PUSH|CANCEL/.test(mio)) { b.pnl = 0; b.resultado = 'VOID'; }
      else { esperando++; continue; }
      b.status = 'SETTLED'; b.settled_at = new Date().toISOString();
      b.resultado_nuestro = mio; b.verificacion = 'resultado_propio'; b.fuente_resultado = fuente;
      L.realizado = +((L.realizado || 0) + b.pnl).toFixed(2);
      L.nocional = +((L.nocional || C.nocional) + b.pnl).toFixed(2);
      const dM = dia(String(b.settled_at).slice(0, 10)); dM.pnl = +(dM.pnl + b.pnl).toFixed(2);
      settled++;
      continue;
    }
    const raw = await CB.betByReference(process.env.CLOUDBET_API_KEY, b.ref_id).catch(() => null);
    if (!raw) { esperando++; continue; }
    const casa = String(raw.betStatus || '').toUpperCase();
    // LA CASA MANDA, Y AHORA SÍ LO DICE. `betStatus` pasa de ACCEPTED a WIN / LOSS / PUSH / HALF_WIN /
    // HALF_LOSS / PARTIAL cuando el partido se resuelve. Mientras no sea uno de esos, la apuesta sigue
    // viva por mucho que nuestro liquidador ya haya cerrado la pick: el dinero no ha vuelto.
    if (!CB.ESTADOS_LIQUIDADOS.has(casa)) { esperando++; continue; }

    const ret = raw.returnAmount != null && raw.returnAmount !== '' ? Number(raw.returnAmount) : null;
    const stake = Number(b.stake) || 0;
    // EL IMPORTE DE LA CASA ES NETO, NO BRUTO (1-sep, primera liquidación real; medido con `run=cb_estado`:
    // la respuesta vino por GraphQL). `returnAmount` es el RESULTADO de la apuesta: +15,37 en una ganada
    // de 29 a 1,53 y −20,20 en una perdida de 20,20 — una cifra negativa no puede ser un retorno bruto. El
    // código le restaba el stake otra vez, y la primera ganada real quedó anotada como pérdida. El P&L se
    // calcula con la aritmética de la apuesta —estado de la casa × precio real × stake—, y el importe de la
    // casa se usa como CONTRASTE: si no cuadra ni como neto ni como bruto, se marca `discrepancia_importe`
    // y sale en el parte. El dinero sigue siendo el de la casa: el estado es suyo, el precio es el que ella
    // aceptó y el stake es el que ella cobró.
    const arit = pnlPorEstado(casa, stake, Number(b.odds_real || b.odds_sombra) || 1);
    let semantica = null;
    if (ret != null && Number.isFinite(ret)) {
      if (Math.abs(ret - arit) <= 0.011) semantica = 'neto';
      else if (Math.abs((ret - stake) - arit) <= 0.011) semantica = 'bruto';
    }
    if (arit != null) { b.pnl = +arit.toFixed(2); }
    else { b.pnl = ret == null ? 0 : +((ret < 0 || Math.abs(ret) < stake) ? ret : ret - stake).toFixed(2); }
    if (ret != null && !semantica) { b.discrepancia_importe = { casa: ret, aritmetica: arit, stake, estado: casa }; descuadres++; }
    b.importe_casa_semantica = semantica;
    b.fuente_estado = raw._fuente || null;
    b.resultado = casa === 'LOSS' ? 'LOSS' : casa === 'PUSH' ? 'VOID' : casa === 'WIN' ? 'WIN' : casa;

    // NUESTRO VEREDICTO SE COMPARA, NO SE USA. El dinero es el de la casa; nuestra lectura del partido sirve
    // para saber si el modelo y la realidad coinciden. Cuando no coinciden hay que mirarlo —o el liquidador
    // nuestro está mal, o la casa resolvió de otra forma— y por eso el descuadre viaja al informe en vez de
    // desaparecer detrás de un número que cuadra igual.
    const nuestro = String((resultados[b.pick_id] || {}).result_code || '').toUpperCase();
    if (nuestro && !/SUPERSEDED/.test(nuestro)) {
      const nuestroDir = nuestro === 'WIN' ? 'WIN' : nuestro === 'LOSS' ? 'LOSS' : 'VOID';
      const casaDir = b.pnl > 0.001 ? 'WIN' : b.pnl < -0.001 ? 'LOSS' : 'VOID';
      if (nuestroDir !== casaDir) { b.discrepancia = { nuestro: nuestroDir, casa: casaDir, pagado: ret, stake }; descuadres++; }
    }

    b.status = 'SETTLED';
    b.settled_at = new Date().toISOString();
    b.pagado_por_la_casa = ret;
    b.casa_estado = casa;
    b.resultado_nuestro = nuestro || null;
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
// CS2 POR EL CANAL MANUAL (25-ago, decisión de Alexis tras colocar las primeras cuatro él mismo)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// La familia cs2_rounds_v1 (hándicap de rondas, mejor cuota en Cloudbet) entra al libro real SOLO a mano
// mientras la API siga restringida. Estas filas nacen FUERA del perímetro de tarjetas a propósito: sin
// referencia y con motivo 'solo_manual', porque la API JAMÁS debe tocarlas — un hándicap de rondas no es
// soccer.total_bookings, y colocarlo por el circuito de tarjetas apostaría al mercado equivocado. El correo
// de "colocar a mano" las avisa, anotarManual las cierra con la cuota y el monto reales, y liquidar() las
// resuelve con nuestro resultado (las picks de esports ya viajan en el mapa de resultados del barrido).
// El dato que motivó todo esto queda medido en cada fila: la casa capó a Alexis a ~20 USDT por apuesta en
// estos mercados — ese techo de capacidad ES la explicación de por qué la ineficiencia sobrevive.
function crearManualCs2(sb, { stake = null } = {}) {
  if (stake == null) stake = CS2_STAKE_TOPE(); // la regla plana de $5 también al nacer la fila
  if (!sb || sb.segment !== 'cs2_rounds_v1' || sb.book !== CASA) return null;
  // la ventana de saque también aquí: esta fila no la coloca la API, pero genera el correo que le pide a
  // Alexis colocarla a mano. Una orden de no exponerse después del corte no distingue por quién aprieta el
  // botón, así que la fila no llega a nacer.
  if (fueraDeVentana(sb.kickoff_at)) return null;
  const L = load();
  if (L.bets.some((b) => b.pick_id === sb.pick_id)) return null;   // ya está en el libro
  const mapa = (m => (m ? +m[1] : null))(String(sb.pick_id).match(/_(\d)$/));
  const [homeN, awayN] = String(sb.match || ' vs ').split(' vs ');
  const equipo = sb.side === 'away' ? awayN : homeN;
  // la línea viaja en perspectiva del LOCAL: away con línea +6.5 significa que el visitante da −6.5
  const hcp = sb.side === 'away' ? -Number(sb.line) : Number(sb.line);
  const fila = {
    pick_id: sb.pick_id, shadow_id: sb.id || null,
    familia: 'CS2_RONDAS', canal: 'manual',
    match: sb.match, league: sb.league || null, mapa,
    seleccion: `${equipo} ${hcp > 0 ? '+' + hcp : hcp} rondas · mapa ${mapa != null ? mapa : '?'}`,
    line: sb.line, side: sb.side, kickoff_at: sb.kickoff_at || null,
    odds_sombra: sb.odds, model_prob: sb.model_prob != null ? sb.model_prob : null,
    stake, status: 'PENDIENTE', motivo: 'solo_manual',
    at: new Date().toISOString(), envios: 0, intentos: 0,
  };
  L.bets.push(fila);
  save();
  return fila;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// CS2 EN ENSAYO (28-ago): EL GEMELO AUTOMÁTICO, CONSTRUIDO ANTES DE PODER USARLO
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// El día que Cloudbet desbloquee la API, hoy solo tarjetas se automatiza — CS2 seguiría manual otra semana
// mientras se construye y audita su circuito. Esto lo construye AHORA: por cada fila del canal manual, el
// barrido resuelve el evento en la casa, localiza la selección exacta (mercado de hándicap de rondas del
// mapa, línea y lado de la señal) y deja el payload de colocación COMPLETO guardado en la fila — todo lo
// que placeBet necesita, verificado contra el precio vivo. Con GP_REAL_CS2_AUTO sin poner (el defecto),
// jamás se envía nada: es un ensayo. El día del desbloqueo, encender la env convierte el mismo camino
// auditado en colocación real, con el tope de ~20 USDT que la casa impone en estos mercados como techo.
// (1-sep) la casa versiona la clave: hoy es `counter_strike.map_round_handicap.v2`. El casador viejo exigía
// que terminara en `map_round_handicap` y desde el cambio NUNCA encontró una selección: todas las filas CS2
// caducaron con `linea_no_cotizada_ahora` (46 intentos en una sola fila) sin que nada avisara.
const CS2_MARKET_RE = /(^|\.)map_round_handicap(\.v\d+)?$/;
// EL LADO SE RESUELVE POR NOMBRE, NO POR POSICIÓN (1-sep). La casa reordena local/visitante en esports
// cuando el cuadro define quién es "team 1": la pick nació con Imperial de local y a la hora del partido
// Cloudbet listaba "Galorys v Imperial". Casar por `side` habría apostado al equipo contrario con el
// hándicap invertido. Se busca el EQUIPO de la señal entre los dos nombres de la casa; si no se resuelve
// sin ambigüedad, no se coloca — mejor una fila caducada que una apuesta al rival.
const normEquipo = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function ladoEnLaCasa(evRaw, equipo) {
  const q = normEquipo(equipo);
  const h = normEquipo(evRaw && evRaw.home && evRaw.home.name), a = normEquipo(evRaw && evRaw.away && evRaw.away.name);
  if (!q || (!h && !a)) return null;
  if (q === h && q !== a) return 'home';
  if (q === a && q !== h) return 'away';
  const hc = !!h && (h.includes(q) || q.includes(h)), ac = !!a && (a.includes(q) || q.includes(a));
  if (hc && !ac) return 'home';
  if (ac && !hc) return 'away';
  return null;
}
// EL TOPE CS2 ES PLANO Y BAJO (1-sep, orden de Alexis). La casa reparte límites desiguales en estos
// mercados —$4-5 casi siempre, $30-40 a veces— y eso rompe la matemática de la cartera: cuatro ganadas
// de $5 no pagan una perdida de $30. La regla nueva iguala el riesgo: TODA apuesta CS2 va a $5; si la
// casa permite menos, se coloca el máximo disponible; jamás por encima de $5. `GP_REAL_CS2_STAKE` lo
// mueve sin tocar código.
const CS2_STAKE_TOPE = () => num('GP_REAL_CS2_STAKE', 5);
// Busca la selección del hándicap de rondas en el evento CRUDO de la casa. La línea de la señal nació de
// estos mismos mercados, así que se casa EXACTA (línea, lado y mapa) — sin flips de signo: el flip es solo
// de display. Devuelve las coordenadas de colocación o null.
function selectionForCs2(evRaw, { map, line, side, equipo = null }) {
  // orientación: con `equipo` se resuelve contra los nombres de la casa; sin nombres en el evento crudo
  // (auditoría, fuente vieja) se conserva el lado tal cual. La línea viaja en perspectiva del LOCAL de la
  // señal: se pasa a la del equipo y de ahí a la del local DE LA CASA.
  let outcome = String(side), hcp = Number(line);
  const tieneNombres = !!(evRaw && ((evRaw.home && evRaw.home.name) || (evRaw.away && evRaw.away.name)));
  if (equipo && tieneNombres) {
    const lado = ladoEnLaCasa(evRaw, equipo);
    if (!lado) return null;
    const hcpEquipo = side === 'away' ? -Number(line) : Number(line);
    outcome = lado; hcp = lado === 'home' ? hcpEquipo : -hcpEquipo;
  }
  if (Object.is(hcp, -0)) hcp = 0;
  for (const [mk, m] of Object.entries((evRaw && evRaw.markets) || {})) {
    if (!CS2_MARKET_RE.test(mk) || !m || !m.submarkets) continue;
    for (const [smKey, sm] of Object.entries(m.submarkets)) {
      for (const s of ((sm && sm.selections) || [])) {
        const params = String(smKey || '') + '&' + String(s.params || '');
        const l = Number((params.match(/handicap=(-?[\d.]+)/) || [])[1]);
        if (!Number.isFinite(l) || Math.abs(l - hcp) > 1e-9) continue;
        if (map != null) {
          const pm = (params.match(/(?:^|&)map=(\d+)/) || params.match(/period=map_?(\d+)/) || [])[1];
          if (String(pm) !== String(map)) continue;
        }
        const out = String(s.outcome || '').toLowerCase();
        if (out !== outcome && !out.endsWith('=' + outcome)) continue;
        if (!(Number(s.price) > 1) || !s.marketUrl) continue;
        return { marketUrl: s.marketUrl, price: Number(s.price), lado_casa: outcome, hcp_casa: hcp,
          maxStake: Number(s.maxStake) > 0 ? Number(s.maxStake) : null,
          minStake: Number(s.minStake) > 0 ? Number(s.minStake) : null };
      }
    }
  }
  return null;
}
// ensayoCs2(fila, { eventoId, evRaw }) — arma (y guarda) el payload de colocación de una fila del canal
// manual. `evRaw` inyectable para la auditoría (sin red). Devuelve la fila; nunca lanza.
async function ensayoCs2(fila, { eventoId, evRaw = null } = {}) {
  try {
    const AUTO = String(process.env.GP_REAL_CS2_AUTO) === 'true';
    if (!fila || fila.familia !== 'CS2_RONDAS' || fila.status !== 'PENDIENTE') return fila;
    // en ensayo puro, un payload armado es el final del camino; en AUTO se REARMA en cada pasada —
    // el precio y el tope de la casa cambian, y lo que se envía tiene que ser lo recién verificado
    if (fila.ensayo_payload && !AUTO) return fila;
    const ko = fila.kickoff_at ? Date.parse(fila.kickoff_at) : null;
    if (!ko || ko <= Date.now()) return fila;                   // sin KO futuro no hay nada que ensayar
    fila.ensayo_intentos = (fila.ensayo_intentos || 0) + 1;
    if (fila.ensayo_intentos > (AUTO ? 60 : 12)) return fila;   // en AUTO se insiste hasta cerca del KO
    if (!eventoId) { fila.ensayo_motivo = 'sin_id_de_evento'; save(); return fila; }
    const ev = evRaw || await CB.eventRaw(process.env.CLOUDBET_API_KEY || '', eventoId).catch(() => null);
    if (!ev) { fila.ensayo_motivo = 'evento_ilegible'; save(); return fila; }
    const [homeN, awayN] = String(fila.match || ' vs ').split(' vs ');
    const equipo = fila.side === 'away' ? awayN : homeN;
    const sel = selectionForCs2(ev, { map: fila.mapa, line: fila.line, side: fila.side, equipo });
    if (!sel) {
      fila.ensayo_motivo = ladoEnLaCasa(ev, equipo) ? 'linea_no_cotizada_ahora' : 'equipo_no_resuelto_en_la_casa';
      fila.ensayo_casa = { home: ev.home && ev.home.name, away: ev.away && ev.away.name, mercados: Object.keys(ev.markets || {}).filter((k) => CS2_MARKET_RE.test(k)) };
      save(); return fila;
    }
    fila.ensayo_lado_casa = sel.lado_casa; fila.ensayo_hcp_casa = sel.hcp_casa;
    const C = CFG();
    // la regla plana: $5, o el máximo de la casa si es menor; jamás más (ver CS2_STAKE_TOPE)
    const tope = CS2_STAKE_TOPE();
    const stake = Math.round(Math.min(tope, sel.maxStake != null ? sel.maxStake : tope) * 100) / 100;
    if (sel.minStake != null && stake < sel.minStake) { fila.ensayo_motivo = 'minimo_de_la_casa'; save(); return fila; }
    if (!(stake > 0)) { fila.ensayo_motivo = 'sin_hueco_de_stake'; save(); return fila; }
    fila.ensayo_payload = {
      currency: C.currency, eventId: String(eventoId), marketUrl: sel.marketUrl,
      price: sel.price, stake, referenceId: refIdDe(fila.pick_id, 0),
    };
    fila.ensayo_motivo = null;
    fila.ensayo_at = new Date().toISOString();
    // LA LLAVE DEL DÍA DEL DESBLOQUEO — que llegó el 1-sep: con GP_REAL_CS2_AUTO=true el MISMO payload
    // auditado se envía de verdad por el brazo. Pasa por los MISMOS frenos de cartera que tarjetas.
    if (AUTO) {
      const L = load();
      const f = frenos(stake, fila.kickoff_at);
      if (f) { fila.ensayo_motivo = 'freno:' + f.freno; save(); return fila; }
      const r = await CB.placeBet(process.env.CLOUDBET_API_KEY || '', fila.ensayo_payload);
      fila.intentos = (fila.intentos || 0) + 1;
      fila.via = r.via || null; fila.http = r.status || null;
      const cod = String(r.betError || '').toUpperCase();
      if (cod === 'DUPLICATE_REQUEST') {
        // la casa ya tenía esta referencia: hay dinero posiblemente comprometido — no se reenvía jamás
        fila.status = 'EN_ACEPTACION'; fila.motivo = 'referencia_ya_usada'; fila.stake_comprometido = stake;
        save(); return fila;
      }
      if (r && r.ok && !/REJECTED/i.test(String(r.betStatus || (r.body || {}).status || ''))) {
        fila.status = 'PLACED'; fila.motivo = null;
        fila.odds_real = Number((r.body && r.body.price) || fila.ensayo_payload.price) || fila.ensayo_payload.price;
        fila.stake = stake;
        fila.placed_at = new Date().toISOString();
        fila.slippage_pct = fila.odds_sombra > 0 ? +(100 * (fila.odds_real / fila.odds_sombra - 1)).toFixed(2) : null;
        fila.referencia = fila.ensayo_payload.referenceId;
        // el saldo baja YA, como en tarjetas: el suelo de cartera se juzga contra lo real
        if (L.saldo && typeof L.saldo.amount === 'number') L.saldo.amount -= stake;
      } else {
        fila.ensayo_motivo = 'colocacion_rechazada';
        fila.ultimo_rechazo = cod || (r && (r.why || (r.body && r.body.status))) || 'sin_detalle';
      }
    }
    save();
    return fila;
  } catch (e) { try { fila.ensayo_motivo = 'error:' + e.message; save(); } catch { } return fila; }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// ANOTAR UNA APUESTA COLOCADA A MANO
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// La fila de esa pick ya existe en el libro —el ejecutor la intentó y la casa la rechazó por la cuenta—,
// así que anotar la colocación manual es CONVERTIR esa fila, no crear otra: se conserva todo el rastro
// (los intentos por API, el rechazo, el precio que había) y encima queda la cuota a la que Alexis entró de
// verdad. El deslizamiento contra el precio de papel se mide igual que en una apuesta automática.
function anotarManual(pickId, { odds, stake }) {
  const L = load();
  const fila = L.bets.find((b) => b.pick_id === pickId);
  if (!fila) return { error: 'no hay fila con esa pick en el libro', pick: pickId };
  if (fila.status === 'PLACED' || fila.status === 'SETTLED') return { error: 'esa fila ya está colocada o liquidada', status: fila.status };
  const o = Number(odds), st = Number(stake);
  if (!(o > 1) || !(st > 0)) return { error: 'hacen falta odds > 1 y stake > 0' };
  fila.status = 'PLACED';
  fila.via = 'manual';
  fila.motivo = null;
  fila.odds_real = o;
  fila.stake = st;
  fila.placed_at = new Date().toISOString();
  fila.slippage_pct = fila.odds_sombra > 0 ? +(100 * (o / fila.odds_sombra - 1)).toFixed(2) : null;
  const d = dia(hoy()); d.apostado += st; d.n += 1;
  if (L.saldo && typeof L.saldo.amount === 'number') { L.saldo.amount = +(L.saldo.amount - st).toFixed(2); L.saldo.estimado = true; }
  save();
  return { anotada: fila.match, linea: fila.line, odds: o, stake: st, slippage_pct: fila.slippage_pct };
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
      // el corte de saque, visible: un freno que no se ve en el panel es un freno del que nadie se acuerda
      ventana_saque: (() => { const m = ventanaMax(); return m == null ? null : new Date(m).toISOString(); })(),
      bandas_vetadas: [...bandasVetadas()],
      nocional_inicial: L.nocional_inicial, nocional_vivo: L.nocional,
      stake_tope_pct: +(C.stakePct * 100).toFixed(2), stake_max: C.stakeMax, stake_min: C.stakeMin,
      stake_plano: C.stakeFlat > 0 ? C.stakeFlat : null, stake_cs2: CS2_STAKE_TOPE(),
      exposicion_max: C.maxOpen, suelo_saldo: C.minBalance,
      parada_diaria_pct: +(C.dayStopPct * 100).toFixed(1), deslizamiento_max_pct: +(C.minOddsSlipPct * 100).toFixed(1),
    },
    saldo: L.saldo,
    cortafuegos: L.cortafuegos || null,
    rechazos_cuenta: L.rechazos_cuenta || null,
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
    // ── LAS QUE EL MODELO NO DABA POR BUENAS ───────────────────────────────────────────────────────────
    // Se apuestan igual, para que el registro real sea comparable con el de papel. Pero van contadas
    // APARTE, porque la pregunta "¿de verdad perdían?" solo se puede contestar si el subconjunto se puede
    // aislar. Dentro de un mes esto decide si se vuelven a filtrar o no, y lo decide el dato.
    por_ev: (() => {
      const grupo = (rows) => {
        const st = rows.filter((b) => b.status === 'SETTLED');
        const apostado = st.reduce((a, b) => a + (b.stake || 0), 0);
        const pl = st.reduce((a, b) => a + (b.pnl || 0), 0);
        return { colocadas: rows.length, liquidadas: st.length,
          w: st.filter((b) => b.resultado === 'WIN').length,
          apostado: +apostado.toFixed(2), pnl: +pl.toFixed(2),
          roi_pct: apostado ? +(100 * pl / apostado).toFixed(2) : null };
      };
      const con = colocadas.filter((b) => (b.ev_modelo_pct || 0) > 0);
      const sin = colocadas.filter((b) => b.ev_modelo_pct != null && b.ev_modelo_pct <= 0);
      return { con_ventaja: grupo(con), sin_ventaja: grupo(sin),
        nota: 'las de EV no positivo se apuestan a propósito, para que el registro real sea comparable con el del papel. Van aparte para poder medir si costaron dinero.' };
    })(),
    por_que_pendiente: cuenta(pendientes),
    por_que_caducada: cuenta(caducadas),
    dias: L.dias,
    ultimas: L.bets.slice(-limit).reverse(),
  };
}

module.exports = { intentar, reintentar, confirmar, colocar, anotarManual, crearManualCs2, ensayoCs2, selectionForCs2, resolverPorNombre, resolverDiag, preflight, liquidar, reliquidar, pnlPorEstado, board, refrescarSaldo, stakeDe, kellyDe, refIdDe, load, save, CFG,
  SEGMENTO, FAMILIA, LADO, CASA, LEDGER };
