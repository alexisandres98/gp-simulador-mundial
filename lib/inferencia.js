// lib/inferencia.js — LA INCERTIDUMBRE, MEDIDA COMO SI LOS TICKETS NO FUERAN INDEPENDIENTES (15-sep)
//
// Por qué existe (A30 de la auditoría externa del 15-sep). Todos los tracks de la casa —clubes, derivadas,
// esports, props, hoops, NFL, NCAAF, tenis, TT, dardos, combate, F1— calculan su t dividiendo la media por
// `sd/√n_tickets`. Esa fórmula supone que cada ticket es una observación NUEVA, y aquí no lo es:
//
//   · las catorce derivadas de mitad del MISMO partido se liquidan con el MISMO marcador;
//   · under 4,5 y under 5,5 de las mismas tarjetas ganan y pierden a la vez (ya nos costó −17,63 % de ROI
//     apilando líneas del mismo partido, ver la doctrina del ejecutor);
//   · los mapas 1 y 2 de la MISMA serie de CS2 los juega el mismo equipo el mismo día;
//   · las piernas de un slate de props comparten jugador, mapa y estado de forma.
//
// Cuando las filas van en racimo, `√n` cuenta racimos como si fueran tiradas sueltas y el error estándar sale
// pequeño de mentira: un t de 3 que en realidad es un t de 0,7. Ese es EL error que este módulo existe para
// impedir, y no es teórico: con 10 racimos de 20 filas iguales el t ingenuo sale √20 = 4,5 veces más grande
// que el honesto (está en `tests/inferencia.test.js`, comprobación 2).
//
// Las cuatro piezas, y las cuatro hacen falta:
//   · REMUESTREO POR CLUSTERS — se remuestrean RACIMOS con reemplazo, no filas. El racimo es el evento:
//     partido en fútbol y TT, serie en esports, carrera en F1, jornada en un slate. Cada track dice cuál es
//     el suyo; el módulo no lo adivina.
//   · ROI COMO COCIENTE — el ROI es Σbeneficio / Σstake, no la media de los ROI por ticket. Hay que
//     remuestrear beneficio y stake JUNTOS y recalcular el cociente en cada réplica. Promediar ROI por
//     ticket da otra cifra y otro intervalo, y con stakes desiguales ni siquiera converge al ROI real.
//   · BENJAMINI-HOCHBERG — juzgamos decenas de familias a la vez. Con 40 familias muertas, dos salen con
//     p < 0,05 SOLO por mirar cuarenta veces. BH controla la proporción de falsos hallazgos entre las que
//     declaramos vivas, que es exactamente la pregunta de "¿cuál de estas familias es invertible?".
//   · POTENCIA — para poder decir "faltan N observaciones" con un número detrás. A cuota 1,91 y un ROI
//     verdadero del 2 %, hacen falta ~17.800 apuestas para detectarlo: el 20-oct con 100 liquidadas es un
//     control operativo, no una certificación (§5.3 de la auditoría).
//
// Lo que este módulo NO hace: no decide. No sustituye a `lib/vara.js` (esa dice si una familia es
// invertible) ni a `lib/margen.js` (esa mide lo que cobra la casa). Aquí solo se pone la barra de error
// correcta alrededor de un número que ya está calculado. Un intervalo honesto que contiene el cero no es un
// fracaso del módulo: es la respuesta.
//
// Sin dependencias. Aleatoriedad propia y SEMBRADA — `Math.random` haría que el mismo libro diera dos
// veredictos distintos en dos llamadas, y eso es indefendible en un informe.
'use strict';

