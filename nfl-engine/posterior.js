// nfl-engine/posterior.js — DECIDIR CON UNA DISTRIBUCIÓN, NO CON DOS REGLAS (19-ago).
//
// LO QUE SUSTITUYE, Y POR QUÉ. Hasta hoy la casa decidía con dos reglas: `ventaja ≥ 3 pp` y
// `ventaja > incertidumbre`. Las dos son aproximaciones torpes a la misma pregunta —"¿de verdad hay
// ventaja?"— y ninguna de las dos sabe responderla, porque las dos tratan la probabilidad del modelo como
// si fuera un número exacto. No lo es: es una estimación con su propio error. Una pick debería poder decir
// "P(ventaja > 0) = 94 %" y no solo "ventaja +5,2 pp, incertidumbre ±3,4".
//
// CÓMO SE CONSTRUYE LA POSTERIOR, SIN SIMULAR MÁS. El simulador devuelve la distribución del PARTIDO dado
// un centro conocido (`marginalize:false`): eso es el azar del deporte. Nuestro error sobre dónde está ese
// centro es otra cosa y vive aparte, en puntos. Como desplazar el centro es lo mismo que desplazar la
// línea —P(M+d > L) = P(M > L−d)— basta sortear el error K veces y leer la CDF que ya está calculada. La
// posterior sale gratis: ni una simulación extra.
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

// ── LA POSTERIOR ────────────────────────────────────────────────────────────────────────────────────────
// `cdf(line)` es la función del simulador (coverProb u overProb) sobre la distribución ALEATORIA.
// `side` dice de qué lado se apuesta: la probabilidad del lado contrario es 1−p, y el empuje no es ni una
// cosa ni la otra (devuelve el stake, así que no entra en el EV con signo).
function edgePosterior({ cdf, line, side, sigmaEpi, odds, K = 512, seed = 991 }) {
  if (typeof cdf !== 'function' || !(odds > 1)) return null;
  const rnd = rng(seed);
  const ps = [], evs = [];
  const flip = side === 'away' || side === 'under' || side === 'b';
  for (let k = 0; k < K; k++) {
    // desplazar el centro d puntos = leer la CDF d puntos más abajo
    const d = gauss(rnd) * (sigmaEpi || 0);
    const r = cdf(line - d);
    if (!r || r.p == null) continue;
    const p = flip ? 1 - r.p : r.p;
    const push = r.push || 0;
    ps.push(p);
    // EV por unidad apostada, con el empuje devolviendo el stake
    evs.push((1 - push) * (p * (odds - 1) - (1 - p)));
  }
  if (ps.length < 32) return null;
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
    sigma_epi_pts: r2(sigmaEpi), draws: ps.length,
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
const DEFAULTS = { min_p_edge: 0.80, min_ev: 0.015, min_ev_p05: -0.06 };

function decide(post, cfg = {}) {
  const C = { ...DEFAULTS, ...cfg };
  if (!post) return { pass: false, checks: [{ check: 'posterior', pass: false, detail: 'sin posterior calculable' }] };
  const checks = [
    { check: 'existe_ventaja', pass: post.p_edge_gt0 >= C.min_p_edge,
      detail: `P(ventaja>0) = ${Math.round(100 * post.p_edge_gt0)} % · mínimo ${Math.round(100 * C.min_p_edge)} %` },
    { check: 'ev_esperado', pass: post.ev_mean >= C.min_ev,
      detail: `EV esperado ${(100 * post.ev_mean).toFixed(1)} % · mínimo ${(100 * C.min_ev).toFixed(1)} %` },
    { check: 'peor_caso', pass: post.ev_p05 >= C.min_ev_p05,
      detail: `EV en el percentil 5: ${(100 * post.ev_p05).toFixed(1)} % · suelo ${(100 * C.min_ev_p05).toFixed(1)} %` },
  ];
  return { pass: checks.every((x) => x.pass), checks };
}

module.exports = { edgePosterior, epistemicSigma, decide, DEFAULTS };
