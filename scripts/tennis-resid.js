// scripts/tennis-resid.js — LA TABLA DE RESIDUOS DE JUEGOS (C6) PARA model-priors.json (2-sep)
//
// POR QUÉ. La distribución de juegos que puntúa el TOTAL en producción era la forma IID del compilador
// desplazada por la calibración lineal (store.js, `gamesPmf` método 'shift'). El backtest del 2-sep
// (docs/BACKTESTS_FAMILIAS_2026-09-02.md §6.4) demostró que esa forma está mal: la real es bimodal por
// número de sets, y en el bin 0,4-0,5 predecía over 45,1 % donde ocurría 40,7 %. La alternativa que
// sobrevivió al escéptico es C6: punto calibrado (calG) + residuo EMPÍRICO de desarrollo por formato ×
// tercil de juegos esperados (ATP bo3: Brier over/under 0,2421 → 0,2392, t 9,9; CRPS t 8,9).
//
// QUÉ HACE. La misma pasada cronológica del compilado que usan research/backtests-2026-09-02/tenis/pass.js
// y h3-total.js (constantes CONGELADAS de model-priors.json, market-blind), y sobre DESARROLLO
// (2018-01-01 → 2024-12-31, partidos completos con más de 5 juegos):
//   · cortes de tercil de `expGames` (el crudo del compilador, que es lo que producción compara) por formato
//   · histograma del residuo R = round(juegos reales − calG), con calG = gamesCal de PRODUCCIÓN
// y lo guarda en `tours.<tour>.constants.gamesResid = { bo3: {cuts, hist:[{r:p}×3], n}, bo5: {...} }`.
// Se guarda para ATP y WTA y para los dos formatos, pero store.js SOLO LO USA en ATP bo3: en bo5 (t 0,3-1,7)
// y en la WTA (cae) no está demostrado. Después imprime la comprobación en el HOLDOUT (2025→), que no se
// usa para nada más que para mirar: P(real > mediana) y Brier over/under en un abanico de seis líneas,
// desplazamiento contra C6, con su t pareado.
//
// FORMATO: la cola ESPN etiquetó best_of=5 en todos los partidos ATP hasta la reparación (§6.7): aquí el
// formato se toma del propio marcador (3 sets ganados → bo5, 2 → bo3) como en pass.js.
//
// USO: node scripts/tennis-resid.js            (lee data/tennis/*, ESCRIBE model-priors.json)
//      node scripts/tennis-resid.js --dry      (no escribe)
// Volver a correrlo tras cualquier re-fit (tennis-fit.js): cambia gamesCal y con él el residuo.
'use strict';

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'tennis-engine', 'compiler.js'));

