#!/usr/bin/env node
/**
 * MODELO CONSCIENTE DEL MERCADO — backtest (3-sep, continuación de docs/COMBATE_CUOTAS_HISTORICAS.md).
 *
 * Pregunta: ¿algún rasgo del modelo de combate AÑADE información al cierre del mercado? El 2-sep se midió que
 * el modelo market-blind (Elo + rasgos) no mejora al cierre mezclado LINEALMENTE (w* = 1,00). Aquí se prueba
 * la forma honesta: el cierre como ancla y cada rasgo como CORRECCIÓN RESIDUAL sobre su logit,
 *
 *     logit(p) = a · logit(p_cierre) + Σ b_i · x_i          (sin intercepto: antisimétrico, inmune al orden f1/f2)
 *
 * con x_i = los rasgos antisimétricos que produce combat-engine/ratings.js (featDiff: reach, exp, years, age,
 * chin, streak, mileage, misswt, slpm, td15, tddef, ctrl, kdr) y, como rasgo único, la discrepancia del Elo
 * `delo = logit(p_elo) − logit(p_cierre)` (y `dmodel`, lo mismo con el modelo ACTUAL). Ajuste walk-forward POR
 * AÑO: se entrena con TODAS las peleas cruzadas de años anteriores y se evalúa el año siguiente. Se reporta por
 * rasgo el coeficiente y su t (ajuste final, en muestra), y Δlog-loss / ΔBrier PAREADOS frente al cierre solo
 * (fuera de muestra, por año y global, con bootstrap pareado). Además: la "regla de lado" (FIGHT solo si el
 * lado del modelo es favorito amplio del mercado, k ≥ 0,45) con ROI al cierre y cuota < 3, cruzada con la
 * ventaja exigida (2, 4, 6 pp), por año y por fuente de probabilidad (blend 0,5 actual vs consciente del mercado).
 *
 * Los rasgos se RECONSTRUYEN con el mismo walk-forward de scripts/combat-odds-history.js (mismo Elo, mismo SGD,
 * mismas stats finas) y se comprueba que el p_model recomputado coincide con el guardado en odds-history.json.gz.
 * NO toca combat-engine/ratings.js. Sin red, sin server, sin db.
 *
 * Uso: node scripts/combat-market-aware.js [--boot=2000] [--min-train=800] [--write-priors] [--json=/ruta.json]
 *   --write-priors  escribe data/combat/market-aware-priors.json con los coeficientes que pasan el criterio
 *                   (o ceros si ninguno pasa). Sin la bandera, solo imprime.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const CE = require('../combat-engine/ratings');
const MA = require('../combat-engine/market-aware');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const NBOOT = Number(args.boot || 2000);
const MIN_TRAIN = Number(args['min-train'] || 800);
const MIN_ACTIVE = Number(args['min-active'] || 200); // filas de entrenamiento con el rasgo ≠ 0 para que entre al ajuste
const WARM = 0.35;          // idéntico a combat-odds-history.js
const FEAT_LR = 0.01;
const RIDGE = 1e-4;         // regularización mínima: solo evita singularidades (rasgos casi siempre 0)
const MAX_ODDS = 3;         // techo de cuota de la compuerta (COMBAT_MAX_ODDS)
const FAV_K = 0.45;         // favorito amplio del preregistro
const ROOT = path.join(__dirname, '..');
const HIST_GZ = path.join(ROOT, 'data', 'combat', 'odds-history.json.gz');
const PRIORS_FILE = path.join(ROOT, 'data', 'combat', 'market-aware-priors.json');

const sigm = (z) => 1 / (1 + Math.exp(-z));
const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const ll = (p, y) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cm = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const dayKey = (d) => String(d).slice(0, 10);
const shiftDay = (k, dd) => new Date(Date.parse(k) + dd * 864e5).toISOString().slice(0, 10);
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : null; };
const r4 = (x) => (x == null || !isFinite(x)) ? null : +x.toFixed(4);
const r5 = (x) => (x == null || !isFinite(x)) ? null : +x.toFixed(5);
const r2 = (x) => (x == null || !isFinite(x)) ? null : +x.toFixed(2);
// RNG determinista (mulberry32) para que el bootstrap sea reproducible
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- de-vig ----
// Proporcional (el que usa el server: combatFightOdds) y Shin (2 vías): p_i = (√(z² + 4(1−z)·q_i²/S) − z)/(2(1−z))
// con q_i la implícita cruda, S su suma y z la "cuota del apostador informado", resuelta por bisección.
const devigProp = (o1, o2) => { const i1 = 1 / o1, i2 = 1 / o2; return i1 / (i1 + i2); };
function devigShin(o1, o2) {
  const q = [1 / o1, 1 / o2], S = q[0] + q[1];
  if (S <= 1) return devigProp(o1, o2);
  const probs = (z) => q.map(x => (Math.sqrt(z * z + 4 * (1 - z) * x * x / S) - z) / (2 * (1 - z)));
  let lo = 0, hi = Math.min(0.5, S - 1);
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; const s = probs(mid).reduce((a, b) => a + b, 0); if (s > 1) lo = mid; else hi = mid; }
  const p = probs((lo + hi) / 2); const s = p[0] + p[1];
  return p[0] / s;
}

// ---- nuestro histórico + join fino + pesajes (ports del server / combat-odds-history.js) ----
function loadOurs() {
  const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'fights-ufc.json'), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'fighters-ufc.json'), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner)).sort((a, b) => new Date(a.date) - new Date(b.date));
  return { fights, fighters };
}
function fineJoin(fights) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'afstats-mma.json'), 'utf8')); } catch { return { perFight: {}, joined: 0 }; }
  const full = {}, last = {}, dupLast = {};
  for (const f of fights) for (const side of ['f1', 'f2']) {
    const n = norm(f[side].name); if (!n) continue;
    if (!full[n]) full[n] = f[side].id;
    const ln = n.split(' ').pop();
    if (ln && ln.length >= 3) { if (last[ln] && last[ln] !== f[side].id) { dupLast[ln] = 1; delete last[ln]; } else if (!dupLast[ln]) last[ln] = f[side].id; }
  }
  const byName = (nm) => { const n = norm(nm); return full[n] || last[n.split(' ').pop()] || null; };
  const byDay = {};
  for (const f of fights) { const d0 = dayKey(f.date); for (const dd of [-1, 0, 1]) { const k = shiftDay(d0, dd); (byDay[k] = byDay[k] || []).push(f); } }
  const perFight = {}; let joined = 0;
  for (const af of (raw.fights || [])) {
    const rows = raw.stats[af.id]; if (!rows || !rows.length) continue;
    const h = byName((af.f1 || {}).name), a = byName((af.f2 || {}).name);
    if (!h || !a) continue;
    const ours = (byDay[af.date] || []).find(f => (f.f1.id === h && f.f2.id === a) || (f.f1.id === a && f.f2.id === h));
    if (!ours) continue;
    joined++;
    const minutes = ((ours.end_round || 3) - 1) * 5 + cm(ours.end_clock);
    const afToOur = {}; afToOur[(af.f1 || {}).id] = h; afToOur[(af.f2 || {}).id] = a;
    const pf = perFight[ours.comp_id] = {};
    for (const row of rows) {
      const ourId = afToOur[(row.fighter || {}).id]; if (!ourId) continue;
      const st = row.strikes || {}; const tot = st.total || {};
      pf[ourId] = { min: minutes, str: (tot.head || 0) + (tot.body || 0) + (tot.legs || 0), td_att: (st.takedowns || {}).attempt || 0, td: (st.takedowns || {}).landed || 0, ctrl: cm(st.control_time), kd: st.knockdowns || 0 };
    }
  }
  return { perFight, joined };
}
// pesajes reales de Wikipedia (port de combatWeighIndex): comp_id → {f1:{over}, f2:{over}}
function weighIndex(fights) {
  let W; try { W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'weighins-ufc.json'), 'utf8')); } catch { return {}; }
  const nm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byEvent = {};
  for (const f of fights) if (f.event) (byEvent[f.event] = byEvent[f.event] || []).push(f);
  const out = {};
  for (const [ev, rec] of Object.entries(W.events || {})) {
    if (rec.status !== 'miss' || !rec.rows) continue;
    const cands = [];
    for (const f of (byEvent[ev] || [])) for (const side of ['f1', 'f2']) cands.push({ c: f.comp_id, s: side, n: f[side].name });
    for (const row of rec.rows) {
      const q = new Set(nm(row.name).split(' ').filter(Boolean)); if (!q.size) continue;
      let best = null, bs = 0, tie = false;
      for (const c of cands) {
        const t = new Set(nm(c.n).split(' ')); let ov = 0; for (const x of q) if (t.has(x)) ov++;
        if (!ov) continue;
        const sc = ov * 10 + ov / Math.max(1, t.size + q.size - ov);
        if (sc > bs) { best = c; bs = sc; tie = false; } else if (sc === bs && best && best.c + best.s !== c.c + c.s) tie = true;
      }
      if (!best || tie) continue;
      const sl = out[best.c] = out[best.c] || {}; const pv = sl[best.s];
      sl[best.s] = { over: row.over != null ? row.over : (pv ? pv.over : null) };
    }
  }
  return out;
}
const missW = (over) => Math.min(+over || 0, 5) / 2; // la misma codificación de ratings.js

// ---- walk-forward del modelo ACTUAL (idéntico a combat-odds-history.js) + rasgos en el momento de la pelea ----
function walkForward(fights, fighters, perFight, hist, WI) {
  const warm = Math.floor(fights.length * WARM);
  const model = CE.newModel(null, {});
  const W = CE.newW();
  const rows = []; let pmMismatch = 0, pmMax = 0;
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const ctx = { sched: f.rounds_sched || 3 };
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, ctx); // como en el archivo histórico: sin pesaje en el SGD
    let z = W.elo * logit(pElo); for (const k of CE.ALL_FEATS) z += W[k] * fd[k];
    const pModel = sigm(z);
    const h = hist.get(f.comp_id);
    if (h) {
      const wi = WI[f.comp_id];
      const x = Object.assign({}, fd);
      x.misswt = missW(wi && wi.f1 ? wi.f1.over : null) - missW(wi && wi.f2 ? wi.f2.over : null); // pesaje real como rasgo
      const kProp = devigProp(h.oa, h.ob), kShin = devigShin(h.oa, h.ob);
      if (Math.abs(pModel - h.pm) > 0.0015) pmMismatch++;
      pmMax = Math.max(pmMax, Math.abs(pModel - h.pm));
      rows.push({ c: f.comp_id, d: dayKey(f.date), year: dayKey(f.date).slice(0, 4), y, oa: h.oa, ob: h.ob, kProp, kShin, pElo, pModel, inWarm: i < warm, x });
    }
    const g = pModel - y;
    W.elo -= FEAT_LR * g * logit(pElo); for (const k of CE.ALL_FEATS) W[k] -= FEAT_LR * g * fd[k];
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });
  return { rows, warm, warmDate: fights[warm] ? dayKey(fights[warm].date) : null, pmMismatch, pmMax };
}

// ---- regresión logística SIN intercepto, Newton-Raphson con ridge mínimo; devuelve coef, se, t ----
function fitLogit(X, Y, cols) {
  const p = cols.length, n = X.length;
  let beta = new Array(p).fill(0); beta[0] = 1; // arranca en "cierre solo"
  for (let it = 0; it < 50; it++) {
    const g = new Array(p).fill(0), H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = X[i]; let z = 0; for (let j = 0; j < p; j++) z += beta[j] * xi[j];
      const mu = sigm(z), w = mu * (1 - mu), e = mu - Y[i];
      for (let j = 0; j < p; j++) { g[j] += e * xi[j]; for (let k = j; k < p; k++) H[j][k] += w * xi[j] * xi[k]; }
    }
    for (let j = 0; j < p; j++) { g[j] += RIDGE * beta[j]; H[j][j] += RIDGE; for (let k = j + 1; k < p; k++) H[k][j] = H[j][k]; }
    const step = solve(H, g);
    let mx = 0; for (let j = 0; j < p; j++) { beta[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < 1e-8) break;
  }
  // errores estándar: diagonal de H⁻¹ en el óptimo
  const H = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) { const xi = X[i]; let z = 0; for (let j = 0; j < p; j++) z += beta[j] * xi[j]; const mu = sigm(z), w = mu * (1 - mu); for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) H[j][k] += w * xi[j] * xi[k]; }
  for (let j = 0; j < p; j++) H[j][j] += RIDGE;
  const inv = invert(H);
  const se = cols.map((_, j) => inv ? Math.sqrt(Math.max(0, inv[j][j])) : null);
  return { cols, coef: beta, se, t: beta.map((b, j) => se[j] ? b / se[j] : null), n };
}
function solve(A, b) { const n = b.length; const M = A.map((r, i) => r.concat([b[i]])); for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c] || 1e-12; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / d; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((r, i) => r[n] / (r[i] || 1e-12)); }
function invert(A) { const n = A.length; const M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))); for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c]; if (!d) return null; for (let k = 0; k < 2 * n; k++) M[c][k] /= d; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c]; for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k]; } } return M.map(r => r.slice(n)); }

// ---- diseño: columna 'close' = logit(k) y el resto rasgos; devig = 'prop' (server) o 'shin' ----
const FEATS = CE.ALL_FEATS.slice(); // 13 rasgos antisimétricos del modelo ACTUAL
const kOf = (r, devig) => devig === 'shin' ? r.kShin : r.kProp;
function featureValue(r, col, devig) {
  if (col === 'close') return logit(kOf(r, devig));
  if (col === 'delo') return logit(r.pElo) - logit(kOf(r, devig));
  if (col === 'dmodel') return logit(r.pModel) - logit(kOf(r, devig));
  return r.x[col] || 0;
}
const design = (rows, cols, devig) => rows.map(r => cols.map(c => featureValue(r, c, devig)));

// ---- evaluación walk-forward por año de una variante (conjunto de columnas) ----
// Devuelve la predicción p(f1) por fila evaluada (index → p), y los coeficientes de cada pliegue.
// Un rasgo entra en un pliegue SOLO si es no nulo en ≥ MIN_ACTIVE peleas de entrenamiento: las stats finas
// (slpm, td15, …) existen desde 2022 y el pesaje real en ~90 peleas; con 20 filas activas el ajuste les daba
// coeficientes de ±8 y hundía el año siguiente (Δlog-loss +0,35 en 2023). Inerte hasta que haya muestra —
// la misma regla que ratings.js aplica a las finas.
function evalVariant(rows, cols, devig, years) {
  const pred = new Array(rows.length).fill(null); const folds = {};
  for (const Y of years) {
    const trIdx = [], teIdx = [];
    rows.forEach((r, i) => { if (r.year < Y) trIdx.push(i); else if (r.year === Y) teIdx.push(i); });
    if (trIdx.length < MIN_TRAIN || !teIdx.length) continue;
    const active = cols.filter(c => c === 'close' || trIdx.filter(i => featureValue(rows[i], c, devig) !== 0).length >= MIN_ACTIVE);
    const fit = fitLogit(design(trIdx.map(i => rows[i]), active, devig), trIdx.map(i => rows[i].y), active);
    const coef = cols.map(c => { const j = active.indexOf(c); return j >= 0 ? fit.coef[j] : 0; });
    folds[Y] = { n_train: trIdx.length, coef: coef.map(r4), inertes: cols.filter(c => !active.includes(c)) };
    for (const i of teIdx) { const xi = cols.map(c => featureValue(rows[i], c, devig)); let z = 0; for (let j = 0; j < cols.length; j++) z += coef[j] * xi[j]; pred[i] = sigm(z); }
  }
  return { pred, folds };
}
// ajuste final con la misma regla de actividad (todas las cruzadas)
function fitFinal(rows, cols, devig) {
  const active = cols.filter(c => c === 'close' || rows.filter(r => featureValue(r, c, devig) !== 0).length >= MIN_ACTIVE);
  const fit = fitLogit(design(rows, active, devig), rows.map(r => r.y), active);
  const pick = (arr, dflt) => cols.map(c => { const j = active.indexOf(c); return j >= 0 ? arr[j] : dflt; });
  return { cols, coef: pick(fit.coef, 0), se: pick(fit.se, null), t: pick(fit.t, null), n: fit.n, inertes: cols.filter(c => !active.includes(c)) };
}

// ---- métricas pareadas frente al cierre solo ----
function paired(rows, idx, pA, pB, seed) { // A − B por pelea; negativo = A mejor. Bootstrap pareado con semilla.
  const dl = [], db = [];
  for (const i of idx) { dl.push(ll(pA[i], rows[i].y) - ll(pB[i], rows[i].y)); db.push((pA[i] - rows[i].y) ** 2 - (pB[i] - rows[i].y) ** 2); }
  const n = dl.length; if (!n) return null;
  const ml = mean(dl), sl = sd(dl), sel = sl != null ? sl / Math.sqrt(n) : null;
  const mb = mean(db), sb = sd(db), seb = sb != null ? sb / Math.sqrt(n) : null;
  let better = 0; const boots = [];
  if (NBOOT > 0 && n > 1) {
    const R = rng(seed);
    for (let b = 0; b < NBOOT; b++) { let s = 0; for (let j = 0; j < n; j++) s += dl[(R() * n) | 0]; s /= n; boots.push(s); if (s < 0) better++; }
    boots.sort((a, b) => a - b);
  }
  return {
    n, dLogloss: r5(ml), se: r5(sel), t: sel ? r2(ml / sel) : null,
    dBrier: r5(mb), seBrier: r5(seb), tBrier: seb ? r2(mb / seb) : null,
    pBoot: boots.length ? +(better / NBOOT).toFixed(3) : null,
    ci95: boots.length ? [r5(boots[Math.floor(0.025 * NBOOT)]), r5(boots[Math.floor(0.975 * NBOOT) - 1])] : null,
  };
}
const score = (rows, idx, p) => ({ n: idx.length, logloss: r4(mean(idx.map(i => ll(p[i], rows[i].y)))), brier: r4(mean(idx.map(i => (p[i] - rows[i].y) ** 2))), acc: r4(idx.filter(i => (p[i] >= 0.5) === (rows[i].y === 1)).length / idx.length) });

// ---- regla de lado: picks simuladas al cierre ----
function simulatePicks(rows, idx, pSrc, kSrc, edgeMin) {
  const picks = [];
  for (const i of idx) {
    const r = rows[i]; const p1 = pSrc[i]; if (p1 == null) continue;
    const k1 = kSrc(r);
    let best = null;
    for (const side of ['f1', 'f2']) {
      const p = side === 'f1' ? p1 : 1 - p1, k = side === 'f1' ? k1 : 1 - k1, odds = side === 'f1' ? r.oa : r.ob;
      if (!(odds > 1) || odds >= MAX_ODDS) continue;
      const eg = (p - k) * 100;
      if (eg >= edgeMin && (!best || eg > best.eg)) best = { side, p, k, odds, eg, won: (side === 'f1') === (r.y === 1), year: r.year };
    }
    if (best) picks.push(best);
  }
  return picks;
}
function summPicks(list, seed) {
  const u = list.map(p => p.won ? p.odds - 1 : -1); const n = list.length;
  if (!n) return { n: 0 };
  const s = sd(u), m = mean(u);
  let ci = null;
  if (NBOOT > 0 && n > 1) { const R = rng(seed); const b = []; for (let k = 0; k < NBOOT; k++) { let t = 0; for (let j = 0; j < n; j++) t += u[(R() * n) | 0]; b.push(t / n); } b.sort((a, c) => a - c); ci = [r2(100 * b[Math.floor(0.025 * NBOOT)]), r2(100 * b[Math.floor(0.975 * NBOOT) - 1])]; }
  return { n, hit: r2(100 * list.filter(p => p.won).length / n), roi_pct: r2(100 * m), roi_se: s != null ? r2(100 * s / Math.sqrt(n)) : null, roi_ci95: ci, avg_odds: r2(mean(list.map(p => p.odds))), p_prometida: r2(100 * mean(list.map(p => p.p))), k_cierre: r2(100 * mean(list.map(p => p.k))), edge_medio_pp: r2(mean(list.map(p => p.eg))) };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
(function main() {
  const t0 = Date.now();
  const H = JSON.parse(zlib.gunzipSync(fs.readFileSync(HIST_GZ)).toString('utf8'));
  const hist = new Map(H.peleas.map(p => [p.c, p]));
  const { fights, fighters } = loadOurs();
  const { perFight, joined } = fineJoin(fights);
  const WI = weighIndex(fights);
  const { rows, warm, warmDate, pmMismatch, pmMax } = walkForward(fights, fighters, perFight, hist, WI);
  const withWi = rows.filter(r => r.x.misswt !== 0).length;
  console.log(`archivo: ${H.n} peleas cruzadas (${H.n_fuera_de_muestra} fuera de muestra, warm hasta ${H.warm_hasta}) · reconstruidas ${rows.length} · fine join ${joined} · pesaje real en ${withWi} peleas`);
  console.log(`walk-forward: ${fights.length} peleas · warm ${warm} (hasta ${warmDate}) · p_model recomputado vs archivo: ${pmMismatch} discrepancias > 0,0015 (máx ${pmMax.toFixed(5)})`);
  if (pmMismatch > 50) console.log('  AVISO: el histórico cambió desde el 2-sep; los rasgos siguen siendo walk-forward pero el archivo no es byte-idéntico.');

  const years = [...new Set(rows.map(r => r.year))].sort();
  // cobertura de los rasgos que no siempre existen (finas desde 2022, pesaje real): filas ≠ 0 por año
  const cov = {}; for (const r of rows) { const c = cov[r.year] = cov[r.year] || { n: 0, fino: 0, misswt: 0 }; c.n++; if (r.x.slpm !== 0) c.fino++; if (r.x.misswt !== 0) c.misswt++; }
  console.log('rasgos finos (slpm≠0) / pesaje real por año: ' + years.map(y => `${y}:${cov[y].fino}/${cov[y].misswt}/${cov[y].n}`).join(' '));
  const oosIdx = rows.map((r, i) => i).filter(i => !rows[i].inWarm);     // primario: las 4.180 (2015-07 → 2024)
  const oosYears = [...new Set(oosIdx.map(i => rows[i].year))].sort();
  const DEVIG = 'prop'; // el server de-viga proporcional (combatFightOdds): sin skew entrenar/servir
  const pClose = rows.map(r => kOf(r, DEVIG)), pShin = rows.map(r => r.kShin);
  const pBlend = rows.map(r => 0.5 * r.pModel + 0.5 * r.kProp), pModelArr = rows.map(r => r.pModel);

  console.log(`\nCIERRE (de-vig ${DEVIG}) sobre las ${oosIdx.length} fuera de muestra:`, JSON.stringify(score(rows, oosIdx, pClose)));
  console.log('  shin − prop (log-loss pareado):', JSON.stringify(paired(rows, oosIdx, pShin, pClose, 1)));
  console.log('  modelo ACTUAL − cierre:', JSON.stringify(paired(rows, oosIdx, pModelArr, pClose, 2)));
  console.log('  blend 0,5 − cierre:', JSON.stringify(paired(rows, oosIdx, pBlend, pClose, 3)));

  // ---- variantes ----
  const VARIANTS = [{ name: 'cierre_recal', cols: ['close'] }];
  for (const f of FEATS) VARIANTS.push({ name: '+' + f, cols: ['close', f] });
  VARIANTS.push({ name: '+delo', cols: ['close', 'delo'] });
  VARIANTS.push({ name: '+dmodel', cols: ['close', 'dmodel'] });
  const FISICOS = ['reach', 'exp', 'years', 'age', 'chin', 'streak', 'mileage']; // los 7 que existen desde 2010
  VARIANTS.push({ name: 'fisicos7', cols: ['close'].concat(FISICOS) });
  VARIANTS.push({ name: 'rasgos13', cols: ['close'].concat(FEATS) });
  VARIANTS.push({ name: 'full(delo+13)', cols: ['close', 'delo'].concat(FEATS) });

  const res = { generado: new Date().toISOString(), devig: DEVIG, n_cruzadas: rows.length, n_oos: oosIdx.length, años_oos: oosYears, min_train: MIN_TRAIN, min_active: MIN_ACTIVE, boot: NBOOT, pm_discrepancias: pmMismatch, cierre_oos: score(rows, oosIdx, pClose), variantes: {}, coef_final: {}, por_año: {}, regla_lado: {} };
  const preds = {};
  let seed = 100;
  // El cierre RECALIBRADO (solo `a`) es el listón justo para un rasgo: lo que un rasgo "mejora" frente al cierre
  // crudo puede ser solo la recalibración del favorito que `a` ya hace. Se reportan las dos comparaciones.
  console.log(`\nVARIANTES walk-forward por año (entrena < año, evalúa el año; ≥ ${MIN_TRAIN} de entrenamiento, rasgo activo con ≥ ${MIN_ACTIVE} filas ≠ 0) — fuera de muestra, Δ frente al cierre solo y frente al cierre recalibrado:`);
  console.log('  variante           n    logloss  | vs cierre: Δlogloss   t     P(mejor)  | vs recal: Δlogloss   t     P(mejor)  | coef final (t)');
  for (const v of VARIANTS) {
    const ev = evalVariant(rows, v.cols, DEVIG, years);
    preds[v.name] = ev.pred;
    const idx = oosIdx.filter(i => ev.pred[i] != null);
    const pr = paired(rows, idx, ev.pred, pClose, seed++);
    const prR = v.name === 'cierre_recal' ? null : paired(rows, idx, ev.pred, preds.cierre_recal, seed++);
    const fitAll = fitFinal(rows, v.cols, DEVIG); // ajuste final en muestra (2010-2024) → coeficientes y t
    const coefTxt = v.cols.length <= 3 ? v.cols.map((c, j) => `${c}=${(fitAll.coef[j] || 0).toFixed(3)} (${fitAll.t[j] == null ? 'inerte' : fitAll.t[j].toFixed(1)})`).join(' ') : `${v.cols.length} cols`;
    res.variantes[v.name] = { cols: v.cols, oos: score(rows, idx, ev.pred), pareado: pr, pareado_recal: prR, folds: ev.folds };
    res.coef_final[v.name] = { cols: v.cols, coef: fitAll.coef.map(r4), se: fitAll.se.map(r4), t: fitAll.t.map(r2), n: fitAll.n, inertes: fitAll.inertes };
    const f = (p) => p ? `${String(p.dLogloss).padStart(8)}  ${String(p.t).padStart(5)}  ${String(p.pBoot).padStart(6)}` : `${''.padStart(8)}  ${''.padStart(5)}  ${''.padStart(6)}`;
    console.log(`  ${v.name.padEnd(16)} ${String(pr.n).padStart(5)}  ${res.variantes[v.name].oos.logloss}  | ${f(pr)}  | ${f(prR)}  | ${coefTxt}`);
  }
  for (const name of ['fisicos7', 'full(delo+13)']) {
    const c = res.coef_final[name];
    console.log(`\nCOEFICIENTES del ajuste final (todas las cruzadas 2010-2024), variante ${name}: coef (t)${c.inertes.length ? ' · inertes: ' + c.inertes.join(',') : ''}`);
    console.log('  ' + c.cols.map((k, j) => `${k}=${c.coef[j]} (${c.t[j]})`).join(' · '));
    console.log('  estabilidad por pliegue (coef de cada año):');
    for (const [Y, f] of Object.entries(res.variantes[name].folds)) if (oosYears.includes(Y)) console.log(`    ${Y} (n_train ${f.n_train}): ` + c.cols.map((k, j) => `${k}=${f.coef[j]}`).join(' ') + (f.inertes.length ? ` · inertes: ${f.inertes.join(',')}` : ''));
  }

  // ---- por año: cierre, y Δlogloss de las variantes clave ----
  const KEY = ['cierre_recal', '+delo', '+age', '+reach', '+mileage', '+slpm', 'fisicos7', 'full(delo+13)'];
  console.log('\nPOR AÑO (fuera de muestra): n · logloss cierre · Δlogloss (t) frente al cierre solo de ' + KEY.join(', '));
  for (const Y of oosYears) {
    const idx = oosIdx.filter(i => rows[i].year === Y);
    const row = { n: idx.length, cierre: score(rows, idx, pClose) };
    let line = `  ${Y}  ${String(idx.length).padStart(4)}  ${row.cierre.logloss}  `;
    for (const k of KEY) { const ii = idx.filter(i => preds[k][i] != null); const pr = ii.length ? paired(rows, ii, preds[k], pClose, 0) : null; row[k] = pr; line += ` ${k}: ${pr ? `${pr.dLogloss} (${pr.t})` : '—'}`; }
    res.por_año[Y] = row; console.log(line);
  }

  // ---- regla de lado × ventaja exigida × fuente de probabilidad ----
  const SOURCES = { blend05_actual: pBlend, modelo_puro: pModelArr, mkt_recal: preds.cierre_recal, mkt_age: preds['+age'], mkt_delo: preds['+delo'], mkt_fisicos7: preds.fisicos7, mkt_full: preds['full(delo+13)'] };
  const kSrc = (r) => r.kProp;
  console.log('\nREGLA DE LADO al cierre (cuota < 3): fuente × ventaja exigida × lado. ROI al cierre = sin CLV posible (una sola cuota por pelea).');
  const sideRule = (name, src) => {
    res.regla_lado[name] = {};
    for (const e of [2, 4, 6]) {
      const idx = oosIdx.filter(i => src[i] != null);
      const picks = simulatePicks(rows, idx, src, kSrc, e);
      const cut = { todas: summPicks(picks, seed++), fav45: summPicks(picks.filter(p => p.k >= FAV_K), seed++), perro: summPicks(picks.filter(p => p.k < FAV_K), seed++) };
      // por año (solo favorito amplio, lo preregistrado)
      cut.fav45_por_año = Object.fromEntries(oosYears.map(Y => [Y, summPicks(picks.filter(p => p.k >= FAV_K && p.year === Y), 0)]).filter(([, s]) => s.n));
      cut.perro_por_año = Object.fromEntries(oosYears.map(Y => [Y, summPicks(picks.filter(p => p.k < FAV_K && p.year === Y), 0)]).filter(([, s]) => s.n));
      res.regla_lado[name][`edge${e}`] = cut;
      const f = (s) => s.n ? `n ${String(s.n).padStart(4)} hit ${s.hit} ROI ${s.roi_pct} ± ${s.roi_se} ${s.roi_ci95 ? `[${s.roi_ci95[0]}, ${s.roi_ci95[1]}]` : ''} cuota ${s.avg_odds}` : 'n 0';
      console.log(`  ${name.padEnd(14)} ≥${e} pp  todas: ${f(cut.todas)}\n${''.padEnd(24)}fav45: ${f(cut.fav45)}\n${''.padEnd(24)}perro: ${f(cut.perro)}`);
    }
  };
  for (const [name, src] of Object.entries(SOURCES)) sideRule(name, src);
  const yearLine = (srcs) => { for (const Y of oosYears) console.log(`  ${Y}  ` + srcs.map(s => { const a = (res.regla_lado[s] || {}).edge2; const v = a ? (a.fav45_por_año[Y] || { n: 0 }) : { n: 0 }; return `${s}: n ${String(v.n).padStart(3)} ROI ${v.roi_pct == null ? '   —' : String(v.roi_pct).padStart(6)}`; }).join('   ·   ')); };
  console.log('\nfav45 ≥2 pp por año (ROI al cierre):');
  yearLine(['blend05_actual', 'mkt_age', 'mkt_fisicos7', 'mkt_full']);

  // ---- criterio y priors ----
  // Un rasgo PASA si, fuera de muestra, su variante "cierre + rasgo" mejora el log-loss del cierre RECALIBRADO
  // con t ≤ −2 (pareado; el listón justo: contra el cierre crudo casi todo "mejora" por la recalibración que ya
  // hace `a`) Y su coeficiente en el ajuste final tiene |t| ≥ 2. Si pasa alguno, se ajustan juntos y se vuelve
  // a exigir lo mismo a la conjunta; si no, coeficientes 0 (el archivo lo dice). La recalibración sola NO se
  // publica como "rasgo": close queda en 1 salvo que un rasgo pase (entonces viaja el `a` ajustado con él).
  const singles = FEATS.concat(['delo']);
  const pasan = singles.filter(f => { const v = res.variantes['+' + f], c = res.coef_final['+' + f]; return v.pareado_recal && v.pareado_recal.t != null && v.pareado_recal.t <= -2 && Math.abs(c.t[1] || 0) >= 2; });
  const casi = singles.filter(f => !pasan.includes(f) && res.variantes['+' + f].pareado_recal.t != null && res.variantes['+' + f].pareado_recal.t <= -1.5);
  let chosen = { name: 'cierre_solo', cols: ['close'], coef: [1], oos: null };
  if (pasan.length) {
    const cols = ['close'].concat(pasan);
    const ev = evalVariant(rows, cols, DEVIG, years);
    const idx = oosIdx.filter(i => ev.pred[i] != null);
    const pr = paired(rows, idx, ev.pred, pClose, seed++), prR = paired(rows, idx, ev.pred, preds.cierre_recal, seed++);
    const fitAll = fitFinal(rows, cols, DEVIG);
    preds.seleccion = ev.pred;
    res.variantes['seleccion'] = { cols, oos: score(rows, idx, ev.pred), pareado: pr, pareado_recal: prR, folds: ev.folds };
    res.coef_final['seleccion'] = { cols, coef: fitAll.coef.map(r4), se: fitAll.se.map(r4), t: fitAll.t.map(r2), n: fitAll.n, inertes: fitAll.inertes };
    console.log(`\nSELECCIÓN (rasgos que pasan solos frente al cierre recalibrado: ${pasan.join(', ')}): conjunta fuera de muestra vs cierre`, JSON.stringify(pr), '\n  vs recal', JSON.stringify(prR), '\n  coef', JSON.stringify(res.coef_final['seleccion']));
    if (prR.t != null && prR.t <= -2) chosen = { name: 'seleccion', cols, coef: fitAll.coef, oos: pr, oosR: prR };
    else console.log('  la conjunta NO pasa t ≤ −2 frente al cierre recalibrado → coeficientes 0');
  } else console.log(`\nNINGÚN rasgo pasa el criterio (t ≤ −2 frente al cierre recalibrado fuera de muestra y |t| ≥ 2 en el coeficiente) → coeficientes 0${casi.length ? ' · rozan (t ≤ −1,5): ' + casi.join(', ') : ''}`);

  if (preds.seleccion) { console.log('\nREGLA DE LADO con la selección:'); sideRule('mkt_seleccion', preds.seleccion); console.log('  fav45 ≥2 pp por año:'); yearLine(['blend05_actual', 'mkt_seleccion']); }

  const feats = Object.fromEntries(MA.FEATURE_KEYS.map(k => [k, 0]));
  let a = 1;
  chosen.cols.forEach((c, j) => { if (c === 'close') a = +chosen.coef[j].toFixed(4); else if (c in feats) feats[c] = +chosen.coef[j].toFixed(4); });
  const recal = res.variantes.cierre_recal;
  const priors = {
    generado: res.generado, fuente: 'scripts/combat-market-aware.js sobre data/combat/odds-history.json.gz (UFC 2010-2024, cierre del Ultimate UFC Dataset)',
    muestra: { cruzadas: rows.length, fuera_de_muestra: oosIdx.length, años_evaluados: oosYears, entrenamiento_final: chosen.name === 'cierre_solo' ? 0 : rows.length },
    devig: DEVIG, forma: 'logit(p) = close·logit(p_cierre) + Σ feats[i]·x_i · x_i = featDiff de combat-engine/ratings.js (misma escala); delo = logit(p_elo) − logit(p_cierre)',
    criterio: 'rasgo → Δlog-loss pareado vs cierre RECALIBRADO t ≤ −2 fuera de muestra Y |t| ≥ 2 del coeficiente; conjunta → t ≤ −2 vs recalibrado',
    variante: chosen.name, rasgos_que_pasan: pasan, rasgos_que_rozan: casi,
    recalibracion_del_cierre: { close: res.coef_final.cierre_recal.coef[0], t_coef: res.coef_final.cierre_recal.t[0], dLogloss_oos: recal.pareado.dLogloss, t_oos: recal.pareado.t, nota: 'NO se publica sola: es sesgo favorito-longshot del de-vig proporcional, no un rasgo del modelo' },
    veredicto: chosen.name === 'cierre_solo'
      ? 'NINGÚN rasgo añade información al cierre recalibrado fuera de muestra: coeficientes 0, la función devuelve el cierre tal cual.'
      : `Pasan ${pasan.join(', ')}: la conjunta mejora el log-loss del cierre en ${chosen.oos.dLogloss} (t ${chosen.oos.t}) y del cierre recalibrado en ${chosen.oosR.dLogloss} (t ${chosen.oosR.t}).`,
    coefs: { close: a, feats },
    resumen_oos: Object.fromEntries(Object.entries(res.variantes).map(([k, v]) => [k, { n: v.pareado.n, dLogloss_vs_cierre: v.pareado.dLogloss, t: v.pareado.t, dLogloss_vs_recal: v.pareado_recal ? v.pareado_recal.dLogloss : null, t_recal: v.pareado_recal ? v.pareado_recal.t : null }])),
  };
  res.priors = priors;
  console.log('\nPRIORS →', JSON.stringify({ variante: priors.variante, coefs: priors.coefs }));
  if (args['write-priors']) { fs.writeFileSync(PRIORS_FILE, JSON.stringify(priors, null, 1) + '\n'); console.log('escrito', path.relative(ROOT, PRIORS_FILE)); }
  else console.log('(sin --write-priors: no se escribe data/combat/market-aware-priors.json)');
  const outJson = args.json || path.join(os.tmpdir(), 'gp-combat-market-aware-result.json');
  fs.writeFileSync(outJson, JSON.stringify(res, null, 1));
  console.log(`resumen JSON: ${outJson} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
