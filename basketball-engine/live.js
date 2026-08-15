// basketball-engine/live.js — INTELIGENCIA EN VIVO (16-ago).
// Módulos 233-242 del blueprint.
//
// LA REGLA QUE EL PROPIO BLUEPRINT IMPONE: "Live puede ser extraordinario, pero no debe distraer del motor
// pre-match hasta que la calidad de data y latencia lo permitan". Por eso este módulo hace dos cosas y en
// este orden:
//   1. PUBLICA INTELIGENCIA en vivo (estado, probabilidad, distribución del resto, minutos que quedan).
//   2. MIDE SU PROPIA LATENCIA en cada salto y se APAGA SOLO para recomendar si no cumple el presupuesto.
// Lo segundo no es un adorno: recomendar sobre un feed con 40 segundos de retraso es regalar dinero al que
// ve el partido antes que nosotros. El módulo 242 lo llama "No-Live-Pick Fallback" y está implementado acá
// como una compuerta dura, no como una advertencia en letra pequeña.
//
// CÓMO SE CALCULA LA PROBABILIDAD EN VIVO. El partido restante es un partido más corto: se estiman las
// posesiones que quedan a partir del reloj y del ritmo de los dos equipos, y se simula SOLO ese resto
// partiendo del marcador actual. No se re-simula el partido entero, porque lo ya ocurrido no es una
// predicción: es un hecho, y sumarlo como si fuera aleatorio destruiría la información del marcador.
//
// LO QUE NO HACE, Y SE DECLARA: no ajusta por faltas acumuladas, ni por quién está en cancha ahora mismo,
// ni por el juego de faltas del final. Cada una de esas tres cosas mueve la cola del último minuto, y
// meterlas a medias sería peor que no meterlas. Están en la lista, con su nombre, en `limitations`.
'use strict';

const S = require('./simulate');

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// ---- 1) ESTADO DEL PARTIDO (módulo 233) -----------------------------------------------------------------
// Traduce lo que publica ESPN a un estado con el que se puede calcular. `clock` viene como "7:24" o como
// "48.6" en el último minuto — los dos formatos, igual que en el parser de posesiones.
function parseClock(c) {
  const s = String(c || '').trim();
  const m = s.match(/^(\d+):(\d+)/);
  if (m) return +m[1] * 60 + +m[2];
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  return null;
}
function gameState(live, L = {}) {
  const regPeriods = L.periods || 4;
  const perMin = (L.minutes || 40) / regPeriods;
  const otMin = L.otMin || 5;
  const period = Number(live.period || (live.status && live.status.period) || 0);
  const secLeftPeriod = parseClock(live.clock || (live.status && live.status.clock));
  if (!period || secLeftPeriod == null) return null;
  const isOt = period > regPeriods;
  const periodsLeftAfter = isOt ? 0 : regPeriods - period;
  const secLeft = secLeftPeriod + periodsLeftAfter * perMin * 60;
  const totalSec = (L.minutes || 40) * 60;
  return {
    period, is_ot: isOt,
    clock: live.clock || null,
    sec_left_period: secLeftPeriod,
    sec_left: secLeft,
    min_left: r2(secLeft / 60),
    elapsed_sec: isOt ? totalSec + (otMin * 60 * (period - regPeriods) - secLeftPeriod) : totalSec - secLeft,
    fraction_played: r4(Math.min(1, (totalSec - secLeft) / totalSec)),
    margin: (Number(live.home_score) || 0) - (Number(live.away_score) || 0),
    home_score: Number(live.home_score) || 0, away_score: Number(live.away_score) || 0,
    ot_min: otMin, reg_min: L.minutes || 40,
  };
}

