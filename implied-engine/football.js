// implied-engine/football.js — EL PROCESO IMPLÍCITO DEL FÚTBOL: 1X2 ↔ TOTAL (9-sep)
//
// La idea, traída de tenis de mesa. En TT el mercado cotiza el ganador y el total de puntos como si fueran dos
// preguntas distintas; el compilador dice que salen de UN solo proceso (la probabilidad de punto). Si se invierte
// cada precio a ese proceso y los dos no coinciden, la casa se contradice a sí misma — y eso es una señal de
// PRECIO, no una opinión del modelo. En fútbol el proceso es el par de tasas de gol (λ_local, λ_visitante) y la
// matriz de marcador Poisson + Dixon-Coles que ya usa el motor de goles (`goal-engine/distribution`).
//
//   1X2 sin margen  ──invertir──►  (λh, λa)   ──►  total esperado T₁ = λh + λa
//   total sin margen ─invertir──►  λ_T(L)     ──►  con el reparto del 1X2, un 1X2 coherente
//
// La INCOHERENCIA de una casa es T₁ − λ_T. Da dos tesis espejo, y la sombra dirá cuál acierta:
//   · IMPLIED_TOTAL: confiar en el 1X2 de la casa y apostar el total que cotiza incoherente.
//   · IMPLIED_1X2:   confiar en el total y apostar el lado del 1X2 incoherente.
// Y una tercera, la corrección 2 del 23-ago hecha operativa: BOOK_DEV, la desviación del proceso de UNA casa
// frente a la mediana de todas (puro precio, sin modelo). Este módulo es PURO: recibe cuotas, devuelve números.
//
// Por qué no es "el modelo otra vez". Aquí no entra ninguna λ nuestra: las tres familias se construyen solo con
// los precios de la casa. El motor de goles solo aporta la FORMA de la distribución (Poisson + DC), que es la
// misma que usan las casas para derivar sus propios mercados.
'use strict';

const dist = require('../goal-engine/distribution');

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// ── QUITAR EL MARGEN ────────────────────────────────────────────────────────────────────────────────────
// Proporcional (la que usa `goal-engine/noVig`) y Shin (reparte el margen hacia los perros, que es donde las
// casas lo esconden; `docs/DEVIG_SHIN_MEDIDO.md`: corrige la mitad del sesgo favorito-longshot). Por defecto
// Shin para el 1X2 (tres vías, el sesgo importa) y proporcional para los pares (dos vías, casi iguales).
function devigProportional(odds) {
  const inv = odds.map((o) => (o > 1 ? 1 / o : NaN));
  if (inv.some((x) => !Number.isFinite(x))) return null;
  const s = inv.reduce((a, b) => a + b, 0);
  return { probs: inv.map((x) => x / s), overround: +(s - 1).toFixed(4), method: 'proportional' };
}
function devigShin(odds) {
  const inv = odds.map((o) => (o > 1 ? 1 / o : NaN));
  if (inv.some((x) => !Number.isFinite(x))) return null;
  const s = inv.reduce((a, b) => a + b, 0);
  if (s <= 1) return devigProportional(odds);
  const n = inv.length;
  // z (proporción de dinero informado) por iteración de punto fijo: z = Σ[√(z² + 4(1−z)·π_i²/s) − z] / (2(n−1))
  let z = 0.02;
  for (let it = 0; it < 60; it++) {
    let sum = 0;
    for (const pi of inv) sum += Math.sqrt(z * z + 4 * (1 - z) * (pi * pi) / s) - z;
    const nz = sum / (2 * (n - 1));
    if (Math.abs(nz - z) < 1e-10) { z = nz; break; }
    z = nz;
  }
  const probs = inv.map((pi) => (Math.sqrt(z * z + 4 * (1 - z) * (pi * pi) / s) - z) / (2 * (1 - z)));
  const t = probs.reduce((a, b) => a + b, 0);
  return { probs: probs.map((p) => p / t), overround: +(s - 1).toFixed(4), method: 'shin', z: +z.toFixed(4) };
}

