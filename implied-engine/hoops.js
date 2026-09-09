// implied-engine/hoops.js — EL PROCESO IMPLÍCITO DEL BALONCESTO: SPREAD ↔ MONEYLINE ↔ TOTAL (9-sep)
//
// Misma idea que en fútbol y tenis de mesa, con un proceso más simple: el margen final se comporta como una
// normal N(μ, σ) con σ casi constante por liga (≈12 puntos en la NBA, ≈11,5 en la WNBA). Una casa cotiza el
// mismo μ dos veces: en el hándicap (P(margen > −línea)) y en el ganador (P(margen > 0)). Si se invierten los
// dos precios:
//     z_ml = Φ⁻¹(p_ganador)          z_sp = Φ⁻¹(p_cubre)
//     μ = σ·z_ml                     μ + línea = σ·z_sp        ⇒  σ_implícita = línea / (z_sp − z_ml)
// la casa revela SU σ. Si esa σ se aleja de la de la liga, hándicap y ganador se contradicen, y hay dos tesis
// espejo: confiar en el hándicap y apostar el ganador (IMPLIED_ML), o al revés (IMPLIED_SPREAD). El total no
// tiene pareja en la misma casa (salvo totales por equipo) → entra solo como desviación frente al tablero
// (BOOK_DEV), igual que en fútbol.
//
// Por qué importa aquí. La autopsia del 2-sep: en WNBA "el mercado se mueve en contra en cada hándicap" y el
// backtest al cierre da −7,27 % en NBA. Ninguna tesis de este módulo usa el modelo de posesiones: solo precios.
'use strict';

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// σ del margen por liga (puntos). Valores de referencia de la literatura y de nuestros propios residuos
// (basketball-engine): se pueden sobreescribir por `opts.sigma`.
const SIGMA = { nba: 12.4, wnba: 11.6, ncaab: 10.8, euroleague: 11.2, default: 12.0 };

// ── NORMAL ──────────────────────────────────────────────────────────────────────────────────────────────
function Phi(x) { // erf de Abramowitz-Stegun 7.1.26 (|err| < 1,5e-7)
  const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}
function PhiInv(p) { // Acklam
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > ph) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function devig2(oa, ob) {
  if (!(oa > 1 && ob > 1)) return null;
  const ia = 1 / oa, ib = 1 / ob, s = ia + ib;
  return { a: ia / s, b: ib / s, overround: +(s - 1).toFixed(4) };
}