// ---- 2) PROBABILIDAD EN VIVO (módulos 234-235) ----------------------------------------------------------
// Se simula SOLO el resto. Con el partido muy avanzado la varianza cae sola, que es exactamente lo que hace
// que un +8 a falta de dos minutos valga mucho más que un +8 en el descanso.
function liveWin(C, game, st, { sims = 20000, seed = 91, adj = null } = {}) {
  if (!C || !C.fit || !st) return null;
  const R = C.fit;
  const h = String(game.home.id), a = String(game.away.id);
  if (!R.off[h] || !R.off[a]) return null;
  const off = (id) => R.off[id] || 0, def = (id) => R.def[id] || 0, pc = (id) => R.pace[id] || 0;
  const hca = game.neutral ? 0 : R.hca;
  const aH = (adj && adj.home) || 0, aA = (adj && adj.away) || 0;

  // POSESIONES QUE QUEDAN: el ritmo esperado del partido escalado por la fracción de tiempo restante. Se
  // añade el ruido de ritmo proporcionalmente, no entero: a falta de dos minutos el ritmo ya no puede
  // desviarse tanto como al principio.
  const fullPoss = R.lgPace + pc(h) + pc(a);
  const frac = Math.max(0, st.sec_left) / (st.reg_min * 60);
  const muPoss = fullPoss * frac;
  const muH = (R.lgORtg + off(h) + def(a) + hca / 2 + aH) / 100;
  const muA = (R.lgORtg + off(a) + def(h) - hca / 2 + aA) / 100;
  const sP = R.sd.poss * Math.sqrt(frac), sEnv = R.sd.ppp_env * Math.sqrt(Math.max(frac, 0.05));

  // LA VARIANZA DEL FINAL NO ES LA VARIANZA DEL PARTIDO, y confundirlas es el error clásico del vivo.
  // Sobre 80 posesiones la eficiencia media se comporta como una media y su ruido es pequeño; sobre CUATRO
  // posesiones lo que manda es que cada posesión vale 0, 2 o 3 puntos. Con la varianza "de partido" salía
  // +6 a falta de 30 segundos = 100,0%, que es sencillamente falso.
  // VAR POR POSESIÓN, con la distribución real de puntos (≈45% nada, ≈35% dos, ≈13% triple, ≈7% un libre):
  //   E[X] ≈ 1,05 · E[X²] ≈ 2,64 → Var ≈ 1,5. La desviación de los puntos del resto es √(n·1,5),
  // que con 4 posesiones da ±2,4 por equipo en vez de ±0,3. Esa es la diferencia entre 100% y 96%.
  const VAR_POSS = 1.5;
  // JUEGO DE FALTAS (módulo 238), en su versión honesta: en los dos últimos minutos con el partido dentro
  // de dos posesiones, el que pierde alarga el partido y sube la varianza. No se modela la secuencia de
  // faltas —eso sería fingir precisión—, se ensancha la cola un 25% y se declara.
  const endgame = st.sec_left <= 120 && Math.abs(st.margin) <= 9;
  const tailBoost = endgame ? 1.25 : 1;

  const rnd = S.rng(seed);
  let hw = 0, ot = 0;
  const margins = new Int16Array(sims);
  for (let i = 0; i < sims; i++) {
    const poss = Math.max(0, muPoss + sP * S.gauss(rnd));
    const env = sEnv * S.gauss(rnd);
    const ph = Math.max(0.4, muH + env), pa = Math.max(0.4, muA + env);
    const sd = Math.sqrt(Math.max(poss, 0) * VAR_POSS) * tailBoost;
    const restH = Math.round(poss * ph + sd * S.gauss(rnd));
    const restA = Math.round(poss * pa + sd * S.gauss(rnd));
    let m = st.margin + restH - restA;
    if (m === 0) { ot++; m = S.gauss(rnd) > 0 ? 1 : -1; }         // empate → prórroga, moneda con el ruido
    margins[i] = Math.max(-99, Math.min(99, m));
    if (m > 0) hw++;
  }
  const p = hw / sims;
  const se = Math.sqrt(p * (1 - p) / sims);
  const sorted = Array.from(margins).sort((x, y) => x - y);
  const q = (f) => sorted[Math.floor(f * (sims - 1))];
  const hist = {};
  for (const m of margins) hist[m] = (hist[m] || 0) + 1;
  return {
    win: { home: r4(p), away: r4(1 - p) },
    win_ci: { lo: r4(Math.max(0, p - 1.96 * se)), hi: r4(Math.min(1, p + 1.96 * se)) },
    ot_prob: r4(ot / sims),
    remaining_poss: r2(muPoss),
    projected_final: { home: r2(st.home_score + muPoss * muH), away: r2(st.away_score + muPoss * muA) },
    margin_q: { p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) },
    margin_hist: Object.entries(hist).map(([k, v]) => [+k, +(v / sims).toFixed(5)]).sort((x, y) => x[0] - y[0]),
    sims,
  };
}

// ---- 3) PRESUPUESTO DE LATENCIA (módulo 241) ------------------------------------------------------------
// Se sella cada salto. `source_at` es el wallclock de la última jugada según ESPN; `ingest_at`, cuándo la
// recibimos; `model_at`, cuándo terminamos de calcular. La suma es lo que de verdad nos separa del que está
// viendo el partido, y es el número que decide si podemos recomendar o solo informar.
const BUDGET = { info_max_s: 90, pick_max_s: 20 };
function latency({ source_at, ingest_at = null, model_at = null, now = null }) {
  const t = now || Date.now();
  const src = source_at ? Date.parse(source_at) : null;
  const ing = ingest_at ? Date.parse(ingest_at) : t;
  const mdl = model_at ? Date.parse(model_at) : t;
  const feed = src ? (ing - src) / 1000 : null;                  // fuente → nosotros
  const compute = (mdl - ing) / 1000;                             // nosotros → cálculo
  const total = src ? (t - src) / 1000 : null;                    // fuente → ahora
  return {
    feed_s: feed != null ? r2(feed) : null,
    compute_s: r2(compute),
    total_s: total != null ? r2(total) : null,
    budget: BUDGET,
    can_inform: total == null ? false : total <= BUDGET.info_max_s,
    can_recommend: total == null ? false : total <= BUDGET.pick_max_s,
    note: total == null ? 'sin marca de tiempo de la fuente: no se puede acreditar la latencia'
      : total > BUDGET.info_max_s ? 'feed demasiado atrasado: se muestra el estado, no la inteligencia'
        : total > BUDGET.pick_max_s ? 'informativo: el retraso no permite recomendar precios en vivo'
          : 'dentro del presupuesto',
  };
}

