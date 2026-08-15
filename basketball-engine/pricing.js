// basketball-engine/pricing.js — DE UNA PROBABILIDAD A UN PRECIO (16-ago).
//
// LO QUE SEPARA UN MODELO DE UN PRODUCTO DE APUESTAS. Tener razón sobre quién gana no es tener ventaja. La
// ventaja es la diferencia entre la probabilidad justa y la que implica el precio DISPONIBLE, y sobrevive
// solo si es más grande que el vig, que el error del modelo y que lo que se pierde al ejecutar.
//
// LAS CUATRO COSAS QUE ESTE ARCHIVO HACE BIEN Y CASI NADIE HACE BIEN:
//
// 1. QUITAR EL VIG DE VARIAS MANERAS Y DECIR CUÁL SE USÓ. El método proporcional —dividir por la suma— es
//    el que usa todo el mundo y es el que peor se porta en los extremos: reparte el margen por igual entre
//    un favorito de 1,10 y un perdedor de 8,00, cuando la casa carga sistemáticamente más al segundo. Acá
//    están los tres (proporcional, potencia y Shin) y CADA precio publicado guarda con cuál se calculó.
//    Sin ese registro, un backtest de hace tres meses no se puede reproducir.
//
// 2. LA LÓGICA DE EMPUJE. Un hándicap de -7 o un total de 210 no son dos resultados: son tres, porque el
//    partido puede caer exactamente ahí. Tratarlos como dos infla el EV de todas las líneas enteras, que
//    además son las más frecuentes en los números clave. La probabilidad de empate sale de la distribución
//    simulada, no de una tabla.
//
// 3. LA CUOTA MÍNIMA JUGABLE. Publicar "value a 1,95" sin decir a partir de qué precio deja de serlo
//    convierte una recomendación en una trampa: el usuario llega diez minutos tarde, encuentra 1,83 y
//    apuesta igual. o_min = (1 + EV objetivo) / p.
//
// 4. LA SENSIBILIDAD DEL PRECIO. Cuánto EV desaparece si la cuota baja un escalón o la línea se mueve medio
//    punto. Es la diferencia entre una ventaja robusta y una que vive de un decimal.
//
// PURO: entran cuotas y una distribución, salen precios. Sin red, sin disco, sin db.
'use strict';

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// ---- CONVERSIONES ----------------------------------------------------------------------------------------
const impliedFromDecimal = (o) => (o > 1 ? 1 / o : null);
const americanToDecimal = (a) => (a == null ? null : a < 0 ? 1 + 100 / -a : 1 + a / 100);
const decimalToAmerican = (o) => (o == null || o <= 1 ? null : o >= 2 ? Math.round((o - 1) * 100) : -Math.round(100 / (o - 1)));

// ---- 1) QUITAR EL VIG ------------------------------------------------------------------------------------
// PROPORCIONAL: p_i = q_i / Σq. Simple y sesgado en los extremos.
function novigProportional(qs) {
  const s = qs.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return null;
  return qs.map((q) => q / s);
}
// POTENCIA: busca k tal que Σ q_i^k = 1. Reparte el margen de forma no lineal, que es como se comporta de
// verdad: al favorito se le quita menos margen relativo que al perdedor.
function novigPower(qs, { iters = 60 } = {}) {
  if (qs.some((q) => !(q > 0))) return null;
  let lo = 0.2, hi = 3;
  const f = (k) => qs.reduce((s, q) => s + Math.pow(q, k), 0) - 1;
  if (f(lo) * f(hi) > 0) return novigProportional(qs);
  for (let i = 0; i < iters; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  const k = (lo + hi) / 2;
  return qs.map((q) => Math.pow(q, k));
}
// SHIN: modela el margen como la fracción `z` de dinero informado en el mercado. Es el que mejor se porta
// en mercados de dos salidas con favoritos claros, que es justo donde vive el baloncesto.
function novigShin(qs, { iters = 80 } = {}) {
  if (qs.length !== 2 || qs.some((q) => !(q > 0))) return null;
  const S = qs.reduce((a, b) => a + b, 0);
  if (S <= 1) return novigProportional(qs);
  const p = (z) => qs.map((q) => (Math.sqrt(z * z + 4 * (1 - z) * (q * q) / S) - z) / (2 * (1 - z)));
  let lo = 1e-6, hi = 0.5;
  const g = (z) => p(z).reduce((a, b) => a + b, 0) - 1;
  if (g(lo) * g(hi) > 0) return novigProportional(qs);
  for (let i = 0; i < iters; i++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) <= 0) hi = mid; else lo = mid; }
  return p((lo + hi) / 2);
}
// Fachada: devuelve las probabilidades sin vig CON el método usado, siempre. Un precio sin su método no es
// reproducible, y un backtest que no se puede reproducir no es evidencia.
function novig(decimals, { method = 'shin' } = {}) {
  const qs = decimals.map(impliedFromDecimal);
  if (qs.some((q) => q == null)) return null;
  const s = qs.reduce((a, b) => a + b, 0);
  let ps = null, used = method;
  if (method === 'shin' && qs.length === 2) ps = novigShin(qs);
  if (!ps && (method === 'power' || method === 'shin')) { ps = novigPower(qs); used = 'power'; }
  if (!ps) { ps = novigProportional(qs); used = 'proportional'; }
  const norm = ps.reduce((a, b) => a + b, 0);
  return { p: ps.map((x) => r4(x / norm)), vig_pct: r2(100 * (s - 1)), method: used, overround: r4(s) };
}

