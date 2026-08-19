// nfl-engine/posterior.js — DECIDIR CON UNA DISTRIBUCIÓN, NO CON DOS REGLAS (19-ago).
//
// LO QUE SUSTITUYE, Y POR QUÉ. Hasta hoy la casa decidía con dos reglas: `ventaja ≥ 3 pp` y
// `ventaja > incertidumbre`. Las dos son aproximaciones torpes a la misma pregunta —"¿de verdad hay
// ventaja?"— y ninguna de las dos sabe responderla, porque las dos tratan la probabilidad del modelo como
// si fuera un número exacto. No lo es: es una estimación con su propio error. Una pick debería poder decir
// "P(ventaja > 0) = 94 %" y no solo "ventaja +5,2 pp, incertidumbre ±3,4".
//
// CÓMO SE CONSTRUYE, Y EL ATAJO QUE NO VALE. La tentación es sortear el error del centro y releer la CDF
// ya calculada, apoyándose en que P(M+d > L) = P(M > L−d). Ese atajo exige que la distribución sea
// INVARIANTE A TRASLACIÓN, y la nuestra no lo es: desde que el atlas coloca la masa de los números clave
// en su sitio absoluto —el 3 y el 7 son el 3 y el 7, no se mueven con el favoritismo— desplazar la línea
// deja de ser lo mismo que desplazar el centro. Se probó y la posterior salía 3 pp por debajo de la
// marginal, que es otra forma de calcular lo mismo. La invarianza se rompió justo al arreglar los números
// clave, que era el arreglo bueno.
//
// Así que se hace lo correcto y se paga: se sortea el centro K veces y se SIMULA en cada uno. Cada
// simulación trae su propia banda de partidos reales, con los números clave donde de verdad están para ese
// nivel de favoritismo. Es más caro, y por eso el resultado se calcula una vez por partido y de ahí se leen
// todas las líneas y familias, en vez de una vez por mercado.
//
// QUÉ SE MIDE CON ELLA:
//   · P(ventaja > 0) — la probabilidad de que la ventaja exista, no su tamaño.
//   · EV esperado — promediado sobre la posterior, no calculado en el punto central (que es donde un
//     modelo optimista se engaña a sí mismo).
//   · EV en el percentil 5 — el peor caso razonable. Una ventaja de 6 pp con un p05 de −8 % no es la
//     misma apuesta que una de 4 pp con un p05 de −1 %, y con las reglas viejas eran indistinguibles.
//
// LO QUE ESTO NO ARREGLA, dicho aquí para que nadie lo suponga: la CALIBRACIÓN. Si el modelo dice 59 % y
// pasa el 49 %, la posterior estará centrada en el sitio equivocado y P(ventaja>0) saldrá alta y falsa.
// La posterior mide cuánto NO sabemos; no corrige lo que creemos saber mal. Eso es una capa aparte
// (isotónica ajustada fuera de muestra) y va después.
//
// PURO: sin red, sin disco, sin db.
'use strict';

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);