// ── INVERTIR ────────────────────────────────────────────────────────────────────────────────────────────
// 1X2 sin margen → (λh, λa). Parametrizado por total T = λh + λa y reparto s = λh / T. El empate baja con T y
// la diferencia local−visitante sube con s; se alternan bisecciones sobre cada uno hasta que las tres
// probabilidades casan. Diez rondas bastan para 1e-4.
const cache1x2 = new Map();
function invert1x2(pH, pD, pA) {
  if (!(pH > 0 && pD > 0 && pA > 0)) return null;
  const key = `${pH.toFixed(4)}|${pD.toFixed(4)}`;
  const hit = cache1x2.get(key); if (hit) return hit;
  const raw = (T, s) => dist.oneX2FromMatrix(dist.buildMatrix(T * s, T * (1 - s)).matrix).raw;
  const ratioTarget = pH / (pH + pA);
  let T = 2.6, s = 0.5;
  for (let round = 0; round < 10; round++) {
    // T por el empate (decrece con T)
    let lo = 0.6, hi = 7.0;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; const d = raw(mid, s).draw; if (d > pD) lo = mid; else hi = mid; }
    T = (lo + hi) / 2;
    // s por el reparto local/(local+visitante) (crece con s)
    lo = 0.08; hi = 0.92;
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; const r = raw(T, mid); const rt = r.home / (r.home + r.away); if (rt < ratioTarget) lo = mid; else hi = mid; }
    s = (lo + hi) / 2;
  }
  const fit = raw(T, s);
  const err = Math.abs(fit.home - pH) + Math.abs(fit.draw - pD) + Math.abs(fit.away - pA);
  const out = { lh: r4(T * s), la: r4(T * (1 - s)), total: r4(T), share: r4(s), fit_err: r4(err), fit: { home: r4(fit.home), draw: r4(fit.draw), away: r4(fit.away) } };
  if (cache1x2.size > 5000) cache1x2.clear();
  cache1x2.set(key, out);
  return out;
}

// P(más de L goles) sin margen → λ_T con el reparto `share` fijo. Bisección sobre λ_T (crece con λ_T).
function invertTotal(pOver, line, share = 0.5) {
  if (!(pOver > 0 && pOver < 1) || !Number.isFinite(line)) return null;
  const over = (T) => dist.overUnder(dist.buildMatrix(T * share, T * (1 - share)).matrix, line).over;
  let lo = 0.3, hi = 9.0;
  for (let i = 0; i < 45; i++) { const mid = (lo + hi) / 2; if (over(mid) < pOver) lo = mid; else hi = mid; }
  const T = (lo + hi) / 2;
  return { total: r4(T), lh: r4(T * share), la: r4(T * (1 - share)), fit_over: r4(over(T)) };
}

// Lo que la casa DEBERÍA cotizar en un mercado si su otro mercado dice la verdad.
function coherentOver(lh, la, line) { return dist.overUnder(dist.buildMatrix(lh, la).matrix, line).over; }
function coherent1x2(lh, la) { return dist.oneX2FromMatrix(dist.buildMatrix(lh, la).matrix).raw; }

