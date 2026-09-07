#!/usr/bin/env node
// scripts/darts-fit.js — VALIDACIÓN WALK-FORWARD DEL MODELO DE DARDOS (blueprint 8.0, fase 4-5)
//
//   node scripts/darts-fit.js [--holdout=2026-01-01] [--write]
//
// Reproduce el historial en orden cronológico y, para cada partido del circuito principal a partir del
// corte de desarrollo, predice ANTES de verlo con: (1) Elo cronológico, (2) el compilador con las habilidades
// point-in-time de Orakel (la ventana de 365/90 d cerrada ANTES del mes del partido), (3) la mezcla en logit.
// Mide log-loss y Brier contra la moneda (skill), AUC, y la calibración del total de legs (MAE vs ingenuo).
// Constantes (kScale, ensembleU, halfLife) se eligen en DESARROLLO (antes del holdout) y el holdout se lee UNA vez.
// --write congela el resultado en data/darts/model-priors.json.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../darts-engine/rules');
const K = require('../darts-engine/kernel');
const C = require('../darts-engine/compiler');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const BASE = path.join(__dirname, '..', 'data', 'darts');
const zlib = require('zlib');
const leer = (n) => { const p = path.join(BASE, n); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); return JSON.parse(zlib.gunzipSync(fs.readFileSync(p + '.gz')).toString('utf8')); };
const m = leer('matches.json');
const ork = leer('orakel.json');
const F = {}; m.schema.forEach((k, i) => { F[k] = i; });
const rows = m.rows.slice().sort((a, b) => a[F.date] - b[F.date] || a[F.seq] - b[F.seq]);
const HOLD = +String(args.holdout || '2026-01-01').replace(/-/g, '');
const DEV_FROM = 20240301; // antes no hay ventanas de Orakel cerradas
const log = (...x) => console.log('[darts-fit]', ...x);
const logit = (p) => Math.log(p / (1 - p)), sig = (x) => 1 / (1 + Math.exp(-x)), cl = (p) => Math.max(1e-3, Math.min(1 - 1e-3, p));

// ventanas de Orakel cerradas antes de una fecha: la última con `to` < primer día del mes del partido
const ends = [...new Set(Object.keys(ork.windows).map((k) => k.split('|')[0]))].sort();
function windowBefore(dateNum) {
  const first = String(dateNum).slice(0, 6) + '01';
  let best = null;
  for (const e of ends) { if (+e.replace(/-/g, '') < +first) best = e; else break; }
  return best;
}
function skillAt(id, dateNum) {
  const e = windowBefore(dateNum); if (!e) return null;
  const w365 = (ork.windows[`${e}|365`] || {})[id], w90 = (ork.windows[`${e}|90`] || {})[id];
  if (!w365 || !w365['25'] || w365['25'][1] < 300) return null;
  const a365 = w365['25'], a90 = w90 && w90['25'];
  const KD = 3000, d90 = a90 ? a90[1] : 0;
  const avg = a90 && d90 > 200 ? (a365[2] * KD + a90[2] * d90) / (KD + d90) : a365[2];
  const x365 = w365['26'], x90 = w90 && w90['26'];
  const v365 = x365 && x365[2] != null ? x365[2] / (a365[1] / 3) : null;
  const v90 = x90 && x90[2] != null && a90 && a90[1] > 200 ? x90[2] / (a90[1] / 3) : null;
  const per180Visit = v365 != null ? (v90 != null ? (v365 * KD + v90 * d90) / (KD + d90) : v365) : null;
  const c365 = w365['1053'];
  const co = c365 && c365[1] >= 40 ? c365[0] / c365[1] : null;
  return { avg, per180Visit, checkoutPct: co != null ? Math.min(0.6, Math.max(0.15, co)) : 0.38, exposure: a365[1] };
}
const CAL = new Map();
function legOf(sk, dbl) {
  const key = [Math.round(sk.avg * 2) / 2, sk.per180Visit != null ? Math.round(sk.per180Visit * 200) / 200 : 'x', Math.round(sk.checkoutPct * 100) / 100, dbl ? 1 : 0].join('|');
  let c = CAL.get(key); if (!c) { c = K.calibrate({ avg: sk.avg, per180Visit: sk.per180Visit, checkoutPct: sk.checkoutPct }, { doubleIn: dbl }); CAL.set(key, c); }
  return c.leg;
}