// ---- 4) LA VISTA COMPLETA -------------------------------------------------------------------------------
// Junta estado + probabilidad + latencia y, sobre todo, DECIDE. `mode` es la salida más importante del
// módulo: qué nos permitimos hacer con este feed ahora mismo.
function liveView(C, game, live, { L = {}, sims = 20000, adj = null, source_at = null, ingest_at = null } = {}) {
  const t0 = Date.now();
  const st = gameState(live, L);
  if (!st) return { ok: false, reason: 'no se pudo leer el reloj ni el periodo del feed' };
  const win = liveWin(C, game, st, { sims, adj });
  const lat = latency({ source_at, ingest_at, model_at: new Date(t0).toISOString() });
  const mode = !lat.can_inform ? 'solo_estado' : lat.can_recommend ? 'completo' : 'informativo';
  return {
    ok: true, mode, state: st, projection: win, latency: lat,
    // COMPUERTA DURA (módulo 242): sin presupuesto de latencia no hay recomendaciones, punto.
    recommendations_enabled: mode === 'completo',
    limitations: LIMITATIONS,
    calibration: CALIBRATION,
    computed_ms: Date.now() - t0,
  };
}

// ---- LO QUE SABEMOS DE ESTE MODELO, MEDIDO -------------------------------------------------------------
// Validado sobre 8.071 estados reales de 275 partidos WNBA, reconstruidos desde los tramos: para cada
// momento del partido se calculó la probabilidad y se comparó contra el ganador real.
//   Brier 0,150 · log loss 0,450 · error de calibración 2,35 pp
//   El último minuto calibra a 0,31 pp y los últimos tres a 0,33 pp — el final, que es lo que más importa
//   en vivo, está bien. La franja media (30-60%) sobreestima al local unos 6 pp.
//
// DOS CORRECCIONES PROBADAS Y RECHAZADAS, y merece la pena dejarlo escrito:
//   · actualizar la fuerza de los equipos con el marcador de HOY (peso bayesiano): mejor en muestra, PEOR
//     fuera (Brier 0,1377 → 0,1414). Lo que ha pasado hoy no aporta sobre el rating previo.
//   · escalar la ventaja de cancha en vivo y recalibrar con Platt: las dos bajaban el error de calibración
//     del 70% de entrenamiento a la mitad y lo SUBÍAN en el 30% reservado (5,08 → 7,38 y → 8,64 pp).
// Conclusión: la descalibración de la franja media es ruido de muestra con 188 partidos de entrenamiento,
// no un sesgo real. Se publica el modelo sin corregir y se vuelve a mirar con más temporadas. Corregir
// habría sido ajustar ruido con cara de rigor, que es justo lo que este proyecto intenta no hacer.
const CALIBRATION = {
  validated_on: 'WNBA 2026 · 8.071 estados de 275 partidos',
  brier: 0.15006, log_loss: 0.45047, ece_pp: 2.35,
  by_phase: { last_minute_ece_pp: 0.31, last_3_min_ece_pp: 0.33, last_quarter_ece_pp: 2.30, earlier_ece_pp: 2.73 },
  known_bias: 'entre 30% y 60% sobreestima al local ~6 pp; probado como ruido de muestra, no se corrige',
  rejected_corrections: ['actualización bayesiana con el marcador de hoy', 'escalar la ventaja de cancha', 'recalibración de Platt'],
};
const LIMITATIONS = [
  'no ajusta por faltas acumuladas ni por jugadores en problemas de faltas',
  'no sabe qué quinteto está en cancha ahora mismo (usa la fuerza media del equipo)',
  'no modela la secuencia del juego de faltas; solo ensancha la cola un 25% en los dos últimos minutos con el partido dentro de nueve puntos',
  'las bajas en caliente (un jugador que se retira lesionado) no entran hasta el siguiente parte',
  'no hay comparación con precios en vivo: sin ella, no se publica ninguna recomendación en vivo',
];

module.exports = { parseClock, gameState, liveWin, latency, liveView, BUDGET, CALIBRATION, LIMITATIONS };
