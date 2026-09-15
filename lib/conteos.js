// lib/conteos.js — LEYES DE CONTEO Y CÓMO SE PUNTÚAN (15-sep-2026, Fase 2 de la auditoría externa).
//
// Por qué existe: la auditoría (§4.3) exige que cualquier modelo de conteo —tarjetas, córners, kills,
// puntos, 180s— se mida contra COMPETIDORES OBLIGATORIOS y no contra sí mismo. Hasta hoy el repo solo
// sabía escribir una Binomial Negativa (`goal-engine/negativeBinomial.js`) y compararla con "el mercado".
// Un modelo que gana a nada no ha ganado nada.
//
// Aquí vive la parte PURA y compartible: cuatro leyes que compiten con la MISMA media, y las tres formas
// de puntuar una distribución de conteo contra el resultado que de verdad ocurrió. Sin I/O, sin red, sin
// estado. Cualquier deporte puede importarlo.
//
// UNA ADVERTENCIA DE MÉTODO. Las cuatro leyes reciben la media ya estimada y NO la vuelven a estimar: eso
// es deliberado. Si cada ley eligiera su propia media, la comparación mediría dos cosas a la vez (el nivel
// y la forma) y no se sabría cuál de las dos ganó. El nivel se decide fuera, en el challenger; aquí solo
// se compara la FORMA de la cola, que es exactamente lo que paga o no paga un under a 5,5.
'use strict';

const KMAX = 25;                 // ningún partido de fútbol llega a 25 tarjetas; la cola de arriba se agrega en KMAX
const EPS = 1e-12;

// ── log-gamma (Lanczos) — la misma que usa goal-engine/negativeBinomial.js ─────────────────────────────
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) { y += 1; ser += g[j] / y; }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
const lfact = (k) => lgamma(k + 1);

// Normaliza y tapa el suelo: una pmf con un cero exacto da log-score infinito y una sola observación
// rara destruye la comparación. El suelo es 1e-12, no una constante grande: no queremos "suavizar" a
// escondidas una ley que de verdad asigna casi nada a la cola.
function normaliza(p) {
  let s = 0;
  for (let k = 0; k < p.length; k++) { if (!(p[k] > 0)) p[k] = EPS; s += p[k]; }
  if (!(s > 0)) return p.map(() => 1 / p.length);
  return p.map((x) => x / s);
}

// ── LAS CUATRO LEYES ──────────────────────────────────────────────────────────────────────────────────
// Todas devuelven un array pmf de longitud kmax+1 donde la última casilla ACUMULA la cola (P(X ≥ kmax)).

// 1. Poisson. El competidor mínimo: media = varianza. Si una ley elaborada no le gana, no hay señal de forma.
function poisson(mu, kmax = KMAX) {
  const m = Math.max(EPS, mu), p = new Array(kmax + 1).fill(0);
  let acc = 0;
  for (let k = 0; k < kmax; k++) { p[k] = Math.exp(-m + k * Math.log(m) - lfact(k)); acc += p[k]; }
  p[kmax] = Math.max(0, 1 - acc);
  return normaliza(p);
}

// 2. Binomial Negativa por media y dispersión r (var = μ + μ²/r). Es la que usa el modelo actual.
function nb(mu, r, kmax = KMAX) {
  const m = Math.max(EPS, mu), rr = Math.max(0.05, r), p = new Array(kmax + 1).fill(0);
  const q = rr / (rr + m);
  let acc = 0;
  for (let k = 0; k < kmax; k++) {
    p[k] = Math.exp(lgamma(k + rr) - lgamma(rr) - lfact(k) + rr * Math.log(q) + k * Math.log(1 - q));
    acc += p[k];
  }
  p[kmax] = Math.max(0, 1 - acc);
  return normaliza(p);
}

// r por método de momentos. var ≤ μ → no hay sobredispersión y r se va al tope (≈ Poisson).
function rDeMomentos(mu, varianza, { min = 0.5, max = 400 } = {}) {
  if (!(varianza > mu) || !(mu > 0)) return max;
  return Math.max(min, Math.min(max, (mu * mu) / (varianza - mu)));
}

// 3. COM-Poisson: P(k) ∝ λ^k / (k!)^ν. ν = 1 es Poisson; ν < 1 sobredispersa, ν > 1 SUBdispersa.
// Por qué importa para tarjetas: la Binomial Negativa SOLO puede sobredispersar. Si el conteo real está
// más apretado que un Poisson —y en ligas con árbitro estricto y pocas faltas puede estarlo— la NB no
// tiene forma de representarlo y paga ese error justo en la cola donde vive el under.
// Ajuste: para cada ν se resuelve λ que reproduce la media objetivo (bisección, la media es monótona en λ),
// y se elige el ν cuya varianza se acerca más a la observada.
function comPmf(lambda, nu, kmax) {
  const p = new Array(kmax + 1).fill(0);
  let s = 0;
  const ll = Math.log(Math.max(EPS, lambda));
  for (let k = 0; k <= kmax; k++) { p[k] = Math.exp(k * ll - nu * lfact(k)); s += p[k]; }
  for (let k = 0; k <= kmax; k++) p[k] /= (s || 1);
  return p;
}
function momentosDePmf(p) {
  let m = 0, m2 = 0;
  for (let k = 0; k < p.length; k++) { m += k * p[k]; m2 += k * k * p[k]; }
  return { media: m, varianza: Math.max(0, m2 - m * m) };
}
function lambdaParaMedia(nu, objetivo, kmax) {
  let lo = 1e-6, hi = Math.max(2, objetivo + 10);
  for (let i = 0; i < 80; i++) {            // la media de COM es creciente en λ → bisección segura
    if (momentosDePmf(comPmf(hi, nu, kmax)).media >= objetivo) break;
    hi *= 2; if (hi > 1e8) break;
  }
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (momentosDePmf(comPmf(mid, nu, kmax)).media < objetivo) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}
const NU_GRID = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6, 2.0];
function comPoisson(mu, varianza, kmax = KMAX) {
  const m = Math.max(EPS, mu);
  let mejor = null;
  for (const nu of NU_GRID) {
    const lam = lambdaParaMedia(nu, m, kmax);
    const mm = momentosDePmf(comPmf(lam, nu, kmax));
    const err = Math.abs(mm.varianza - varianza);
    if (!mejor || err < mejor.err) mejor = { err, lam, nu };
  }
  return { pmf: normaliza(comPmf(mejor.lam, mejor.nu, kmax)), nu: mejor.nu, lambda: mejor.lam };
}

