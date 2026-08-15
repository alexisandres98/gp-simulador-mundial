// basketball-engine/metrics.js — CÓMO SE MIDE SI ESTO SIRVE (16-ago).
//
// LA TRAMPA QUE ESTE ARCHIVO EXISTE PARA EVITAR: juzgar un modelo por el ROI de las últimas cuarenta picks.
// Cuarenta apuestas no distinguen un modelo bueno de uno con suerte — ni de lejos. La evidencia real es un
// conjunto de medidas que se contradicen entre sí cuando algo va mal, y por eso hay que publicarlas todas:
//
//   · BRIER — el error cuadrático de la probabilidad. Es la medida principal y la que se compara contra el
//     cierre del mercado sobre EXACTAMENTE los mismos partidos.
//   · LOG LOSS — castiga la sobreconfianza de forma brutal. Un modelo que dice 95% y falla una vez paga más
//     acá que en Brier. Sirve justo para detectar el modelo que "casi siempre acierta" y de vez en cuando
//     se estrella.
//   · CALIBRACIÓN — de todas las veces que dijimos 60%, ¿ocurrió el 60%? Con intervalo, porque un cubo de
//     doce partidos no demuestra descalibración.
//   · NITIDEZ (sharpness) — un modelo perfectamente calibrado que siempre dice 50% está perfectamente
//     calibrado y es perfectamente inútil. Sin esta medida, la calibración se puede "ganar" no opinando.
//   · CRPS — para distribuciones enteras (margen, total, props), no solo para el sí/no. Es la generalización
//     del error absoluto a una predicción probabilística: premia acertar el centro Y tener el ancho justo.
//   · CLV — si capturamos precio contra el cierre. Es la única medida que anticipa rentabilidad futura
//     antes de tener miles de apuestas resueltas.
//
// PURO: entran filas de predicciones y resultados, salen números. Sin red, sin disco, sin db.
'use strict';