// ---- 2) CONSENSO PONDERADO -------------------------------------------------------------------------------
// No todas las casas informan igual. Las que mueven primero y aguantan límites altos pesan más; una cuota de
// hace veinte minutos pesa menos que una de hace dos. El consenso es la mediana ponderada, no la media:
// una casa con un error de tecleo no puede arrastrar el precio de referencia.
const BOOK_TIER = { pinnacle: 3, betfair: 2.5, circa: 2.5, betonlineag: 2, bookmaker: 2, lowvig: 2,
  draftkings: 1.6, fanduel: 1.6, betmgm: 1.4, caesars: 1.4, pointsbetus: 1.2, betrivers: 1.2, williamhill_us: 1.2 };
const bookWeight = (name) => BOOK_TIER[String(name || '').toLowerCase().replace(/[^a-z]/g, '')] || 1;

function weightedMedian(items) {
  const rows = items.filter((x) => Number.isFinite(x.v) && x.w > 0).sort((a, b) => a.v - b.v);
  if (!rows.length) return null;
  const tot = rows.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const r of rows) { acc += r.w; if (acc >= tot / 2) return r.v; }
  return rows[rows.length - 1].v;
}

// `quotes`: [{ book, odds, at }]. Devuelve el precio de consenso y el MEJOR precio disponible.
function consensus(quotes, { now = null, halfLifeMin = 25 } = {}) {
  const t0 = now || Date.now();
  const rows = (quotes || []).map((q) => {
    const ageMin = q.at ? Math.max(0, (t0 - new Date(q.at).getTime()) / 60000) : 0;
    const fresh = Math.pow(0.5, ageMin / halfLifeMin);
    return { book: q.book, o: q.odds, v: impliedFromDecimal(q.odds), w: bookWeight(q.book) * fresh, age_min: r2(ageMin), fresh: r4(fresh) };
  }).filter((r) => r.v != null);
  if (!rows.length) return null;
  const q = weightedMedian(rows);
  const best = rows.reduce((a, b) => (!a || b.o > a.o ? b : a), null);
  const sharp = rows.filter((r) => bookWeight(r.book) >= 2);
  return {
    implied: r4(q), decimal: r2(1 / q), books: rows.length,
    best: { book: best.book, odds: r2(best.o), age_min: best.age_min },
    sharp_implied: sharp.length ? r4(weightedMedian(sharp)) : null,
    stale_share: r4(rows.filter((r) => r.age_min > 60).length / rows.length),
    rows: rows.sort((a, b) => b.o - a.o).slice(0, 12).map((r) => ({ book: r.book, odds: r2(r.o), age_min: r.age_min })),
  };
}

// ---- 3) PROBABILIDAD CON EMPUJE --------------------------------------------------------------------------
// Para un hándicap o total, la distribución simulada da tres números y no dos. `samples` es el histograma
// de márgenes (o totales) del simulador; se cuenta exactamente cuántas veces cae en la línea.
// Con línea entera, el empuje devuelve la apuesta: el EV correcto usa p_gana/(p_gana+p_pierde) como
// probabilidad efectiva, no p_gana a secas.
function pushAware(hist, line, side, { kind = 'spread' } = {}) {
  // hist: [[valor, prob], ...] discreto y exhaustivo
  let win = 0, push = 0, lose = 0;
  for (const [v, p] of hist || []) {
    let cmp;
    if (kind === 'total') cmp = v - line;                        // over gana si total > línea
    else cmp = v + line;                                          // spread: margen local + handicap
    if (Math.abs(cmp) < 1e-9) push += p;
    else if (cmp > 0) win += p;
    else lose += p;
  }
  const tot = win + push + lose;
  if (!(tot > 0)) return null;
  win /= tot; push /= tot; lose /= tot;
  const isOver = side === 'over' || side === 'home';
  const w = isOver ? win : lose, l = isOver ? lose : win;
  const eff = w + l > 0 ? w / (w + l) : null;                     // probabilidad efectiva, ya sin el empuje
  return { win: r4(w), push: r4(push), lose: r4(l), effective: r4(eff), integer_line: Number.isInteger(line) };
}

