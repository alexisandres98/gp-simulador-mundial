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

function simulate({ muMargin, muTotal, priors, n = 20000, seed = 17 }) {
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
  for (let i = 0; i < n; i++) {
    let m, t;
    if (useAtlas) {
      // 1) ¿dónde está de verdad nuestra media? nuestro error contra el cierre, medido fuera de muestra
      const lineM = muMargin + gaussOf(rnd, sm);
      const lineT = muTotal + gaussOf(rnd, st);
      // 2) un partido histórico que se jugó con esa línea de hándicap…
      const band = nearestBand(idx, lineM, K);
      // …y, de esa banda, el que además se pareciera en total, para no romper la relación margen-total
      let best = band[(rnd() * band.length) | 0];
      let bestD = Infinity;
      for (let j = 0; j < 12; j++) {
        const c = band[(rnd() * band.length) | 0];
        const d = Math.abs(idx.rows[c][1] - lineT);
        if (d < bestD) { bestD = d; best = c; }
      }
      const g = idx.rows[best];
      m = g[2]; t = g[3];                        // marcador REAL, copiado tal cual
    } else {
      const p = pool[(rnd() * pool.length) | 0];
      m = Math.round(muMargin + p[0] + discreteNoise(rnd, sm));
      t = Math.max(2, Math.round(muTotal + p[1] + discreteNoise(rnd, st)));
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