function run({ kScale, ensembleU, formatK = 1 }) {
  const elo = new Map(), n = new Map();
  const Kf = (nn) => kScale * 200 / Math.pow(nn + 5, 0.4);
  const out = { dev: [], hold: [] };
  const g = (mp, k, d) => (mp.has(k) ? mp.get(k) : d);
  let t0 = Date.now(), evals = 0;
  for (const r of rows) {
    const date = r[F.date], A = r[F.wid], B = r[F.lid];
    if (!A || !B) continue;
    const eA = g(elo, A, 1500), eB = g(elo, B, 1500);
    const pElo = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const main = r[F.cat] !== 'sec';
    // predicción (solo circuito principal, legs, desde que hay ventanas)
    if (main && date >= DEV_FROM && r[F.unit] === 'legs' && r[F.bo] >= 7) {
      const sA = skillAt(A, date), sB = skillAt(B, date);
      const bucket = date >= HOLD ? out.hold : out.dev;
      // orientación aleatoria pero determinista (para que el ganador no esté siempre en A)
      const flip = (Number(String(r[F.fid]).slice(-1)) % 2) === 1;
      const y = flip ? 0 : 1; // 1 = "a" gana, con a = ganador si no flip
      const pe = flip ? 1 - pElo : pElo;
      const rec = { date, y, pe, legs: (r[F.w_legs] || 0) + (r[F.l_legs] || 0), bo: r[F.bo], pc: null, pm: null, expLegs: null };
      if (sA && sB) {
        const fmt = R.legsFormat(r[F.bo], { twoClear: !!r[F.two_clear] });
        const LA = legOf(flip ? sB : sA, false), LB = legOf(flip ? sA : sB, false);
        const mm = C.compileMatch(LA, LB, fmt);
        rec.pc = mm.p_a; rec.expLegs = mm.legs.exp_total;
        rec.pm = sig((1 - ensembleU) * logit(cl(pe)) + ensembleU * logit(cl(mm.p_a)));
        evals++;
      }
      bucket.push(rec);
    }
    // actualización Elo (todo el circuito, K por formato)
    const legs = (r[F.w_legs] || 0) + (r[F.l_legs] || 0);
    const fk = legs > 0 ? Math.max(0.6, Math.min(1.6, Math.sqrt(legs / 9))) : 1;
    elo.set(A, eA + fk * formatK * Kf(g(n, A, 0)) * (1 - pElo)); elo.set(B, eB - fk * formatK * Kf(g(n, B, 0)) * (1 - pElo));
    n.set(A, g(n, A, 0) + 1); n.set(B, g(n, B, 0) + 1);
  }
  log(`  pasada kScale=${kScale} u=${ensembleU}: ${evals} compilados en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return out;
}
function metrics(recs, key) {
  const xs = recs.filter((r) => r[key] != null);
  if (!xs.length) return null;
  const ll = xs.reduce((s, r) => s - (r.y ? Math.log(cl(r[key])) : Math.log(1 - cl(r[key]))), 0) / xs.length;
  const brier = xs.reduce((s, r) => s + (r[key] - r.y) ** 2, 0) / xs.length;
  // AUC por conteo de pares
  const pos = xs.filter((r) => r.y).map((r) => r[key]).sort((a, b) => a - b), neg = xs.filter((r) => !r.y).map((r) => r[key]).sort((a, b) => a - b);
  let auc = 0; if (pos.length && neg.length) { let j = 0, acc = 0; for (const p of pos) { while (j < neg.length && neg[j] < p) j++; let ties = 0; let k2 = j; while (k2 < neg.length && neg[k2] === p) { ties++; k2++; } acc += j + ties / 2; } auc = acc / (pos.length * neg.length); }
  return { n: xs.length, logloss: +ll.toFixed(4), skill_pct: +(100 * (1 - ll / Math.log(2))).toFixed(2), brier: +brier.toFixed(4), auc: +auc.toFixed(3) };
}
function legsMetrics(recs) {
  const xs = recs.filter((r) => r.expLegs != null);
  if (!xs.length) return null;
  const byBo = {};
  for (const r of xs) { const b = byBo[r.bo] = byBo[r.bo] || { n: 0, mae: 0, maeNaive: 0, sum: 0 }; b.n++; b.mae += Math.abs(r.expLegs - r.legs); b.sum += r.legs; }
  for (const [bo, b] of Object.entries(byBo)) { const mean = b.sum / b.n; b.maeNaive = xs.filter((r) => r.bo === +bo).reduce((s, r) => s + Math.abs(mean - r.legs), 0) / b.n; b.mae = +(b.mae / b.n).toFixed(3); b.maeNaive = +b.maeNaive.toFixed(3); b.mean_legs = +mean.toFixed(2); }
  return byBo;
}

(function main() {
  log(`filas ${rows.length}; ventanas de Orakel ${ends.length} (${ends[0]}→${ends[ends.length - 1]}); holdout desde ${HOLD}`);
  // desarrollo: rejilla pequeña de kScale y ensembleU
  let best = null;
  for (const kScale of [0.7, 1.0, 1.4]) {
    const out = run({ kScale, ensembleU: 0.5 });
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const dev = out.dev.map((r) => ({ ...r, pm: r.pc != null ? sig((1 - u) * logit(cl(r.pe)) + u * logit(cl(r.pc))) : null }));
      const mt = metrics(dev, 'pm');
      log(`  dev kScale=${kScale} u=${u}: ${JSON.stringify(mt)}`);
      if (mt && (!best || mt.logloss < best.mt.logloss)) best = { kScale, u, mt, out };
    }
  }
  log('mejor en desarrollo:', best.kScale, best.u, best.mt);
  const hold = best.out.hold.map((r) => ({ ...r, pm: r.pc != null ? sig((1 - best.u) * logit(cl(r.pe)) + best.u * logit(cl(r.pc))) : null }));
  const H = { elo: metrics(hold, 'pe'), compiled: metrics(hold, 'pc'), ensemble: metrics(hold, 'pm'), elo_on_compiled_subset: metrics(hold.filter((r) => r.pc != null), 'pe'), legs: legsMetrics(hold) };
  log('HOLDOUT (una lectura):', JSON.stringify(H, null, 1));
  if (args.write) {
    const priors = { model_version: 'darts-l1-1', fitted_at: new Date().toISOString(), constants: { kScale: best.kScale, ensembleU: best.u, halfLifeMatches: 12, shrinkK: 8, formatK: 1 },
      development: { from: DEV_FROM, to: HOLD, best: best.mt, protocol: 'Elo cronológico + compilador con habilidades point-in-time (ventana de Orakel cerrada antes del mes del partido); rejilla kScale×u elegida por log-loss en desarrollo' },
      holdout: { from: HOLD, ...H, note: 'skill = mejora del log-loss sobre la moneda; una sola lectura del holdout; solo circuito principal, formatos de legs ≥ BO7' } };
    fs.writeFileSync(path.join(BASE, 'model-priors.json'), JSON.stringify(priors, null, 1));
    log('escrito data/darts/model-priors.json');
  }
})();