const BASE = path.join(__dirname, '..', 'data', 'tennis');
const DRY = process.argv.includes('--dry');
const DEV_FROM = 20180101, DEV_END = +(process.env.GP_TEN_DEV_END || 20250101);
const { schema, rows } = JSON.parse(fs.readFileSync(path.join(BASE, 'matches.json'), 'utf8'));
const priors = JSON.parse(fs.readFileSync(path.join(BASE, 'model-priors.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(BASE, 'meta.json'), 'utf8'));
const F = {}; schema.forEach((k, i) => { F[k] = i; });
const TAIL_FROM = (meta.tail && meta.tail.from) || 99999999;

const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);

// ── distribuciones discretas {min, p[]} (misma mecánica que research/.../util.js) ─────────────────────────
function distFromPairs(pairs) { const min = pairs[0][0], max = pairs[pairs.length - 1][0]; const p = new Array(max - min + 1).fill(0); for (const [g, pr] of pairs) p[g - min] += pr; return { min, p }; }
function distAffine(d, a) { // g' = a + g con reparto fraccional entre enteros vecinos
  const vals = d.p.map((pr, i) => [a + d.min + i, pr]);
  const lo = Math.floor(vals[0][0]), hi = Math.ceil(vals[vals.length - 1][0]);
  const p = new Array(hi - lo + 1).fill(0);
  for (const [x, pr] of vals) { const f = Math.floor(x), w = x - f; p[f - lo] += pr * (1 - w); if (w > 0) p[f + 1 - lo] += pr * w; }
  return { min: lo, p };
}
function distMedian(d) { let c = 0; for (let i = 0; i < d.p.length; i++) { c += d.p[i]; if (c >= 0.5) return d.min + i; } return d.min + d.p.length - 1; }
function distPover(d, line) { let s = 0; for (let i = 0; i < d.p.length; i++) if (d.min + i > line + 1e-9) s += d.p[i]; return s; }
function meanSe(xs) { const n = xs.length; const m = xs.reduce((a, b) => a + b, 0) / n; const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1); return { mean: m, se: Math.sqrt(v / n), n, t: v ? m / Math.sqrt(v / n) : 0 }; }

// ── la pasada (copiada de pass.js::runTour, solo la variante de producción) ───────────────────────────────
function runTour(tour) {
  const label = tour === 0 ? 'atp' : 'wta';
  const cst = priors.tours[label].constants;
  const cfg = { kScale: cst.kScale, surfW: cst.surfW, halfLife: cst.halfLife, shrinkK: cst.shrinkK, shock: cst.shock || 0 };
  const elo = new Map(), eloSurf = [new Map(), new Map(), new Map(), new Map()], nMatch = new Map();
  const srv = new Map(), ret = new Map();
  let tourSpw = cst.tourSpwStart, tourN = 50;
  const alpha = Math.log(2) / cfg.halfLife;
  const K = (n) => cfg.kScale * 250 / Math.pow(n + 5, 0.4);
  const g = (m, k, d) => (m.has(k) ? m.get(k) : d);
  const dev = (m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + cfg.shrinkK)) : 0; };
  const upd = (m, id, val) => { const o = m.get(id) || { v: 0, w: 0 }; o.v = o.v * (1 - alpha) + val; o.w = o.w * (1 - alpha) + 1; m.set(id, o); };
  const preds = [];
  const t0 = Date.now();
  for (const rw of rows) {
    if (rw[F.tour] !== tour) continue;
    const date = rw[F.date], surf = rw[F.surface];
    let bo = rw[F.best_of] === 5 ? 5 : 3;
    if (!rw[F.ret] && rw[F.sets_w] === 3) bo = 5; else if (!rw[F.ret] && rw[F.sets_w] === 2) bo = 3;
    else if (date >= TAIL_FROM) bo = (tour === 0 && rw[F.level] === 'G') ? 5 : 3;
    const A = rw[F.wid], B = rw[F.lid];
    const eA = g(elo, A, 1500), eB = g(elo, B, 1500);
    const sT = surf >= 0 ? eloSurf[surf] : null;
    const sA = sT ? g(sT, A, 1500) : 1500, sB = sT ? g(sT, B, 1500) : 1500;
    const pGen = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const pSurf = 1 / (1 + Math.pow(10, -(sA - sB) / 400));
    if (date >= DEV_FROM && !rw[F.ret]) {
      const actGames = rw[F.games_w] + rw[F.games_l];
      if (actGames > 5) {
        const pa = clamp(tourSpw + dev(srv, A) - dev(ret, B), 0.45, 0.8);
        const pb = clamp(tourSpw + dev(srv, B) - dev(ret, A), 0.45, 0.8);
        const lite = C.matchLite(pa, pb, bo, cfg.shock);
        preds.push({ date, bo, surf, pa, pb, expGames: lite.expGames, actGames });
      }
    }
    const nA = g(nMatch, A, 0), nB = g(nMatch, B, 0);
    elo.set(A, eA + K(nA) * (1 - pGen)); elo.set(B, eB - K(nB) * (1 - pGen));
    if (sT) { sT.set(A, sA + K(nA) * (1 - pSurf)); sT.set(B, sB - K(nB) * (1 - pSurf)); }
    nMatch.set(A, nA + 1); nMatch.set(B, nB + 1);
    const wsv = rw[F.w_svpt], lsv = rw[F.l_svpt];
    if (wsv > 30 && lsv > 30) {
      const wSpw = (rw[F.w_1stWon] + rw[F.w_2ndWon]) / wsv;
      const lSpw = (rw[F.l_1stWon] + rw[F.l_2ndWon]) / lsv;
      tourSpw = (tourSpw * tourN + wSpw + lSpw) / (tourN + 2); tourN = Math.min(tourN + 2, 4000);
      upd(srv, A, wSpw - tourSpw + dev(ret, B)); upd(srv, B, lSpw - tourSpw + dev(ret, A));
      upd(ret, A, tourSpw + dev(srv, B) - lSpw); upd(ret, B, tourSpw + dev(srv, A) - wSpw);
    }
  }
  console.log(`[${label}] pasada: ${preds.length} partidos completos desde ${DEV_FROM} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { label, cst, cfg, preds };
}

// ── tabla de residuos por formato × tercil (DESARROLLO) ──────────────────────────────────────────────────
function tabla(T) {
  const out = {};
  const dev = T.preds.filter((p) => p.date < DEV_END);
  for (const bo of [3, 5]) {
    const cal = (T.cst.gamesCal || {})[bo === 5 ? 'bo5' : 'bo3'] || [0, 1];
    const sel = dev.filter((p) => p.bo === bo);
    if (sel.length < 300) { out['bo' + bo] = null; console.log(`[${T.label}] bo${bo}: ${sel.length} partidos en desarrollo — sin tabla`); continue; }
    const xs = sel.map((p) => p.expGames).sort((a, b) => a - b);
    const cuts = [xs[Math.floor(xs.length / 3)], xs[Math.floor(2 * xs.length / 3)]];
    const terc = (e) => (e < cuts[0] ? 0 : e < cuts[1] ? 1 : 2);
    const cnt = [new Map(), new Map(), new Map()], n = [0, 0, 0];
    for (const p of sel) { const t = terc(p.expGames); const R = Math.round(p.actGames - (cal[0] + cal[1] * p.expGames)); cnt[t].set(R, (cnt[t].get(R) || 0) + 1); n[t]++; }
    const hist = cnt.map((m, t) => { const o = {}; for (const k of [...m.keys()].sort((a, b) => a - b)) o[k] = +(m.get(k) / n[t]).toFixed(6); return o; });
    out['bo' + bo] = { cuts: cuts.map((x) => r(x, 3)), hist, n, dev: `${DEV_FROM}→${DEV_END - 1}`, resid_of: 'round(juegos reales − calG), calG = gamesCal[0] + gamesCal[1]·expGames', tercil_of: 'expGames crudo del compilador' };
    const media = (h) => Object.entries(h).reduce((s, [k, v]) => s + k * v, 0);
    console.log(`[${T.label}] bo${bo}: n=${sel.length} cortes expGames ${cuts.map((x) => x.toFixed(2)).join(' / ')} · por tercil n=${n.join('/')} · media R ${hist.map((h) => media(h).toFixed(2)).join(' / ')} · soporte ${hist.map((h) => Object.keys(h).length).join('/')}`);
  }
  return out;
}

// ── comprobación en HOLDOUT (solo se mira): desplazamiento vs C6 ─────────────────────────────────────────
const distCache = new Map();
function c1Dist(p, shock) { // la de producción hasta hoy: matchDist (rejilla 0,004) desplazada a calG
  const ka = Math.round(p.pa / 0.004), kb = Math.round(p.pb / 0.004); const k = `${ka},${kb},${p.bo}`;
  if (!distCache.has(k)) { const md = C.matchDist(ka * 0.004, kb * 0.004, p.bo, shock); distCache.set(k, { d: distFromPairs(md.totalGames.map(([g, pr]) => [g, pr])), expGames: md.expGames }); }
  return distCache.get(k);
}
function comprueba(T, tab) {
  const ho = T.preds.filter((p) => p.date >= DEV_END);
  const filas = [];
  for (const bo of [3, 5]) {
    const tb = tab['bo' + bo]; if (!tb) continue;
    const sel = ho.filter((p) => p.bo === bo); if (sel.length < 50) continue;
    const cal = (T.cst.gamesCal || {})[bo === 5 ? 'bo5' : 'bo3'] || [0, 1];
    const terc = (e) => (e < tb.cuts[0] ? 0 : e < tb.cuts[1] ? 1 : 2);
    let gt1 = 0, gt6 = 0; const dBr = [], dBrFija = [];
    for (const p of sel) {
      const calG = cal[0] + cal[1] * p.expGames;
      const c1 = c1Dist(p, T.cfg.shock); const d1 = distAffine(c1.d, calG - c1.expGames);
      const h = tb.hist[terc(p.expGames)]; const pares = Object.entries(h).map(([k, v]) => [+k, v]).sort((a, b) => a[0] - b[0]);
      const d6 = distAffine(distFromPairs(pares), calG);
      const med = distMedian(d1);
      if (p.actGames > med) gt1++; if (p.actGames > distMedian(d6)) gt6++;
      let b1 = 0, b6 = 0;
      for (const off of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) { const L = med + off; const y = p.actGames > L ? 1 : 0; b1 += (distPover(d1, L) - y) ** 2; b6 += (distPover(d6, L) - y) ** 2; }
      dBr.push((b1 - b6) / 6);
      const L = med + 0.5, y = p.actGames > L ? 1 : 0; dBrFija.push((distPover(d1, L) - y) ** 2 - (distPover(d6, L) - y) ** 2);
    }
    const a = meanSe(dBr), f = meanSe(dBrFija);
    filas.push({ tour: T.label, formato: 'bo' + bo, n: sel.length, 'P(real>med) shift': r(gt1 / sel.length, 3), 'P(real>med) c6': r(gt6 / sel.length, 3), 'ΔBrier abanico (shift−c6)': r(a.mean, 5), 't abanico': r(a.t, 2), 'ΔBrier línea fija': r(f.mean, 5), 't fija': r(f.t, 2) });
  }
  return filas;
}

const OUT = {};
const filas = [];
for (const tour of [0, 1]) {
  const T = runTour(tour);
  const tab = tabla(T);
  OUT[T.label] = tab;
  filas.push(...comprueba(T, tab));
}
console.log('\n[holdout 2025→] comprobación (solo lectura; positivo = C6 mejor que el desplazamiento):');
console.table(filas);

// ── escritura en model-priors.json (merge: solo constants.gamesResid) ────────────────────────────────────
for (const [label, tab] of Object.entries(OUT)) {
  if (!priors.tours[label]) continue;
  priors.tours[label].constants = priors.tours[label].constants || {};
  priors.tours[label].constants.gamesResid = { ...tab, built_at: new Date().toISOString(), used_in_production: label === 'atp' ? ['bo3'] : [], note: 'C6: residuo empírico por formato × tercil de expGames (desarrollo). store.js solo lo usa en ATP bo3; bo5 y WTA se guardan sin usar (no demostrados).' };
}
if (DRY) { console.log('\n[resid] --dry: no se escribe'); }
else { fs.writeFileSync(path.join(BASE, 'model-priors.json'), JSON.stringify(priors, null, 1)); console.log('\n[resid] gamesResid escrito en data/tennis/model-priors.json'); }