// ── ANALIZAR UNA CASA ───────────────────────────────────────────────────────────────────────────────────
// book: { code, x2: { home, draw, away } (cuotas), totals: [{ line, over, under }] }
// Devuelve el proceso implícito del 1X2, el de cada total y las tesis espejo con su edge en pp.
// `deltaBaseline` (goles): la incoherencia MEDIANA del tablero, que se descuenta antes de leer la de esta casa.
// La forma Poisson + Dixon-Coles reproduce un empate dado con MÁS goles de los que el mercado de totales
// cotiza (el ρ de DC infla 0-0 y 1-1), así que sin descontar la base todas las casas dirían "over" a la vez;
// eso es un sesgo de forma, no una señal. Con la base descontada solo queda lo que ESTA casa hace distinto.
function analyzeBook(book, { devig1x2 = 'shin', deltaBaseline = 0 } = {}) {
  const out = { code: book.code, x2: null, totals: [], theses: [], delta_baseline: deltaBaseline || 0 };
  const dB = Number.isFinite(deltaBaseline) ? deltaBaseline : 0;
  if (!book.x2 || !(book.x2.home > 1 && book.x2.draw > 1 && book.x2.away > 1)) return out;
  const dv = (devig1x2 === 'shin' ? devigShin : devigProportional)([book.x2.home, book.x2.draw, book.x2.away]);
  if (!dv) return out;
  const [pH, pD, pA] = dv.probs;
  const inv = invert1x2(pH, pD, pA);
  if (!inv || inv.fit_err > 0.02) return out;              // un 1X2 que la Poisson no puede reproducir no se usa
  out.x2 = { p: { home: r4(pH), draw: r4(pD), away: r4(pA) }, overround: dv.overround, method: dv.method, lh: inv.lh, la: inv.la, total: inv.total, share: inv.share, fit_err: inv.fit_err };

  for (const t of book.totals || []) {
    if (!(t.over > 1 && t.under > 1) || !Number.isFinite(t.line)) continue;
    const pv = devigProportional([t.over, t.under]); if (!pv) continue;
    const pOver = pv.probs[0];
    const it = invertTotal(pOver, t.line, inv.share); if (!it) continue;
    // el 1X2 "corregido" por la base del tablero dice este total; el total "corregido" dice este 1X2
    const T1 = Math.max(0.3, inv.total + dB), TT = Math.max(0.3, it.total - dB);
    const cohOver = coherentOver(T1 * inv.share, T1 * (1 - inv.share), t.line);   // total que dice el 1X2
    const c12 = coherent1x2(TT * inv.share, TT * (1 - inv.share));               // 1X2 que dice el total
    const row = {
      line: t.line, p_over: r4(pOver), overround: pv.overround, lambda_total: it.total,
      delta_goals: r4(it.total - inv.total),                         // >0: el total cotiza MÁS goles que el 1X2 (crudo)
      delta_adj: r4(it.total - inv.total - dB),                      // lo mismo con la base del tablero descontada
      coherent_over: r4(cohOver), edge_over_pp: r2(100 * (cohOver - pOver)), edge_under_pp: r2(100 * ((1 - cohOver) - (1 - pOver))),
      coherent_x2: { home: r4(c12.home), draw: r4(c12.draw), away: r4(c12.away) },
      edge_x2_pp: { home: r2(100 * (c12.home - pH)), draw: r2(100 * (c12.draw - pD)), away: r2(100 * (c12.away - pA)) },
    };
    out.totals.push(row);
    // tesis espejo: el lado del total que el 1X2 dice que está barato, y el lado del 1X2 que el total dice barato
    const sideT = row.edge_over_pp >= 0 ? 'over' : 'under';
    out.theses.push({ family: 'IMPLIED_TOTAL', side: sideT, line: t.line, odds: sideT === 'over' ? t.over : t.under,
      p_coherent: r4(sideT === 'over' ? cohOver : 1 - cohOver), p_market: r4(sideT === 'over' ? pOver : 1 - pOver),
      edge_pp: Math.abs(row.edge_over_pp), basis: `1X2 → λ ${inv.lh}+${inv.la} = ${inv.total}${dB ? ` (base del tablero ${r4(dB)})` : ''} vs total ${t.line} → λ ${it.total}` });
    const bestX = ['home', 'draw', 'away'].sort((a, b) => row.edge_x2_pp[b] - row.edge_x2_pp[a])[0];
    out.theses.push({ family: 'IMPLIED_1X2', side: bestX, line: t.line, odds: book.x2[bestX],
      p_coherent: c12[bestX], p_market: r4({ home: pH, draw: pD, away: pA }[bestX]), edge_pp: row.edge_x2_pp[bestX],
      basis: `total ${t.line} → λ ${it.total} (reparto ${inv.share}) vs 1X2 → λ ${inv.total}` });
  }
  return out;
}