// ══ 1. ARITMÉTICA BÁSICA ═══════════════════════════════════════════════════════════════════════════════
const finitos = (a) => (a || []).filter((x) => Number.isFinite(x));
const suma = (a) => a.reduce((x, y) => x + y, 0);
const media = (a) => (a.length ? suma(a) / a.length : null);
// desviación MUESTRAL (n−1): el divisor n subestima la dispersión, y subestimar dispersión es justo el
// pecado de este módulo.
function sd(a) { if (a.length < 2) return null; const m = media(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(6) : null);

// ══ 2. NORMAL: CDF Y CUANTIL ═══════════════════════════════════════════════════════════════════════════
// Φ(x) por la aproximación racional de erfc (Abramowitz-Stegun 7.1.26 extendida, Numerical Recipes):
// error absoluto < 1,2e−7, de sobra para p-valores que se leen a tres decimales.
function normalCdf(x) {
  if (!Number.isFinite(x)) return NaN;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const y = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  const erfc = x >= 0 ? y : 2 - y;      // erfc(−u) = 2 − erfc(u)
  return 1 - 0.5 * erfc;
}

// Cuantil normal (inversa de Φ) por el algoritmo racional de Acklam, error relativo < 1,2e−9.
function normalInv(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pb = 0.02425;
  let q, r;
  if (p < pb) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pb) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// z bilateral para un nivel alfa. alfa = 0,05 → 1,959964.
const zBilateral = (alfa) => normalInv(1 - alfa / 2);

// ══ 3. MEDIA CON INTERVALO ═════════════════════════════════════════════════════════════════════════════
// APROXIMACIÓN DOCUMENTADA: el intervalo usa el cuantil NORMAL (1,96 al 95 %) en vez del de Student con
// n−1 grados de libertad. Con n ≥ 60 la diferencia es < 1,7 % de la semiamplitud y no cambia ninguna
// decisión. Con n pequeño el intervalo sale DEMASIADO ESTRECHO: a n = 11 (gl 10) el t real es 2,228 y el
// normal 1,960, o sea un 12 % de menos; a n = 31 (gl 30) un 4 % de menos. Por eso `mediaIC` devuelve
// también `n` y `gl`, y por eso el veredicto de una familia con n < 100 es "muestra corta" (`lib/vara.js`)
// antes de mirar el intervalo. Si algún día hace falta el intervalo exacto con n < 30, el sitio es aquí y
// la pieza que falta es el cuantil de Student, no un parche en el track que llame.
function mediaIC(valores, { alfa = 0.05 } = {}) {
  const a = finitos(valores);
  const n = a.length;
  if (n < 2) return { n, gl: Math.max(0, n - 1), media: n ? a[0] : null, sd: null, se: null, t: null, ic: [null, null], alfa };
  const m = media(a), s = sd(a), se = s / Math.sqrt(n);
  const z = zBilateral(alfa);
  // misma guarda que en el bootstrap: con todos los valores iguales el `se` es ruido de coma flotante y el
  // cociente sale con t de 10^14. Un t nulo dice "no se puede saber"; un t de 10^14 dice una mentira.
  const seUtil = se > Math.max(Math.abs(m), 1e-12) * 1e-9;
  return { n, gl: n - 1, media: r4(m), sd: r4(s), se: r4(se), t: seUtil ? r4(m / se) : null,
    ic: seUtil ? [r4(m - z * se), r4(m + z * se)] : [null, null], alfa, aprox: 'cuantil normal, no Student',
    ...(se > 0 && !seUtil ? { aviso_t: 'todos los valores son iguales: el t no significa nada y se devuelve nulo' } : {}) };
}

// ══ 4. AZAR REPRODUCIBLE ═══════════════════════════════════════════════════════════════════════════════
// Generador congruencial de Lehmer (Park-Miller mínimo estándar): s ← 16807·s mod (2³¹−1). Se elige este y
// no el clásico de multiplicador grande porque 16807·(2³¹−1) ≈ 3,6e13 cabe entero en un double (< 2⁵³) y el
// resultado es EXACTO: la misma semilla da la misma secuencia en cualquier máquina y en cualquier versión
// de Node. Periodo 2³¹−2 ≈ 2,1e9, de sobra para 2.000 réplicas × unos miles de racimos.
// No es criptográfico ni pretende serlo; para remuestrear índices es más que suficiente.
function generador(semilla = 42) {
  let s = Math.floor(Math.abs(Number(semilla) || 0)) % 2147483646 + 1;   // 1..2147483646, nunca 0
  return () => { s = (16807 * s) % 2147483647; return (s - 1) / 2147483646; };  // [0,1)
}

// Percentil por interpolación lineal sobre una muestra YA ORDENADA.
function percentil(ordenada, p) {
  if (!ordenada.length) return null;
  if (ordenada.length === 1) return ordenada[0];
  const i = (ordenada.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? ordenada[lo] : ordenada[lo] + (i - lo) * (ordenada[hi] - ordenada[lo]);
}

// Agrupa filas por clave de racimo conservando el orden de aparición.
function agrupa(items, cluster) {
  const idx = new Map();
  (items || []).forEach((it, i) => {
    const k = cluster ? cluster(it, i) : i;
    const key = (k === null || k === undefined || k === '') ? `__fila_${i}` : String(k);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(it);
  });
  return [...idx.values()];
}

// ══ 5. BOOTSTRAP POR CLUSTERS ══════════════════════════════════════════════════════════════════════════
// Se remuestrean RACIMOS ENTEROS con reemplazo (cluster bootstrap / "block bootstrap" no solapado). En cada
// réplica se toman tantos racimos como racimos hay, con sus filas dentro, y se promedian TODAS las filas
// resultantes. El error estándar es la desviación de las réplicas; el intervalo, los percentiles.
//
// Detalle que importa: NO se remuestrea dentro del racimo. Si se hiciera, volveríamos a suponer que las
// filas de un mismo partido son independientes entre sí — que es el error que venimos a matar.
//
// Si todos los racimos tienen una fila, esto converge al error estándar clásico `sd/√n` (comprobación 1 del
// test). Si los racimos son grandes y homogéneos, sale mucho mayor, y ESE es el número honesto.
function bootstrapClusters(items, { valor, cluster, replicas = 2000, semilla = 42, alfa = 0.05 } = {}) {
  const v = valor || ((x) => x);
  const grupos = agrupa(items, cluster)
    .map((g) => finitos(g.map(v)))
    .filter((g) => g.length);
  const nClusters = grupos.length;
  const nItems = suma(grupos.map((g) => g.length));
  const base = { n_items: nItems, n_clusters: nClusters, replicas, semilla, alfa };
  if (!nClusters) return { ...base, media: null, se: null, ic: [null, null], t: null };

  const sumas = grupos.map((g) => suma(g));
  const tam = grupos.map((g) => g.length);
  const mediaObs = suma(sumas) / nItems;
  if (nClusters < 2) {
    return { ...base, media: r4(mediaObs), se: null, ic: [null, null], t: null,
      aviso: 'un solo racimo: no hay variación entre racimos que remuestrear' };
  }

  const rnd = generador(semilla);
  const reps = new Array(replicas);
  for (let r = 0; r < replicas; r++) {
    let s = 0, c = 0;
    for (let k = 0; k < nClusters; k++) {
      const j = Math.floor(rnd() * nClusters) % nClusters;
      s += sumas[j]; c += tam[j];
    }
    reps[r] = c ? s / c : NaN;             // la media de la réplica pesa por filas, como la observada
  }
  const ok = finitos(reps).sort((a, b) => a - b);
  const se = sd(ok);
  // UN ERROR ESTÁNDAR DE CERO NO ES UNA CERTEZA ABSOLUTA (15-sep). `se > 0` no basta como guarda: cuando
  // todas las filas valen lo mismo —EV idéntico ticket a ticket, o un solo valor repetido— el bootstrap
  // devuelve un `se` del orden de 1e-16 y el cociente sale con t de 10^14. Eso no es significación, es
  // aritmética de coma flotante, y un veredicto o una línea de parada construidos encima se disparan solos.
  // El umbral es RELATIVO a la escala de lo que se mide, no absoluto: con EV en puntos porcentuales y con
  // EV en fracciones el ruido numérico vive en órdenes distintos.
  const escala = Math.max(Math.abs(mediaObs), 1e-12);
  const seUtil = se > escala * 1e-9;
  return { ...base, media: r4(mediaObs), se: r4(se),
    ic: [r4(percentil(ok, alfa / 2)), r4(percentil(ok, 1 - alfa / 2))],
    t: seUtil ? r4(mediaObs / se) : null,
    ...(se > 0 && !seUtil ? { aviso_t: 'todas las réplicas dan la misma media: sin variación entre racimos el t no significa nada y se devuelve nulo' } : {}),
    tam_medio_cluster: r4(nItems / nClusters),
    ...(nClusters === nItems ? { aviso: 'cada fila es su propio racimo: o no hay correlación, o falta la función `cluster`' } : {}) };
}

// ══ 6. ROI CON INTERVALO (EL COCIENTE, NO EL PROMEDIO) ═════════════════════════════════════════════════
// El ROI de un libro es Σbeneficio / Σstake. Promediar el ROI de cada ticket da OTRA cosa: con stakes
// desiguales (Kelly, topes por exposición, stake plano cambiado a mitad de temporada) ni siquiera tiende al
// ROI real, porque pondera igual una apuesta de 5 y una de 40. Por eso aquí se remuestrean beneficio y
// stake JUNTOS, por racimo, y se recalcula el cociente entero en cada réplica: así el intervalo hereda
// tanto la correlación dentro del partido como la desigualdad de tamaños.
function roiIC(items, { beneficio, stake, cluster, replicas = 2000, semilla = 42, alfa = 0.05 } = {}) {
  const fb = beneficio || ((x) => x.pnl);
  const fs = stake || ((x) => x.stake);
  const grupos = agrupa(items, cluster).map((g) => {
    let b = 0, s = 0, n = 0;
    for (const it of g) {
      const bb = Number(fb(it)), ss = Number(fs(it));
      if (!Number.isFinite(bb) || !Number.isFinite(ss) || !(ss > 0)) continue;
      b += bb; s += ss; n++;
    }
    return { b, s, n };
  }).filter((g) => g.n > 0);

  const nClusters = grupos.length;
  const nItems = suma(grupos.map((g) => g.n));
  const apostado = suma(grupos.map((g) => g.s));
  const pnl = suma(grupos.map((g) => g.b));
  const base = { n_items: nItems, n_clusters: nClusters, replicas, semilla, alfa,
    apostado: r4(apostado), pnl: r4(pnl) };
  if (!nClusters || !(apostado > 0)) return { ...base, roi_pct: null, ic_pct: [null, null], se_pct: null, t: null };

  const roi = 100 * pnl / apostado;
  if (nClusters < 2) {
    return { ...base, roi_pct: r4(roi), ic_pct: [null, null], se_pct: null, t: null,
      aviso: 'un solo racimo: no hay variación entre racimos que remuestrear' };
  }

  const rnd = generador(semilla);
  const reps = new Array(replicas);
  for (let r = 0; r < replicas; r++) {
    let b = 0, s = 0;
    for (let k = 0; k < nClusters; k++) {
      const j = Math.floor(rnd() * nClusters) % nClusters;
      b += grupos[j].b; s += grupos[j].s;      // beneficio y stake viajan JUNTOS
    }
    reps[r] = s > 0 ? 100 * b / s : NaN;
  }
  const ok = finitos(reps).sort((a, b2) => a - b2);
  const se = sd(ok);
  const seUtilRoi = se > Math.max(Math.abs(roi), 1e-12) * 1e-9;   // ver la nota del bootstrap por racimos
  return { ...base, roi_pct: r4(roi), se_pct: r4(se),
    ic_pct: [r4(percentil(ok, alfa / 2)), r4(percentil(ok, 1 - alfa / 2))],
    t: seUtilRoi ? r4(roi / se) : null,
    ...(se > 0 && !seUtilRoi ? { aviso_t: 'todas las réplicas dan el mismo ROI: el t no significa nada y se devuelve nulo' } : {}),
    tam_medio_cluster: r4(nItems / nClusters) };
}

// ══ 7. ROI ANALÍTICO (EL DEL §5.2 DE LA AUDITORÍA) ═════════════════════════════════════════════════════
// Cuando de un track solo queda el agregado publicado —n tickets, ROI y cuota media— no hay filas que
// remuestrear, pero el intervalo se puede poner igual:
//
//     p = (1 + roi) / cuota          (la tasa de acierto implícita en ese ROI a esa cuota)
//     se = cuota · √( p(1−p) / n )   (el ROI es cuota·p − 1, así que su error escala con la cuota)
//
// SIMPLIFICACIONES, todas hacia un intervalo DEMASIADO ESTRECHO, así que si este ya contiene el cero, el
// honesto también: (a) tickets independientes —falso en cuanto hay dos líneas del mismo partido—;
// (b) cuota constante e igual a la media —la dispersión de cuotas añade varianza—; (c) stake plano;
// (d) sin push, sin anulaciones y sin comisiones —y en Cloudbet hubo 14 anulados de 68 en CS2—.
// Sirve para auditar cifras publicadas y para el "faltan N" de un track que aún no tiene libro propio; el
// número que manda cuando hay filas es el de `roiIC`.
function roiICAnalitico(n, roiPct, cuota, { alfa = 0.05 } = {}) {
  const N = Number(n), roi = Number(roiPct) / 100, o = Number(cuota);
  if (!(N > 0) || !(o > 1) || !Number.isFinite(roi)) return { n: N, roi_pct: null, ic_pct: [null, null], se_pct: null, t: null };
  const p = (1 + roi) / o;
  if (!(p > 0 && p < 1)) return { n: N, cuota: o, roi_pct: +Number(roiPct).toFixed(4), p_implicita: r4(p), ic_pct: [null, null], se_pct: null, t: null, aviso: 'la probabilidad implícita se sale de (0,1)' };
  const se = o * Math.sqrt(p * (1 - p) / N);
  const z = zBilateral(alfa);
  return { n: N, cuota: o, roi_pct: +Number(roiPct).toFixed(4), p_implicita: r4(p),
    se_pct: r4(100 * se), ic_pct: [r4(100 * (roi - z * se)), r4(100 * (roi + z * se))],
    t: r4(roi / se), alfa, aprox: 'tickets independientes, cuota constante, sin push ni comisiones' };
}

// ══ 8. p DESDE UN t ════════════════════════════════════════════════════════════════════════════════════
// p bilateral de un t con `gl` grados de libertad por la transformación de Wallace:
//
//     z ≈ √( gl · ln(1 + t²/gl) ) · (8·gl + 1)/(8·gl + 3)
//
// y luego p = 2·(1 − Φ(z)). Error absoluto en p < 0,002 para gl ≥ 3 (comprobado contra la tabla: t = 2,228
// con gl 10 da 0,0501 frente a 0,0500; t = 2,0 con gl 5 da 0,1021 frente a 0,1019). Con gl ≥ 100 coincide
// con la normal a cuatro decimales. NO usar para gl ≤ 2, donde la cola de Student es muy pesada y la
// aproximación se queda corta; ahí este módulo devuelve `null` en vez de un número bonito y falso.
function pDeT(t, gl) {
  const T = Math.abs(Number(t)), g = Number(gl);
  if (!Number.isFinite(T)) return null;
  if (!Number.isFinite(g) || g <= 2) return null;    // gl ≤ 2: no hay p que se pueda defender, y se dice
  if (g >= 1000) return r4(2 * (1 - normalCdf(T)));
  const z = Math.sqrt(g * Math.log(1 + (T * T) / g)) * ((8 * g + 1) / (8 * g + 3));
  return r4(Math.min(1, Math.max(0, 2 * (1 - normalCdf(z)))));
}

// ══ 9. BENJAMINI-HOCHBERG ══════════════════════════════════════════════════════════════════════════════
// Con m familias juzgadas a la vez, exigir p < 0,05 a cada una no controla nada: con m = 40 familias nulas
// salen ~2 "significativas" solo por mirar cuarenta veces. BH ordena los p, busca el mayor k con
// p(k) ≤ (k/m)·q y rechaza todos los p ≤ p(k). Lo que queda controlado es la FDR: de las familias que
// declaramos vivas, como mucho una fracción q lo está por azar. Con q = 0,10, una de cada diez.
// Si no hay ningún k que cumpla, el umbral es 0 y no se rechaza nada — que es una respuesta legítima y la
// más frecuente en este proyecto.
function bh(pvalores, q = 0.10) {
  const filas = (pvalores || []).map((p, i) => ({ p: Number(p), i }))
    .filter((x) => Number.isFinite(x.p) && x.p >= 0 && x.p <= 1);
  const m = filas.length;
  if (!m) return { umbral: 0, rechazadas: [], q, m: 0 };
  const ord = filas.slice().sort((a, b) => a.p - b.p);
  let k = 0;
  for (let j = 1; j <= m; j++) if (ord[j - 1].p <= (j / m) * q) k = j;
  const umbral = k ? ord[k - 1].p : 0;
  const rechazadas = k ? ord.slice(0, k).map((x) => x.i).sort((a, b) => a - b) : [];
  return { umbral: r4(umbral), rechazadas, q, m };
}

// ══ 10. POTENCIA Y TAMAÑO NECESARIO ════════════════════════════════════════════════════════════════════
// Para poder contestar "¿cuánto falta?" con un número en vez de con un "ya veremos". Prueba bilateral de una
// media con desviación `sd` conocida (aproximación normal; con n grande, que es el caso en el que importa,
// la diferencia con Student es despreciable).
//
//     potencia = Φ( efecto·√n/sd − z_{1−α/2} ) + Φ( −efecto·√n/sd − z_{1−α/2} )
//
// El segundo sumando es la cola de detectar el efecto con el signo cambiado; es casi cero salvo con efectos
// minúsculos, pero se incluye porque omitirlo infla la potencia declarada justo en el caso peor.
function potencia({ n, efecto, sd: s, alfa = 0.05 } = {}) {
  const N = Number(n), e = Math.abs(Number(efecto)), S = Number(s);
  if (!(N > 0) || !(S > 0) || !Number.isFinite(e)) return null;
  const z = zBilateral(alfa);
  const d = e * Math.sqrt(N) / S;
  return r4(Math.min(1, Math.max(0, normalCdf(d - z) + normalCdf(-d - z))));
}

// n necesario para detectar `efecto` con `potencia` a nivel `alfa`. Se redondea SIEMPRE hacia arriba.
function nParaDetectar({ efecto, sd: s, alfa = 0.05, potencia: pot = 0.80 } = {}) {
  const e = Math.abs(Number(efecto)), S = Number(s), P = Number(pot);
  if (!(e > 0) || !(S > 0) || !(P > 0 && P < 1)) return null;
  const n = Math.ceil(((zBilateral(alfa) + normalInv(P)) * S / e) ** 2);
  return n;
}

// El mismo cálculo escrito en el idioma del libro: "para detectar un ROI verdadero del X % a cuota c".
// Es la tabla del §5.3 de la auditoría (a 1,91: 71.402 apuestas para un ROI del 1 %, 17.844 para el 2 %,
// 7.927 para el 3 %, 2.851 para el 5 %, 710 para el 10 %) y la razón por la que 100 liquidadas son un
// control operativo y no una certificación. Usa la varianza bajo H0 y bajo H1 por separado, que es lo
// correcto para una proporción y da un n algo mayor que la fórmula de varianza única.
function nParaDetectarRoi({ roiPct, cuota, alfa = 0.05, potencia: pot = 0.80 } = {}) {
  const roi = Number(roiPct) / 100, o = Number(cuota), P = Number(pot);
  if (!(o > 1) || !(roi > 0) || !(P > 0 && P < 1)) return null;
  const p0 = 1 / o, p1 = (1 + roi) / o;
  if (!(p1 > 0 && p1 < 1)) return null;
  const za = zBilateral(alfa), zb = normalInv(P);
  const n = Math.ceil(((za * Math.sqrt(p0 * (1 - p0)) + zb * Math.sqrt(p1 * (1 - p1))) / (p1 - p0)) ** 2);
  return { n, roi_pct: Number(roiPct), cuota: o, alfa, potencia: P, p0: r4(p0), p1: r4(p1) };
}

module.exports = {
  mediaIC, bootstrapClusters, roiIC, roiICAnalitico, bh, pDeT, potencia, nParaDetectar, nParaDetectarRoi,
  // piezas sueltas, expuestas para los tests y para quien quiera componer otra cosa
  normalCdf, normalInv, zBilateral, generador, percentil, agrupa, media, sd,
};