// ---- 4) PRECIO JUSTO, EV, MÍNIMO JUGABLE Y SENSIBILIDAD --------------------------------------------------
// EV por unidad a decimal o con probabilidad p: EV = p·o − 1. Con empuje, el capital vuelve: se usa la
// probabilidad efectiva y se apuesta solo la parte que se resuelve.
function priceRow({ p, pushProb = 0, odds, targetEv = 0.02, tick = 0.05 }) {
  if (!(p > 0) || !(odds > 1)) return null;
  const pEff = pushProb > 0 ? p / (1 - pushProb) : p;             // p viene ya condicionada si hay empuje
  const fair = 1 / pEff;
  const ev = pushProb > 0 ? (1 - pushProb) * (pEff * odds - 1) : (p * odds - 1);
  const oMin = (1 + targetEv) / pEff;
  const evAt = (o) => (pushProb > 0 ? (1 - pushProb) * (pEff * o - 1) : (p * o - 1));
  return {
    p: r4(p), p_effective: r4(pEff), push: r4(pushProb),
    fair_odds: r2(fair), fair_american: decimalToAmerican(fair),
    odds: r2(odds), american: decimalToAmerican(odds),
    edge_pp: r2(100 * (pEff - 1 / odds)),
    ev_pct: r2(100 * ev),
    min_playable: r2(oMin), min_playable_american: decimalToAmerican(oMin),
    // SENSIBILIDAD: cuánto EV queda si el precio se degrada uno o dos escalones antes de que apuestes
    sensitivity: [1, 2, 3].map((k) => ({ ticks: k, odds: r2(odds - k * tick), ev_pct: r2(100 * evAt(odds - k * tick)) })),
    playable: odds >= oMin,
  };
}

// ---- 5) CUOTA RANCIA -------------------------------------------------------------------------------------
// Recomendar un precio que ya no existe es peor que no recomendar nada: destruye la confianza y además
// ensucia el registro de CLV con precios que nunca fueron ejecutables.
function staleness(quote, { now = null, warnMin = 20, blockMin = 75 } = {}) {
  const t0 = now || Date.now();
  if (!quote || !quote.at) return { known: false, block: false, note: 'sin marca de tiempo de la cuota' };
  const min = Math.max(0, (t0 - new Date(quote.at).getTime()) / 60000);
  return { known: true, age_min: r2(min), warn: min >= warnMin, block: min >= blockMin,
    note: min >= blockMin ? 'precio demasiado viejo para recomendarlo' : min >= warnMin ? 'precio con cierta antigüedad: verificar antes de ejecutar' : null };
}

// ---- 6) KELLY CON ERROR DE ESTIMACIÓN --------------------------------------------------------------------
// Kelly crudo sobre una p estimada apuesta de más SIEMPRE, porque el error de p entra al cuadrado en el
// tamaño. Se usa el límite inferior de confianza de p y una fracción del Kelly resultante, y se topa.
function kelly({ p, odds, se = null, fraction = 0.25, cap = 0.02, z = 1 }) {
  if (!(p > 0) || !(odds > 1)) return null;
  const pLo = se != null ? Math.max(0.001, p - z * se) : p;
  const b = odds - 1, q = 1 - pLo;
  const raw = (b * pLo - q) / b;
  const f = Math.max(0, raw) * fraction;
  return { p, p_lower: r4(pLo), kelly_raw: r4((b * p - (1 - p)) / b), kelly_lcb: r4(raw),
    stake_frac: r4(Math.min(f, cap)), capped: f > cap, fraction, cap };
}

module.exports = {
  impliedFromDecimal, americanToDecimal, decimalToAmerican,
  novig, novigProportional, novigPower, novigShin,
  consensus, bookWeight, weightedMedian,
  pushAware, priceRow, staleness, kelly,
};