// PRNG determinista propio (mismo criterio que el resto de la casa: dos lecturas del mismo partido tienen
// que dar el mismo número, o el registro de la sombra deja de ser auditable)
function rng(seed) {
  let s = seed >>> 0 || 1;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function gauss(rnd) {
  const u1 = Math.max(1e-9, rnd()), u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// EL ERROR EPISTÉMICO EN PUNTOS. Dos fuentes distintas y se combinan en cuadratura:
//   · `sigmaExtra`: cuánto se aparta nuestro modelo del cierre, medido walk-forward sobre todo el histórico.
//   · `uncPts`: el castigo por muestra corta de ESTE partido (un equipo con dos jornadas no merece la misma
//     barra que uno con doce).
// Sumarlas así es LEVEMENTE CONSERVADOR —`sigmaExtra` se midió sobre un histórico que ya incluye partidos
// de muestra corta, así que algo se cuenta dos veces—. Se acepta a propósito: el error va en la dirección
// de publicar MENOS, y esta casa ya midió lo que cuesta publicar de más.
function epistemicSigma(sigmaExtra, uncPts) {
  const a = Math.max(0, +sigmaExtra || 0), b = Math.max(0, +uncPts || 0);
  return Math.sqrt(a * a + b * b);
}

// ── EL ABANICO: K simulaciones con el centro sorteado ───────────────────────────────────────────────────
// Se calcula UNA vez por partido. Cada elemento es una simulación completa en un centro posible, y de ella
// se pueden leer después todas las líneas y las dos familias sin volver a simular.
// K Y nPer, ELEGIDOS POR CONVERGENCIA, NO A OJO. La media del abanico tiene error de muestreo sobre K —con
// 48 centros el error típico es ~2 pp— y eso se ve: contra una marginal de referencia de 50,94 %, K=48 da
// 47,06 %, K=120 da 50,21 %, K=240 da 50,70 % y K=400 da 51,32 %. Que ambas converjan al mismo sitio es la
// comprobación de que la posterior y la probabilidad publicada son dos cálculos de lo mismo. K=240 con 800
// simulaciones por centro cuesta ~1,1 s por partido y ya está dentro del ruido.
function buildFan({ simulate, muMargin, muTotal, priors, sigmaM, sigmaT, K = 240, nPer = 800, seed = 991 }) {
  const rnd = rng(seed);
  const fan = [];
  for (let k = 0; k < K; k++) {
    const dm = gauss(rnd) * (sigmaM || 0);
    const dt = gauss(rnd) * (sigmaT || 0);
    const s = simulate({ muMargin: muMargin + dm, muTotal: muTotal + dt, priors,
      n: nPer, seed: (seed + k * 7919) >>> 0, marginalize: false, smooth: 0 });
    if (s) fan.push(s);
  }
  return fan;
}

// ── LA POSTERIOR ────────────────────────────────────────────────────────────────────────────────────────
// `fan` son las simulaciones del abanico. `side` dice de qué lado se apuesta: la probabilidad del contrario
// es 1−p, y el empuje no es ni una cosa ni la otra (devuelve el stake, así que no entra en el EV con signo).
function edgePosterior({ fan, family, line, side, odds }) {
  if (!Array.isArray(fan) || fan.length < 12 || !(odds > 1)) return null;
  const ps = [], evs = [];
  const flip = side === 'away' || side === 'under' || side === 'b';
  for (const s of fan) {
    const f = family === 'TOTAL' ? s.overProb : s.coverProb;
    if (typeof f !== 'function') continue;
    const r = f(line);
    if (!r || r.p == null) continue;
    const p = flip ? 1 - r.p : r.p;
    const push = r.push || 0;
    ps.push(p);
    evs.push((1 - push) * (p * (odds - 1) - (1 - p)));
  }
  if (ps.length < 12) return null;
  ps.sort((a, b) => a - b);
  const sorted = evs.slice().sort((a, b) => a - b);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const pMarket = 1 / odds;
  const pMean = mean(ps);
  // P(ventaja > 0): en cuántos de los mundos posibles nuestra probabilidad supera al precio
  const pEdge = ps.filter((x) => x > pMarket).length / ps.length;
  return {
    p_mean: r4(pMean), p_p05: r4(q(ps, 0.05)), p_p95: r4(q(ps, 0.95)),
    p_market: r4(pMarket),
    edge_pp: r2(100 * (pMean - pMarket)),
    p_edge_gt0: r3(pEdge),
    ev_mean: r4(mean(evs)), ev_p05: r4(q(sorted, 0.05)), ev_p25: r4(q(sorted, 0.25)),
    draws: ps.length,
  };
}

// ── LA DECISIÓN ─────────────────────────────────────────────────────────────────────────────────────────
// Tres condiciones, y las tres dicen algo distinto:
//   · `p_edge_gt0`: que la ventaja EXISTA con confianza, no que sea grande.
//   · `ev_mean`: que además valga la pena después del margen de la casa.
//   · `ev_p05`: que el peor caso razonable no sea una sangría. Esto es lo que las reglas viejas no miraban
//     y por lo que una ventaja enorme y frágil pasaba igual que una pequeña y sólida.
// Los cortes son declarados, no ajustados sobre el holdout: ajustarlos ahí sería elegir el umbral que mejor
// queda en la única muestra que no debe tocarse.
// LOS CORTES, DECLARADOS Y NO AJUSTADOS SOBRE EL HOLDOUT (ajustarlos ahí sería elegir el umbral que mejor
// queda en la única muestra que no debe tocarse):
//   · 75 % de P(ventaja>0): en tres de cada cuatro mundos posibles la ventaja existe.
//   · 2 % de EV esperado: que además valga la pena después del margen de la casa.
//   · el percentil 5 NO gobierna, solo avisa. Un percentil de una apuesta suelta no es una medida de riesgo
//     de cartera, y ponerle un suelo estricto convierte la compuerta en un interruptor de apagado
//     disfrazado de matemática. Se deja como guardia de catástrofe, muy abajo, y se publica siempre.
const DEFAULTS = { min_p_edge: 0.75, min_ev: 0.02, min_ev_p05: -0.35 };

function decide(post, cfg = {}) {
  const C = { ...DEFAULTS, ...cfg };
  if (!post) return { pass: false, checks: [{ check: 'posterior', pass: false, detail: 'sin posterior calculable' }] };
  const checks = [
    { check: 'existe_ventaja', pass: post.p_edge_gt0 >= C.min_p_edge,
      detail: `P(ventaja>0) = ${Math.round(100 * post.p_edge_gt0)} % · mínimo ${Math.round(100 * C.min_p_edge)} %` },
    { check: 'ev_esperado', pass: post.ev_mean >= C.min_ev,
      detail: `EV esperado ${(100 * post.ev_mean).toFixed(1)} % · mínimo ${(100 * C.min_ev).toFixed(1)} %` },
    { check: 'peor_caso', pass: post.ev_p05 >= C.min_ev_p05,
      detail: `EV en el percentil 5: ${(100 * post.ev_p05).toFixed(1)} % · guardia de catástrofe ${(100 * C.min_ev_p05).toFixed(0)} %` },
  ];
  return { pass: checks.every((x) => x.pass), checks };
}

module.exports = { buildFan, edgePosterior, epistemicSigma, decide, DEFAULTS };