const r5 = (x) => (Number.isFinite(x) ? +x.toFixed(5) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const clamp = (p) => Math.min(0.999999, Math.max(1e-6, p));

// ---- MEDIDAS DE PROBABILIDAD BINARIA ---------------------------------------------------------------------
function brier(rows) { return rows.length ? r5(rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / rows.length) : null; }
function logLoss(rows) {
  if (!rows.length) return null;
  return r5(-rows.reduce((s, r) => { const p = clamp(r.p); return s + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / rows.length);
}
// NITIDEZ: desviación de las probabilidades respecto a la tasa base. Alta = el modelo se moja.
function sharpness(rows) {
  if (!rows.length) return null;
  const base = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const v = rows.reduce((s, r) => s + (r.p - base) ** 2, 0) / rows.length;
  return { sd: r5(Math.sqrt(v)), base_rate: r5(base),
    note: Math.sqrt(v) < 0.05 ? 'el modelo casi no se separa de la tasa base: está calibrado por no opinar' : null };
}
// DESCOMPOSICIÓN DE MURPHY: Brier = incertidumbre − resolución + fiabilidad. Separa "el problema es difícil"
// (incertidumbre) de "el modelo distingue casos" (resolución) y de "los números están bien puestos"
// (fiabilidad). Es la forma correcta de responder "¿por qué mi Brier es 0,21?".
function murphy(rows, { bins = 10 } = {}) {
  if (rows.length < 20) return null;
  const base = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  const groups = new Map();
  for (const r of rows) { const b = Math.min(bins - 1, Math.floor(clamp(r.p) * bins)); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(r); }
  let rel = 0, res = 0;
  for (const g of groups.values()) {
    const pk = g.reduce((s, r) => s + r.p, 0) / g.length;
    const ok = g.reduce((s, r) => s + r.y, 0) / g.length;
    rel += (g.length / rows.length) * (pk - ok) ** 2;
    res += (g.length / rows.length) * (ok - base) ** 2;
  }
  return { uncertainty: r5(base * (1 - base)), resolution: r5(res), reliability: r5(rel),
    check: r5(base * (1 - base) - res + rel), n_bins: groups.size };
}

// ---- CURVA DE CALIBRACIÓN CON INTERVALO ------------------------------------------------------------------
// El intervalo es de Wilson, no el normal: con 12 casos y una tasa del 92%, el intervalo normal se sale de
// [0,1] y sugiere una precisión que no existe.
function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}
function calibration(rows, { bins = 10, minN = 5 } = {}) {
  const out = [];
  for (let i = 0; i < bins; i++) {
    const lo = i / bins, hi = (i + 1) / bins;
    const sel = rows.filter((r) => r.p >= lo && r.p < hi + (i === bins - 1 ? 1e-9 : 0));
    if (sel.length < minN) continue;
    const k = sel.reduce((s, r) => s + r.y, 0);
    const ci = wilson(k, sel.length);
    out.push({ range: `${Math.round(100 * lo)}-${Math.round(100 * hi)}%`, n: sel.length,
      predicted: r2(100 * sel.reduce((s, r) => s + r.p, 0) / sel.length),
      actual: r2(100 * k / sel.length),
      lo: r2(100 * ci.lo), hi: r2(100 * ci.hi),
      // dentro del intervalo = no hay evidencia de descalibración en ese tramo
      ok: (k / sel.length) >= ci.lo && (k / sel.length) <= ci.hi ? true : null });
  }
  // ERROR DE CALIBRACIÓN ESPERADO: media ponderada de |predicho − observado|
  const tot = out.reduce((s, b) => s + b.n, 0) || 1;
  const ece = out.reduce((s, b) => s + b.n * Math.abs(b.predicted - b.actual), 0) / tot;
  return { bins: out, ece_pp: r2(ece), n: tot };
}

// ---- CRPS ------------------------------------------------------------------------------------------------
// Para una predicción DISTRIBUCIONAL (histograma discreto) y un resultado observado:
// CRPS = Σ (F(x) − 1{x ≥ y})² sobre el soporte. En unidades del propio valor (puntos), así que se puede leer
// como "el error típico de la distribución entera" y comparar contra un modelo trivial.
function crps(hist, y) {
  if (!hist || !hist.length) return null;
  const sorted = hist.slice().sort((a, b) => a[0] - b[0]);
  let cdf = 0, acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    const [x, p] = sorted[i];
    cdf += p;
    const step = i + 1 < sorted.length ? sorted[i + 1][0] - x : 1;
    acc += ((cdf - (x >= y ? 1 : 0)) ** 2) * step;
  }
  return r5(acc);
}
function crpsMean(rows) {
  const vals = rows.map((r) => crps(r.hist, r.y)).filter(Number.isFinite);
  return vals.length ? { crps: r5(vals.reduce((s, x) => s + x, 0) / vals.length), n: vals.length } : null;
}

// ---- CLV ---------------------------------------------------------------------------------------------
// No basta la media. Lo que importa es la DISTRIBUCIÓN: un CLV medio de +1,5% que sale de un acierto enorme
// y veinte pérdidas pequeñas no es la misma señal que un +1,5% consistente. Se publica la mediana, la
// fracción positiva y un intervalo por bootstrap.
function clvStats(rows, { boots = 400, seed = 7 } = {}) {
  const v = rows.map((r) => r.clv_pct).filter(Number.isFinite);
  if (v.length < 5) return { n: v.length, enough: false };
  const sorted = v.slice().sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * (sorted.length - 1))))];
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  // bootstrap determinista: mismo resultado en cada carga, que es lo que permite comparar dos días
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
  const means = [];
  for (let b = 0; b < boots; b++) {
    let acc = 0;
    for (let i = 0; i < v.length; i++) acc += v[Math.floor(rnd() * v.length)];
    means.push(acc / v.length);
  }
  means.sort((a, b) => a - b);
  return {
    n: v.length, enough: true,
    mean: r2(mean), median: r2(q(0.5)), p25: r2(q(0.25)), p75: r2(q(0.75)), p05: r2(q(0.05)), p95: r2(q(0.95)),
    positive_share: r2(100 * v.filter((x) => x > 0).length / v.length),
    ci95: { lo: r2(means[Math.floor(0.025 * boots)]), hi: r2(means[Math.floor(0.975 * boots)]) },
    // el histograma para el panel
    hist: (() => { const h = {}; for (const x of v) { const b = Math.round(x); h[b] = (h[b] || 0) + 1; } return Object.entries(h).map(([k, n]) => [+k, n]).sort((a, b) => a[0] - b[0]); })(),
  };
}

