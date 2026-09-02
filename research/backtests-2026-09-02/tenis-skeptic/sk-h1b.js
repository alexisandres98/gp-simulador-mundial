'use strict';
// incremento de fatiga (days_log+n7) SOBRE edad, ambos sin intercepto (especificación simétrica), ATP y WTA
const fs = require('fs'); const U = require('./util.js');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis';
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(`${SRC}/preds-${label}.json`, 'utf8')); const u = P.cfg.u;
  const rows = P.preds.filter((p) => !p.ret); const ens = (p) => U.sig((1 - u) * U.lg(p.mix) + u * U.lg(p.comp.V0_prod));
  const AGE = (f) => (f.age != null ? f.age : 26); const dl = (f) => Math.log1p(f.hasPrev ? Math.min(Math.max(0, f.days), 60) : 30);
  const FE = { days_log: (p) => dl(p.fX) - dl(p.fY), n7: (p) => p.fX.n7 - p.fY.n7, edad: (p) => (AGE(p.fX) - AGE(p.fY)) / 5, edad2: (p) => ((AGE(p.fX) - 27) ** 2 - (AGE(p.fY) - 27) ** 2) / 50 };
  const dev = rows.filter((p) => p.date < 20250101), ho = rows.filter((p) => p.date >= 20250101);
  const ll = (q, y) => (y ? -Math.log(U.clamp(q, 1e-6, 1 - 1e-6)) : -Math.log(1 - U.clamp(q, 1e-6, 1 - 1e-6)));
  const mk = (names) => { const X = (p) => names.map((k) => FE[k](p)); const f = U.logisticFit(dev.map(X), dev.map((p) => p.y), dev.map((p) => U.lg(ens(p))), { intercept: false, ridge: 1e-3 }); return (p) => f.predict(X(p), U.lg(ens(p))); };
  const pAge = mk(['edad', 'edad2']), pAgeL = mk(['edad']), pAll = mk(['days_log', 'n7', 'edad', 'edad2']), pAllL = mk(['days_log', 'n7', 'edad']), pFat = mk(['days_log', 'n7']);
  const cmp = (a, b, tag) => { const bb = U.pairedBootstrap(ho.map((p) => ll(a(p), p.y) - ll(b(p), p.y)), 2000); out[label] = out[label] || {}; out[label][tag] = { n: ho.length, dLL: U.r(bb.mean, 5), se: U.r(bb.se, 5), t: U.r(bb.t, 2), lo95: U.r(bb.lo95, 5), hi95: U.r(bb.hi95, 5), skill_a: U.r(U.metrics(ho.map((p) => ({ p: a(p), y: p.y }))).skill_pct, 2), skill_b: U.r(U.metrics(ho.map((p) => ({ p: b(p), y: p.y }))).skill_pct, 2) }; };
  cmp(pAge, pAll, 'fatiga_dado_edad_cuad'); cmp(pAgeL, pAllL, 'fatiga_dado_edad_lineal'); cmp(pFat, pAll, 'edad_dado_fatiga'); cmp(pAgeL, pAge, 'cuadratico_dado_lineal');
  // por periodo, fatiga dado edad
  for (const [yt, sel] of [['2025', (p) => p.date < 20260101], ['2026_espina', (p) => p.date >= 20260101 && p.date < 20260526], ['2026_cola', (p) => p.date >= 20260526]]) { const s = ho.filter(sel); const bb = U.pairedBootstrap(s.map((p) => ll(pAge(p), p.y) - ll(pAll(p), p.y)), 1000); out[label]['fatiga_dado_edad_' + yt] = { n: s.length, dLL: U.r(bb.mean, 5), t: U.r(bb.t, 2) }; }
  console.log(label, JSON.stringify(out[label]));
}
fs.writeFileSync(__dirname + '/sk-h1b-out.json', JSON.stringify(out, null, 1));