// ── ANALIZAR UN PARTIDO (varias casas) ──────────────────────────────────────────────────────────────────
// books: [book]. Además de cada casa, la mediana de procesos del tablero y la desviación de cada casa
// frente a ella (BOOK_DEV): qué casa cotiza más o menos goles que el consenso EN SU PROPIO 1X2 o total.
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
function analyzeMatch(books, opts = {}) {
  // cada casa se invierte SIN base global: la base que importa es la del MISMO partido (abajo)
  const per = (books || []).map((b) => analyzeBook(b, { devig1x2: opts.devig1x2, deltaBaseline: 0 })).filter((b) => b.x2);
  const consensus = { total_1x2: median(per.map((b) => b.x2.total)), share: median(per.map((b) => b.x2.share)), n_books: per.length, by_line: {} };
  const lines = {};
  for (const b of per) for (const t of b.totals) (lines[t.line] = lines[t.line] || []).push({ code: b.code, lambda: t.lambda_total, p_over: t.p_over, delta: t.delta_goals });
  for (const [L, arr] of Object.entries(lines)) consensus.by_line[L] = { lambda_total: median(arr.map((x) => x.lambda)), p_over: median(arr.map((x) => x.p_over)), delta_median: median(arr.map((x) => x.delta)), n_books: arr.length };

  // ── LA BASE ES LA DEL PARTIDO, NO LA DEL TABLERO (v2, 9-sep 01:00Z) ─────────────────────────────────────
  // La primera hora en prod enseñó que una base GLOBAL no basta: en un partido muy desigual (Barcelona–Feyenoord)
  // la Poisson+DC solo reproduce el empate del mercado con λ absurdas (5,5+0,6), y la incoherencia 1X2↔total sale
  // de +14 pp EN TODAS las casas — eso es error de FORMA del modelo, no señal. La mediana de la incoherencia
  // entre las casas del mismo partido absorbe ese error (es común a todas) y deja solo lo que ESTA casa hace
  // distinto de sus pares: su 1X2 y su total se contradicen MÁS que los de las demás. Exige ≥ 3 casas en la línea.
  const theses = [];
  for (const b of per) {
    const src = (books || []).find((x) => x.code === b.code) || {};
    for (const t of b.totals) {
      const c = consensus.by_line[t.line]; if (!c || c.n_books < 3 || !Number.isFinite(c.delta_median)) continue;
      const m = c.delta_median;
      const T1 = Math.max(0.3, b.x2.total + m), TT = Math.max(0.3, t.lambda_total - m);
      const cohOver = coherentOver(T1 * b.x2.share, T1 * (1 - b.x2.share), t.line);
      const c12 = coherent1x2(TT * b.x2.share, TT * (1 - b.x2.share));
      const tq = (src.totals || []).find((x) => x.line === t.line) || {};
      const eOver = 100 * (cohOver - t.p_over);
      const sideT = eOver >= 0 ? 'over' : 'under';
      theses.push({ code: b.code, family: 'IMPLIED_TOTAL', side: sideT, line: t.line, odds: sideT === 'over' ? tq.over : tq.under,
        p_coherent: r4(sideT === 'over' ? cohOver : 1 - cohOver), p_market: r4(sideT === 'over' ? t.p_over : 1 - t.p_over),
        edge_pp: r2(Math.abs(eOver)), rel_delta_goals: r4(t.delta_goals - m), n_books: c.n_books,
        basis: `1X2 de ${b.code} → λ ${b.x2.total} + base del partido ${r4(m)} (${c.n_books} casas) vs total ${t.line} → λ ${t.lambda_total}` });
      const pX = { home: b.x2.p.home, draw: b.x2.p.draw, away: b.x2.p.away };
      const eX = { home: 100 * (c12.home - pX.home), draw: 100 * (c12.draw - pX.draw), away: 100 * (c12.away - pX.away) };
      const bestX = ['home', 'draw', 'away'].sort((a, z) => eX[z] - eX[a])[0];
      theses.push({ code: b.code, family: 'IMPLIED_1X2', side: bestX, line: t.line, odds: src.x2 ? src.x2[bestX] : null,
        p_coherent: r4(c12[bestX]), p_market: r4(pX[bestX]), edge_pp: r2(eX[bestX]), rel_delta_goals: r4(t.delta_goals - m), n_books: c.n_books,
        basis: `total ${t.line} de ${b.code} → λ ${t.lambda_total} − base del partido ${r4(m)} vs su 1X2 → λ ${b.x2.total}` });
    }
  }

  // BOOK_DEV: la desviación del TOTAL de una casa frente a la mediana de ≥ 3 casas (puro precio, sin inversión del 1X2)
  const dev = [];
  if (per.length >= 3) {
    for (const b of per) {
      for (const t of b.totals) {
        const c = consensus.by_line[t.line]; if (!c || c.n_books < 3) continue;
        const cohOverCons = coherentOver(c.lambda_total * consensus.share, c.lambda_total * (1 - consensus.share), t.line);
        const e = 100 * (cohOverCons - t.p_over);
        const side = e >= 0 ? 'over' : 'under';
        const src = (books || []).find((x) => x.code === b.code) || {};
        const tq = (src.totals || []).find((x) => x.line === t.line) || {};
        dev.push({ family: 'BOOK_DEV', code: b.code, side, line: t.line, odds: side === 'over' ? tq.over : tq.under,
          p_coherent: r4(side === 'over' ? cohOverCons : 1 - cohOverCons), p_market: r4(side === 'over' ? t.p_over : 1 - t.p_over),
          edge_pp: r2(Math.abs(e)), delta_goals: r4(t.lambda_total - c.lambda_total), n_books: c.n_books,
          basis: `total de ${b.code} → λ ${t.lambda_total} vs mediana de ${c.n_books} casas → λ ${r4(c.lambda_total)}` });
      }
    }
  }
  return { books: per, consensus, theses, deviations: dev };
}