// ── ANALIZAR UNA CASA ───────────────────────────────────────────────────────────────────────────────────
// book: { code, spread: { line (del LOCAL, negativo si favorito), home, away }, ml: { home, away }, total: { line, over, under } }
// Todo desde el punto de vista del local. p_cover = P(margen_local + línea > 0).
function analyzeBook(book, { league = 'default', sigma } = {}) {
  const s0 = sigma || SIGMA[String(league || '').toLowerCase()] || SIGMA.default;
  const out = { code: book.code, sigma_league: s0, spread: null, ml: null, total: null, implied: null, theses: [] };
  const sp = book.spread, ml = book.ml, tt = book.total;
  if (sp && Number.isFinite(sp.line) && sp.home > 1 && sp.away > 1) {
    const d = devig2(sp.home, sp.away);
    out.spread = { line: sp.line, p_cover: r4(d.a), overround: d.overround, mu: r4(s0 * PhiInv(d.a) - sp.line) };   // μ que dice el hándicap con σ de liga
  }
  if (ml && ml.home > 1 && ml.away > 1) {
    const d = devig2(ml.home, ml.away);
    out.ml = { p_home: r4(d.a), overround: d.overround, mu: r4(s0 * PhiInv(d.a)) };                                  // μ que dice el ganador con σ de liga
  }
  if (tt && Number.isFinite(tt.line) && tt.over > 1 && tt.under > 1) {
    const d = devig2(tt.over, tt.under);
    out.total = { line: tt.line, p_over: r4(d.a), overround: d.overround, expected: r4(tt.line + 0.0) };
  }
  if (out.spread && out.ml) {
    const zs = PhiInv(out.spread.p_cover), zm = PhiInv(out.ml.p_home);
    const den = zs - zm;
    // σ implícita de la propia casa: solo tiene sentido con una línea distinta de 0 y los dos z separados
    const sigmaImp = Math.abs(sp.line) >= 1 && Math.abs(den) > 0.02 ? sp.line / den : null;
    out.implied = { sigma: r4(sigmaImp), mu: sigmaImp ? r4(sigmaImp * zm) : null, delta_mu: r4(out.ml.mu - out.spread.mu),
      sigma_ratio: sigmaImp ? r4(sigmaImp / s0) : null, coherent: sigmaImp ? Math.abs(sigmaImp / s0 - 1) < 0.25 : null };
    // tesis espejo con σ de liga:
    // IMPLIED_ML: el hándicap dice μ_sp → ganador coherente Φ(μ_sp/σ) vs p_ml de la casa
    const pMlCoh = Phi(out.spread.mu / s0);
    const eMl = 100 * (pMlCoh - out.ml.p_home);
    const sideMl = eMl >= 0 ? 'home' : 'away';
    out.theses.push({ family: 'IMPLIED_ML', side: sideMl, line: null, odds: ml[sideMl],
      p_coherent: r4(sideMl === 'home' ? pMlCoh : 1 - pMlCoh), p_market: r4(sideMl === 'home' ? out.ml.p_home : 1 - out.ml.p_home),
      edge_pp: r2(Math.abs(eMl)), basis: `hándicap ${sp.line} → μ ${out.spread.mu} (σ ${s0}) vs ganador ${out.ml.p_home}` });
    // IMPLIED_SPREAD: el ganador dice μ_ml → cubre coherente Φ((μ_ml + línea)/σ) vs p_cover de la casa
    const pCovCoh = Phi((out.ml.mu + sp.line) / s0);
    const eSp = 100 * (pCovCoh - out.spread.p_cover);
    const sideSp = eSp >= 0 ? 'home' : 'away';
    out.theses.push({ family: 'IMPLIED_SPREAD', side: sideSp, line: sideSp === 'home' ? sp.line : -sp.line, odds: sp[sideSp],
      p_coherent: r4(sideSp === 'home' ? pCovCoh : 1 - pCovCoh), p_market: r4(sideSp === 'home' ? out.spread.p_cover : 1 - out.spread.p_cover),
      edge_pp: r2(Math.abs(eSp)), basis: `ganador ${out.ml.p_home} → μ ${out.ml.mu} (σ ${s0}) vs hándicap ${sp.line}` });
  }
  return out;
}