// ---- ESTABILIDAD POR SEGMENTO ----------------------------------------------------------------------------
// Una ventaja que solo existe en un mes, en una casa o en un rango de cuota no es una ventaja: es una
// coincidencia con nombre. Se parte la muestra por las dimensiones que importan y se mira si el signo aguanta.
function segments(rows, dims) {
  const out = {};
  for (const [name, keyFn] of Object.entries(dims)) {
    const by = new Map();
    for (const r of rows) { const k = keyFn(r); if (k == null) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    out[name] = [...by.entries()].filter(([, v]) => v.length >= 10).map(([k, v]) => ({
      key: k, n: v.length, brier: brier(v),
      skill: v.every((r) => r.p_market != null)
        ? r5((v.reduce((s, r) => s + (r.p_market - r.y) ** 2, 0) - v.reduce((s, r) => s + (r.p - r.y) ** 2, 0)) / v.length)
        : null,
    })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }
  return out;
}

// ---- SCORECARD POR FAMILIA -------------------------------------------------------------------------------
// El estado de ciclo de vida del blueprint, calculado y no declarado. El estado por defecto es
// "investigación": una familia se GANA el derecho a publicar, no lo tiene por existir.
function scorecard({ family, label, rows, clv = null, minSample = 150 }) {
  const n = rows.length;
  const b = brier(rows);
  const withM = rows.filter((r) => r.p_market != null);
  const skill = withM.length ? r5((withM.reduce((s, r) => s + (r.p_market - r.y) ** 2, 0) - withM.reduce((s, r) => s + (r.p - r.y) ** 2, 0)) / withM.length) : null;
  let t = null;
  if (withM.length > 5) {
    const d = withM.map((r) => ((r.p_market - r.y) ** 2) - ((r.p - r.y) ** 2));
    const mu = d.reduce((s, x) => s + x, 0) / d.length;
    const va = d.reduce((s, x) => s + (x - mu) ** 2, 0) / (d.length - 1);
    t = r2(mu / Math.sqrt(va / d.length));
  }
  const cal = calibration(rows);
  const sh = sharpness(rows);
  let stage = 'research', reason = 'muestra insuficiente';
  if (n >= minSample && skill != null) {
    if (skill > 0 && t != null && t >= 2 && (clv == null || (clv.enough && clv.mean > 0))) { stage = 'production'; reason = 'bate al cierre con significancia y CLV positivo'; }
    else if (skill > 0 && t != null && t >= 1) { stage = 'candidate'; reason = 'bate al cierre pero la ventaja aún no es concluyente'; }
    else if (skill > 0) { stage = 'shadow'; reason = 'por delante del cierre dentro del ruido'; }
    else { stage = 'shadow'; reason = 'por detrás del cierre: se sigue midiendo sin publicar'; }
  } else if (skill != null && skill < 0 && n >= 60) { stage = 'shadow'; reason = 'por detrás del cierre en la muestra disponible'; }
  return {
    family, label, stage, reason, n, n_vs_market: withM.length,
    brier: b, log_loss: logLoss(rows), skill, t,
    calibration_ece_pp: cal.ece_pp, sharpness: sh ? sh.sd : null, sharpness_note: sh ? sh.note : null,
    murphy: murphy(rows), clv,
    publishes: stage === 'production',
  };
}

module.exports = { brier, logLoss, sharpness, murphy, calibration, wilson, crps, crpsMean, clvStats, segments, scorecard };