// ── AUTOCOMPROBACIÓN ────────────────────────────────────────────────────────────────────────────────────
// Un 1X2 generado por la propia Poisson tiene que volver a sus λ; un total coherente tiene que dar edge 0.
function selfTest() {
  const lh = 1.55, la = 1.10;
  const r = dist.oneX2FromMatrix(dist.buildMatrix(lh, la).matrix).raw;
  const inv = invert1x2(r.home, r.draw, r.away);
  const errL = Math.abs(inv.lh - lh) + Math.abs(inv.la - la);
  const pOver = coherentOver(lh, la, 2.5);
  const it = invertTotal(pOver, 2.5, lh / (lh + la));
  const errT = Math.abs(it.total - (lh + la));
  // una casa coherente (mismas λ en 1X2 y total, con margen) → edge ≈ 0
  const m = 1.05;
  const book = { code: 'test', x2: { home: 1 / (r.home * m), draw: 1 / (r.draw * m), away: 1 / (r.away * m) }, totals: [{ line: 2.5, over: 1 / (pOver * 1.03), under: 1 / ((1 - pOver) * 1.03) }] };
  const a = analyzeBook(book, { devig1x2: 'proportional' });
  const edge0 = a.totals[0] ? Math.abs(a.totals[0].edge_over_pp) : 99;
  // tres casas coherentes entre sí con márgenes distintos → las tesis del partido tienen que salir ≈ 0
  const mk = (code, mm) => ({ code, x2: { home: 1 / (r.home * mm), draw: 1 / (r.draw * mm), away: 1 / (r.away * mm) }, totals: [{ line: 2.5, over: 1 / (pOver * (1 + (mm - 1) / 2)), under: 1 / ((1 - pOver) * (1 + (mm - 1) / 2)) }] });
  const mt = analyzeMatch([mk('a', 1.04), mk('b', 1.06), mk('c', 1.08)], { devig1x2: 'proportional' });
  const edgeM = Math.max(0, ...mt.theses.map((t) => Math.abs(t.edge_pp)));
  return { ok: errL < 0.01 && errT < 0.01 && edge0 < 0.6 && edgeM < 0.6, errL: r4(errL), errT: r4(errT), edge_coherente_pp: r2(edge0), edge_partido_coherente_pp: r2(edgeM), inv, it };
}

module.exports = { devigProportional, devigShin, invert1x2, invertTotal, coherentOver, coherent1x2, analyzeBook, analyzeMatch, selfTest };