// ── ANALIZAR UN PARTIDO ─────────────────────────────────────────────────────────────────────────────────
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function analyzeGame(books, opts = {}) {
  // primera pasada con la σ de referencia (liga o tablero); si ≥ 3 casas del MISMO partido revelan su σ implícita,
  // la mediana de esas es la base del partido y las tesis se recalculan con ella (mismo principio que en fútbol:
  // lo común a todas las casas es forma del modelo, lo que queda es lo que ESTA casa hace distinto)
  let per = (books || []).map((b) => analyzeBook(b, opts));
  const sigs = per.map((b) => b.implied && b.implied.sigma).filter((x) => Number.isFinite(x) && x > 5 && x < 25);
  const sigmaGame = sigs.length >= 3 ? median(sigs) : null;
  if (sigmaGame) per = (books || []).map((b) => analyzeBook(b, { ...opts, sigma: sigmaGame }));
  const mus = per.map((b) => (b.implied && b.implied.mu != null) ? b.implied.mu : b.spread ? b.spread.mu : b.ml ? b.ml.mu : null).filter(Number.isFinite);
  const tots = per.filter((b) => b.total).map((b) => b.total.line);
  const consensus = { mu: r4(median(mus)), total: r4(median(tots)), n_books: per.length, sigma_implied_median: r4(median(per.map((b) => b.implied && b.implied.sigma).filter(Number.isFinite))), sigma_game: r4(sigmaGame) };
  const dev = [];
  if (per.length >= 3) {
    const s0 = per[0].sigma_league;
    for (const b of per) {
      const src = (books || []).find((x) => x.code === b.code) || {};
      // hándicap de la casa vs μ del tablero
      if (b.spread && consensus.mu != null) {
        const pCoh = Phi((consensus.mu + b.spread.line) / s0);
        const e = 100 * (pCoh - b.spread.p_cover), side = e >= 0 ? 'home' : 'away';
        dev.push({ family: 'BOOK_DEV_SPREAD', code: b.code, side, line: side === 'home' ? b.spread.line : -b.spread.line, odds: src.spread ? src.spread[side] : null,
          p_coherent: r4(side === 'home' ? pCoh : 1 - pCoh), p_market: r4(side === 'home' ? b.spread.p_cover : 1 - b.spread.p_cover), edge_pp: r2(Math.abs(e)), n_books: per.length,
          basis: `μ del tablero ${consensus.mu} vs hándicap ${b.spread.line} de ${b.code}` });
      }
      // ganador de la casa vs μ del tablero
      if (b.ml && consensus.mu != null) {
        const pCoh = Phi(consensus.mu / s0);
        const e = 100 * (pCoh - b.ml.p_home), side = e >= 0 ? 'home' : 'away';
        dev.push({ family: 'BOOK_DEV_ML', code: b.code, side, line: null, odds: src.ml ? src.ml[side] : null,
          p_coherent: r4(side === 'home' ? pCoh : 1 - pCoh), p_market: r4(side === 'home' ? b.ml.p_home : 1 - b.ml.p_home), edge_pp: r2(Math.abs(e)), n_books: per.length,
          basis: `μ del tablero ${consensus.mu} (σ ${s0}) vs ganador ${b.ml.p_home} de ${b.code}` });
      }
      // total de la casa vs mediana de totales: la desviación en puntos se pasa a probabilidad con σ_total ≈ 1,6·σ
      if (b.total && consensus.total != null) {
        const sT = 1.6 * s0;
        const pCoh = Phi((consensus.total - b.total.line) / sT);
        const e = 100 * (pCoh - b.total.p_over), side = e >= 0 ? 'over' : 'under';
        dev.push({ family: 'BOOK_DEV_TOTAL', code: b.code, side, line: b.total.line, odds: src.total ? src.total[side] : null,
          p_coherent: r4(side === 'over' ? pCoh : 1 - pCoh), p_market: r4(side === 'over' ? b.total.p_over : 1 - b.total.p_over), edge_pp: r2(Math.abs(e)), n_books: per.length,
          basis: `total del tablero ${consensus.total} vs ${b.total.line} de ${b.code}` });
      }
    }
  }
  return { books: per, consensus, deviations: dev };
}

// ── AUTOCOMPROBACIÓN ────────────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const s0 = SIGMA.nba, mu = 4.2, line = -4.5, m = 1.045;
  const pCov = Phi((mu + line) / s0), pMl = Phi(mu / s0);
  const book = { code: 't', spread: { line, home: 1 / (pCov * m), away: 1 / ((1 - pCov) * m) }, ml: { home: 1 / (pMl * m), away: 1 / ((1 - pMl) * m) } };
  const a = analyzeBook(book, { league: 'nba' });
  const errSigma = Math.abs(a.implied.sigma - s0), errMu = Math.abs(a.implied.mu - mu);
  const edge0 = Math.max(...a.theses.map((t) => t.edge_pp));
  const zz = Math.abs(PhiInv(Phi(1.2345)) - 1.2345);
  return { ok: errSigma < 0.05 && errMu < 0.05 && edge0 < 0.3 && zz < 1e-5, errSigma: r4(errSigma), errMu: r4(errMu), edge_coherente_pp: r2(edge0), inv_err: r4(zz), implied: a.implied };
}

module.exports = { SIGMA, Phi, PhiInv, devig2, analyzeBook, analyzeGame, selfTest };
