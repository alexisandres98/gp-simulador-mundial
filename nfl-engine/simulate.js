// nfl-engine/simulate.js — LA DISTRIBUCIÓN CONJUNTA (margen, total), no dos medias sueltas (17-ago).
//
// El blueprint §17 es explícito: para spreads/totales hay que generar una distribución CONJUNTA con la masa
// real en los números clave (NFL-0454/0460/0461). La forma honesta de conseguirla sin inventar una Normal:
//
//   (margen, total) = (mu_margen, mu_total) + PAR DE RESIDUOS muestreado del histórico real contra el
//   cierre 2016-2025 (2.761 partidos) + ruido discreto por la varianza EXTRA del modelo medida fuera de
//   muestra (nuestro mu es peor que el cierre en ~3.6/3.3 puntos de desvío; fingir lo contrario sería
//   vestirse con la precisión del mercado sin tenerla).
//
// Muestrear PARES del mismo partido conserva gratis lo que a los modelos paramétricos les cuesta:
//   · la masa en 3/6/7/10/14 (los residuos vienen de marcadores reales de NFL),
//   · la correlación margen-total (las palizas suelen venir con más puntos),
//   · las colas pesadas reales.
//
// La semilla es determinista y viaja con cada predicción (NFL-0479): la misma entrada reproduce la misma
// distribución, y una auditoría puede repetir el cálculo.
'use strict';

// mulberry32 — determinista, suficiente para Monte Carlo de producto
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ruido discreto ~ N(0, sigma) redondeado — mantiene los margenes en la rejilla entera donde viven los
// números clave; un ruido continuo desharía la masa que el pool trae de la realidad
function gaussOf(rnd, sigma) {
  if (!sigma) return 0;
  const u1 = Math.max(1e-9, rnd()), u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
}
function discreteNoise(rnd, sigma) {
  if (!sigma) return 0;
  const u1 = Math.max(1e-9, rnd()), u2 = rnd();
  return Math.round(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma);
}

// ── EL ATLAS: MUESTREAR DESENLACES REALES EN VEZ DE SUMAR RESIDUOS (19-ago) ──────────────────────────────
// Medido: el margen real de NFL cae en |3| el 14,70 % de las veces y en |7| el 8,48 %, contra ~4,6 % en 1,
// 2 o 4. Sumar (resultado − cierre) sobre nuestra media corría esa masa a donde nuestra media la llevara y
// la difuminaba: el simulador daba 6,2 % en el 3 y 6,5 % en el 1 — casi plano justo en el tramo donde vive
// casi toda línea de hándicap. La probabilidad de empuje en la línea 3 salía ~6 % contra el 9-10 % real, y
// la compuerta de empuje (<6 %) dejaba pasar exactamente lo que debía frenar.
//
// El atlas no suma nada. Sortea primero DÓNDE ESTÁ DE VERDAD nuestra media —nuestro error contra el cierre
// está medido, es `sigma_extra`— y después copia el marcador de un partido histórico que se jugó con esa
// línea. Cada muestra es un partido que ocurrió: los números clave caen donde caen, el par (margen, total)
// llega con su correlación intacta y las colas son las reales, no las de una Normal.
//
// Se condiciona a NUESTRA media, nunca a la línea de HOY: el atlas solo aporta la FORMA de los marcadores
// alrededor de un nivel de favoritismo, que es un hecho del deporte. El modelo sigue siendo ciego al mercado.
// tolerancia de parecido en el total, en puntos. Ancha a propósito: estrecharla vuelve a colapsar la
// muestra, que es el defecto que se acaba de corregir. Lo que se busca es no cruzar un partido de 2,5 de
// hándicap con uno de 62 puntos de total, no clonar el total.
const TOTAL_TOL = 7;
// ancho del núcleo de suavizado del atlas, en puntos (ver la nota larga en el bucle de simulación)
const ATLAS_SMOOTH = 1.8;
const EMPTY_BAND = [];   // marcador: con centro fijo la banda ya está resuelta en `fixedList`
const OKBUF = new Int32Array(4096);   // reutilizado por sorteo; evita reservar memoria 20.000 veces
function buildAtlas(atlas) {
  // índice ordenado por línea de cierre para poder buscar vecinos por bisección
  const rows = atlas.slice().sort((a, b) => a[0] - b[0]);
  const lines = rows.map((r) => r[0]);
  return { rows, lines };
}
function nearestBand(idx, line, k) {
  const { lines } = idx;
  let lo = 0, hi = lines.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (lines[mid] < line) lo = mid + 1; else hi = mid; }
  let a = lo - 1, b = lo;                       // dos punteros que se abren hacia el vecino más cercano
  const out = [];
  while (out.length < k && (a >= 0 || b < lines.length)) {
    if (a < 0) out.push(b++);
    else if (b >= lines.length) out.push(a--);
    else out.push(Math.abs(lines[a] - line) <= Math.abs(lines[b] - line) ? a-- : b++);
  }
  return out;
}