// 4. Histograma suavizado y REESCALADO a la media objetivo. El competidor no paramétrico: si la forma
// empírica cruda le gana a las tres leyes, es que la familia paramétrica sobra.
// Suavizado: mezcla con un Poisson de la misma media, peso alfa/(alfa+n). Reescalado a la media objetivo:
// se inclina el histograma por exp(θ·k) (inclinación exponencial) resolviendo θ por bisección, para que
// compita con EXACTAMENTE la misma media que las otras tres y la comparación siga siendo solo de forma.
function histograma(muestras, { pesos = null, mu = null, alfa = 20, kmax = KMAX } = {}) {
  const h = new Array(kmax + 1).fill(0);
  let n = 0;
  for (let i = 0; i < muestras.length; i++) {
    const k = Math.max(0, Math.min(kmax, Math.round(muestras[i])));
    const w = pesos ? pesos[i] : 1;
    h[k] += w; n += w;
  }
  if (!(n > 0)) return poisson(mu != null ? mu : 1, kmax);
  const emp = h.map((x) => x / n);
  const objetivo = mu != null ? mu : momentosDePmf(emp).media;
  const pri = poisson(objetivo, kmax);
  const w = n / (n + alfa);
  const mez = emp.map((x, k) => w * x + (1 - w) * pri[k]);
  return normaliza(inclina(mez, objetivo, kmax));
}

// Inclinación exponencial: q(k) ∝ p(k)·e^{θk}, θ tal que E_q[k] = objetivo. Es la forma canónica de mover
// la media de una distribución empírica sin deformar su forma más de lo imprescindible.
function inclina(p, objetivo, kmax) {
  const media = (th) => {
    let s = 0, m = 0;
    for (let k = 0; k <= kmax; k++) { const v = p[k] * Math.exp(th * k); s += v; m += k * v; }
    return s > 0 ? m / s : 0;
  };
  if (!(objetivo > 0)) return p;
  let lo = -6, hi = 6;
  if (media(lo) > objetivo) return p.map((x, k) => x * Math.exp(lo * k));
  if (media(hi) < objetivo) return p.map((x, k) => x * Math.exp(hi * k));
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (media(mid) < objetivo) lo = mid; else hi = mid;
  }
  const th = 0.5 * (lo + hi);
  return p.map((x, k) => x * Math.exp(th * k));
}

// ── CÓMO SE PUNTÚA ────────────────────────────────────────────────────────────────────────────────────
// log-score: −log p(y). Premia la probabilidad puesta exactamente donde cayó el resultado. Es la regla
// propia estricta estándar; menor es mejor.
function logScore(pmf, y) {
  const k = Math.max(0, Math.min(pmf.length - 1, Math.round(y)));
  return -Math.log(Math.max(EPS, pmf[k]));
}

// CRPS discreto: Σ_k (F(k) − 1{k ≥ y})². A diferencia del log-score, penaliza la DISTANCIA del error:
// predecir 3 cuando salen 4 duele menos que predecir 3 cuando salen 9. Para un under a 5,5 eso es lo que
// importa. Menor es mejor.
function crps(pmf, y) {
  const yy = Math.max(0, Math.min(pmf.length - 1, Math.round(y)));
  let F = 0, s = 0;
  for (let k = 0; k < pmf.length; k++) {
    F += pmf[k];
    const ind = k >= yy ? 1 : 0;
    s += (F - ind) * (F - ind);
  }
  return s;
}

// P(X > línea) para líneas .5 (sin empate). Es la probabilidad que de verdad se cotiza.
function pOver(pmf, linea) {
  let u = 0;
  for (let k = 0; k <= Math.floor(linea); k++) u += pmf[k];
  return Math.max(0, Math.min(1, 1 - u));
}

// Media y varianza ponderadas de una muestra. Peso = decaimiento temporal; la varianza usa la corrección
// de Bessel efectiva (n_ef = (Σw)²/Σw²) porque con pesos el divisor n−1 ya no significa nada.
function momentos(muestras, pesos = null) {
  let sw = 0, sw2 = 0, s = 0;
  for (let i = 0; i < muestras.length; i++) { const w = pesos ? pesos[i] : 1; sw += w; sw2 += w * w; s += w * muestras[i]; }
  if (!(sw > 0)) return { media: 0, varianza: 0, n_ef: 0 };
  const media = s / sw;
  let sq = 0;
  for (let i = 0; i < muestras.length; i++) { const w = pesos ? pesos[i] : 1; const d = muestras[i] - media; sq += w * d * d; }
  const nEf = (sw * sw) / (sw2 || 1);
  const varianza = nEf > 1 ? (sq / sw) * (nEf / (nEf - 1)) : sq / sw;
  return { media, varianza, n_ef: nEf };
}

module.exports = {
  KMAX, poisson, nb, comPoisson, histograma, rDeMomentos,
  logScore, crps, pOver, momentos, momentosDePmf, lgamma, normaliza,
};