// ALEATORIO Y EPISTÉMICO SON COSAS DISTINTAS Y AQUÍ SE SEPARAN (19-ago).
// `marginalize:true` (lo de siempre) devuelve la distribución YA integrada sobre nuestro propio error:
// sirve para enseñar una probabilidad. `marginalize:false` devuelve la variación del PARTIDO dado un
// centro conocido — el azar del deporte, sin nuestro error dentro. Esa segunda es la que hace falta para
// construir una POSTERIOR sobre la probabilidad: si el error del modelo ya está mezclado dentro, la
// probabilidad sale sin dispersión y no se puede decir "P(ventaja>0) = 94 %", solo "la ventaja es 5,2 pp".
function simulate({ muMargin, muTotal, priors, n = 20000, seed = 17, marginalize = true, smooth = null }) {
  const pool = (priors && priors.resid_pool) || [];
  const atlasRaw = (priors && priors.outcome_atlas) || [];
  if (!pool.length && !atlasRaw.length) return null;
  const sm = (priors && priors.sigma_extra_margin) || 0;
  const st = (priors && priors.sigma_extra_total) || 0;
  // EL ATLAS NECESITA MUESTRA POR TRAMO. Con pocos partidos, los "vecinos" de una línea son media liga y el
  // condicionamiento deja de significar nada: ahí es más honesto el método viejo. 900 es el corte donde una
  // banda de 150 vecinos sigue siendo una banda estrecha de líneas.
  const useAtlas = atlasRaw.length >= 900;
  const idx = useAtlas ? buildAtlas(atlasRaw) : null;
  const K = useAtlas ? Math.max(60, Math.min(300, Math.round(atlasRaw.length / 22))) : 0;
  const rnd = rng(seed);
  const margins = new Array(n), totals = new Array(n);
  let homeWin = 0, tie = 0;
  const marginMass = {}, totalMass = {};
  // CON EL CENTRO FIJO, LA BANDA NO CAMBIA ENTRE SORTEOS. Es el caso del abanico de la posterior, que apaga
  // el suavizado: ahí el filtro por total se calcula UNA vez por simulación en vez de una vez por sorteo.
  // Sin esto, College tardaba 2,8 s por partido —800 sorteos × 300 vecinos × 240 centros— y eso saca la
  // posterior de cualquier ruta de petición.
  const fixedCentre = useAtlas && !marginalize && smooth === 0;
  let fixedList = null, fixedN = 0, fixedStart = 0;
  for (let i = 0; i < n; i++) {
    let m, t;
    if (useAtlas) {
      // 1) ¿dónde está de verdad nuestra media? nuestro error contra el cierre, medido fuera de muestra
      // SUAVIZADO DEL ATLAS (19-ago). La ventana de K partidos con la línea buscada trae ~1,1 puntos de
      // ruido en su media realizada (K=126, sd 12,3). Eso NO es sesgo: la regresión global de resultado
      // sobre línea da pendiente 1,03 e intercepto 0,04, o sea que la línea es insesgada y no hay nada que
      // invertir —se probó y la corrección salía de 0,04 a 0,37 puntos contra un ruido de 1,10—. Lo que hay
      // es ruido de muestreo, y el ruido se quita promediando: se sortea el centro de la ventana con un
      // núcleo estrecho, que barre ventanas vecinas y cancela su ruido.
      //
      // Es exactamente lo que la marginal ya hacía sin querer con `sigma_extra`, y por eso la marginal
      // salía bien y la aleatoria mal cuando se le quitó el sorteo. Aquí el núcleo se declara por lo que
      // es —un ancho de suavizado, no una afirmación sobre nuestra incertidumbre— y es pequeño: 1,8 puntos
      // sumados en cuadratura a 12,3 ensanchan la distribución un 1 %.
      // `smooth` deja apagar el suavizado cuando quien llama ya promedia entre centros — es el caso del
      // abanico de la posterior, que sortea 48 centros distintos: ahí el núcleo sobra y, sumado al propio
      // abanico, suaviza dos veces y arrastra la probabilidad hacia la media global del atlas.
      const kM = marginalize ? sm : (smooth == null ? ATLAS_SMOOTH : smooth);
      const kT = marginalize ? st : (smooth == null ? ATLAS_SMOOTH : smooth);
      const lineM = muMargin + gaussOf(rnd, kM);
      const lineT = muTotal + gaussOf(rnd, kT);
      // 2) un partido histórico que se jugó con esa línea de hándicap…
      const band = (fixedCentre && fixedList) ? EMPTY_BAND : nearestBand(idx, lineM, K);
      // …y, de esa banda, uno que además se pareciera en total, para no romper la relación margen-total.
      //
      // CÓMO NO HACERLO (19-ago, corregido el mismo día que se introdujo): coger "el más parecido de 12
      // candidatos" parece razonable y está mal. Con el total fijo, ese argmin devuelve SIEMPRE los mismos
      // dos o tres partidos de la banda, así que la muestra se colapsa: la desviación típica del margen
      // aleatorio salía 5,75 puntos cuando la real de la NFL es 13,3. Un simulador que se cree la mitad de
      // disperso de lo que es el deporte da probabilidades demasiado seguras — exactamente el defecto que
      // esta casa ya tiene medido en baloncesto y estaba a punto de replicar aquí.
      //
      // Se sortea UNIFORME dentro de la banda y se acepta por parecido en total con reintentos acotados:
      // conserva la relación margen-total sin elegir siempre al mismo.
      // RECOLECTAR Y SORTEAR UNIFORME, NO REINTENTAR HASTA ACEPTAR. Reintentar parece equivalente y no lo
      // es: la probabilidad de acabar en un partido concreto depende de cuántos rivales pasen el filtro, así
      // que los pocos partidos con el total más parecido se llevan casi todas las muestras. Con reintentos
      // la dispersión del margen se quedaba en 9,75 puntos contra los 13,1 reales de una banda de esa línea.
      // Aquí se listan los que valen y se sortea entre ellos por igual; si son muy pocos, se ensancha la
      // tolerancia en vez de insistir sobre los mismos.
      let cnt;
      if (fixedCentre && fixedList) { cnt = fixedN; }
      else {
        let tol = TOTAL_TOL; cnt = 0;
        for (let pass = 0; pass < 3; pass++) {
          cnt = 0;
          for (let j = 0; j < band.length; j++) if (Math.abs(idx.rows[band[j]][1] - lineT) <= tol) OKBUF[cnt++] = band[j];
          if (cnt >= 24) break;
          tol *= 2;
        }
        if (fixedCentre) { fixedList = OKBUF.slice(0, cnt); fixedN = cnt; fixedStart = band.length ? band[0] : 0; }
      }
      const src = (fixedCentre && fixedList) ? fixedList : OKBUF;
      const g = idx.rows[cnt ? src[(rnd() * cnt) | 0] : band[(rnd() * band.length) | 0]];
      m = g[2]; t = g[3];                        // marcador REAL, copiado tal cual
    } else {
      const p = pool[(rnd() * pool.length) | 0];
      m = Math.round(muMargin + p[0] + (marginalize ? discreteNoise(rnd, sm) : 0));
      t = Math.max(2, Math.round(muTotal + p[1] + (marginalize ? discreteNoise(rnd, st) : 0)));
    }
    margins[i] = m; totals[i] = t;
    if (m > 0) homeWin++; else if (m === 0) tie++;
    marginMass[m] = (marginMass[m] || 0) + 1;
    totalMass[t] = (totalMass[t] || 0) + 1;
  }
  margins.sort((a, b) => a - b); totals.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  // CDFs para cotizar cualquier línea alternativa desde la misma distribución (NFL-0464)
  const coverProb = (line) => {           // P(local cubre línea `line` — línea del local, positiva = favorito)
    let c = 0, push = 0;
    for (const m of margins) { if (m > line) c++; else if (m === line) push++; }
    return { p: c / Math.max(1, n - push), push: +(push / n).toFixed(4) };
  };
  const overProb = (line) => {
    let c = 0, push = 0;
    for (const t of totals) { if (t > line) c++; else if (t === line) push++; }
    return { p: c / Math.max(1, n - push), push: +(push / n).toFixed(4) };
  };
  // masa en los números clave, en ambos signos (NFL-0460)
  const key = {};
  for (const k of [3, 6, 7, 10, 14]) {
    key[k] = +(((marginMass[k] || 0) + (marginMass[-k] || 0)) / n).toFixed(4);
  }
  return {
    n, seed,
    mu_margin: +muMargin.toFixed(2), mu_total: +muTotal.toFixed(2),
    p_home: +((homeWin + 0.5 * tie) / n).toFixed(4),
    p_tie: +(tie / n).toFixed(4),
    margin: { p10: q(margins, 0.10), p25: q(margins, 0.25), p50: q(margins, 0.50), p75: q(margins, 0.75), p90: q(margins, 0.90) },
    total: { p10: q(totals, 0.10), p25: q(totals, 0.25), p50: q(totals, 0.50), p75: q(totals, 0.75), p90: q(totals, 0.90) },
    // equipo local/visitante: derivados del par (total±margen)/2 — se publican como medias, no como marcador exacto
    team_home_mu: +((muTotal + muMargin) / 2).toFixed(1),
    team_away_mu: +((muTotal - muMargin) / 2).toFixed(1),
    key_mass: key,
    margin_hist: Object.fromEntries(Object.entries(marginMass).filter(([, c]) => c / n >= 0.004).map(([k, c]) => [k, +(c / n).toFixed(4)])),
    total_hist: Object.fromEntries(Object.entries(totalMass).filter(([, c]) => c / n >= 0.004).map(([k, c]) => [k, +(c / n).toFixed(4)])),
    coverProb, overProb,
  };
}

module.exports = { simulate, rng };
