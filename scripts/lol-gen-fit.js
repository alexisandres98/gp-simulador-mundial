// scripts/lol-gen-fit.js — VALIDACIÓN WALK-FORWARD DEL GENERADOR DE KILLS DE LoL (9-sep)
//
// Mes a mes desde 2024-01: se ajusta con las partidas ANTERIORES al mes (ventana 365 d) y se predice cada
// partida del mes con pMap = 0,5 (sin información previa de fuerza: lo que se mide es la DISTRIBUCIÓN por
// liga y parche, que es lo que el mercado de totales cotiza). Se compara contra dos ingenuos:
//   · liga plana: Poisson con la media de kills de la liga en los últimos 240 d (lo que "hace todo el mundo")
//   · circuito: Poisson con la media global.
// Métricas: error absoluto del total esperado; log-loss y Brier de P(más de L) en la línea mediana de cada
// modelo (la que cotizaría una casa); calibración por deciles; y lo mismo en L = mediana ± 3.
// Uso: node scripts/lol-gen-fit.js [--from=2024-01] [--to=2026-09] [--sims=4000] [--write]
'use strict';
const fs = require('fs'), path = require('path');
const G = require('../esports-engine/lol-gen');
const LD = require('../esports-engine/lol-data');

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };
const FROM = arg('from', '2024-01'), TO = arg('to', '2026-09'), SIMS = +arg('sims', 4000), WRITE = process.argv.includes('--write');
const K = +arg('k', G.CONST.shrink_k), WIN = +arg('window', G.CONST.window_days), LWIN = +arg('lwindow', G.CONST.league_days);

const data = LD.load();
const games = data.games.filter((g) => g.k1 != null && g.k2 != null && g.len > 0);
console.log('partidas con kills y duración:', games.length);

const months = [];
for (let y = +FROM.slice(0, 4), m = +FROM.slice(5, 7); y * 100 + m <= +TO.slice(0, 4) * 100 + +TO.slice(5, 7); m++) { if (m > 12) { m = 1; y++; } months.push(`${y}-${String(m).padStart(2, '0')}`); }

const r2 = (x) => +x.toFixed(2), r4 = (x) => +x.toFixed(4);
const ll = (p, y) => -(y ? Math.log(Math.max(1e-6, p)) : Math.log(Math.max(1e-6, 1 - p)));
// Poisson CDF para los ingenuos
function pOverPoisson(lam, L) { let cdf = 0, p = Math.exp(-lam); for (let k = 0; k <= Math.floor(L); k++) { cdf += p; p *= lam / (k + 1); } return 1 - cdf; }
function pOverHist(h, L) { let s = 0; for (const [k, p] of Object.entries(h.h)) if (+k > L) s += p; return s; }
function median(h) { let c = 0; const ks = Object.keys(h.h).map(Number).sort((a, b) => a - b); for (const k of ks) { c += h.h[k]; if (c >= 0.5) return k; } return ks[ks.length - 1]; }

// tercer ingenuo: el HISTOGRAMA empírico de totales de la liga (240 d) — el competidor honesto de un over/under
const ligaHist = new Map();
const OFFS = [-9, -6, -3, 0, 3, 6, 9];
const ML = { gen: [], liga: [], hist: [] };   // log-loss multi-línea
const acc = { liga_hist: { ae: [], ll_med: [], ll_p3: [], ll_m3: [] }, gen: { ae: [], ll_med: [], br_med: [], ll_p3: [], ll_m3: [], cal: Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 })), var_pred: [], var_obs: [] },
  liga: { ae: [], ll_med: [], br_med: [], ll_p3: [], ll_m3: [] }, circuito: { ae: [], ll_med: [], br_med: [] } };
let nPred = 0, nCells = 0, nLeague = 0, nGlobal = 0;
const simCache = new Map();

for (const mo of months) {
  const asOf = Date.parse(mo + '-01T00:00:00Z');
  const F = G.fit(games, { asOf, windowDays: WIN, leagueDays: LWIN });
  if (!F.global) continue;
  const inMonth = games.filter((g) => { const t = G.parseAt(g.at); return t >= asOf && t < asOf + 31 * 864e5 && String(g.at).slice(0, 7) === mo; });
  simCache.clear();
  ligaHist.clear();
  for (const g of games) { const t = G.parseAt(g.at); if (t < asOf && t >= asOf - 240 * 864e5) { const lk = G.leagueKey(g.page); const a = ligaHist.get(lk) || []; a.push(g.k1 + g.k2); ligaHist.set(lk, a); } }
  for (const g of inMonth) {
    const lk = G.leagueKey(g.page), mp = G.majorPatch(g.patch);
    const P = G.paramsFor(F, lk, mp, { k: K }); if (!P) continue;
    if (P.source === 'liga×parche') nCells++; else if (P.source === 'liga') nLeague++; else nGlobal++;
    const key = lk + '|' + mp + '|' + P.source;
    let sim = simCache.get(key); if (!sim) { sim = G.simulateCalibrated(P, 0.5, { sims: SIMS, seed: 5 }); simCache.set(key, sim); }
    const tot = g.k1 + g.k2;
    // generador
    const Lg = median(sim.dist.total) + 0.5;
    const pg = pOverHist(sim.dist.total, Lg), yg = tot > Lg ? 1 : 0;
    acc.gen.ae.push(Math.abs(sim.mean_kills - tot)); acc.gen.ll_med.push(ll(pg, yg)); acc.gen.br_med.push((pg - yg) ** 2);
    const pgp = pOverHist(sim.dist.total, Lg + 3), pgm = pOverHist(sim.dist.total, Lg - 3);
    acc.gen.ll_p3.push(ll(pgp, tot > Lg + 3 ? 1 : 0)); acc.gen.ll_m3.push(ll(pgm, tot > Lg - 3 ? 1 : 0));
    for (const [p, y] of [[pgp, tot > Lg + 3 ? 1 : 0], [pgm, tot > Lg - 3 ? 1 : 0]]) { const b = Math.min(9, Math.floor(p * 10)); acc.gen.cal[b].n++; acc.gen.cal[b].p += p; acc.gen.cal[b].y += y; }
    acc.gen.var_pred.push(sim.sd_kills ** 2); acc.gen.var_obs.push((tot - sim.mean_kills) ** 2);
    for (const o of OFFS) { const L = Lg + o; ML.gen.push(ll(Math.min(0.995, Math.max(0.005, pOverHist(sim.dist.total, L))), tot > L ? 1 : 0)); }
    // liga plana (Poisson con media de liga 240 d) y circuito
    const Lm = F.leagues[lk] ? F.leagues[lk].mean_kills : F.global.mean_kills;
    const Ll = Math.floor(Lm) + 0.5, pl = pOverPoisson(Lm, Ll), yl = tot > Ll ? 1 : 0;
    acc.liga.ae.push(Math.abs(Lm - tot)); acc.liga.ll_med.push(ll(pl, yl)); acc.liga.br_med.push((pl - yl) ** 2);
    acc.liga.ll_p3.push(ll(pOverPoisson(Lm, Ll + 3), tot > Ll + 3 ? 1 : 0)); acc.liga.ll_m3.push(ll(pOverPoisson(Lm, Ll - 3), tot > Ll - 3 ? 1 : 0));
    for (const o of OFFS) { const L = Ll + o; ML.liga.push(ll(Math.min(0.995, Math.max(0.005, pOverPoisson(Lm, L))), tot > L ? 1 : 0)); }
    const H = ligaHist.get(lk); if (H && H.length >= 30) {
      const sortedH = H.slice().sort((a, b) => a - b); const medH = sortedH[Math.floor(H.length / 2)] + 0.5; const meanH = H.reduce((s, v) => s + v, 0) / H.length;
      const pH = (L) => Math.min(0.99, Math.max(0.01, H.filter((v) => v > L).length / H.length));
      acc.liga_hist.ae.push(Math.abs(meanH - tot)); acc.liga_hist.ll_med.push(ll(pH(medH), tot > medH ? 1 : 0));
      acc.liga_hist.ll_p3.push(ll(pH(medH + 3), tot > medH + 3 ? 1 : 0)); acc.liga_hist.ll_m3.push(ll(pH(medH - 3), tot > medH - 3 ? 1 : 0));
      for (const o of OFFS) { const L = medH + o; ML.hist.push(ll(pH(L), tot > L ? 1 : 0)); }
      // y el generador SOLO en las partidas donde el histograma existe, para comparar sobre la misma muestra
      for (const o of OFFS) { const L = Lg + o; ML.gen_same = ML.gen_same || []; ML.gen_same.push(ll(Math.min(0.995, Math.max(0.005, pOverHist(sim.dist.total, L))), tot > L ? 1 : 0)); }
    }
    const Gm = F.global.mean_kills, Lc = Math.floor(Gm) + 0.5, pc = pOverPoisson(Gm, Lc), yc = tot > Lc ? 1 : 0;
    acc.circuito.ae.push(Math.abs(Gm - tot)); acc.circuito.ll_med.push(ll(pc, yc)); acc.circuito.br_med.push((pc - yc) ** 2);
    nPred++;
  }
  process.stdout.write(`${mo}: ${inMonth.length} partidas · celdas ${Object.keys(F.cells).length} · parche ${F.current_patch}\n`);
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const out = {
  version: G.CONST.version, at: new Date().toISOString(), from: FROM, to: TO, n_pred: nPred, variante: { k: K, window: WIN, lwindow: LWIN }, source: { celda: nCells, liga: nLeague, circuito: nGlobal }, const: G.CONST,
  generador: { mae_kills: r2(mean(acc.gen.ae)), logloss_mediana: r4(mean(acc.gen.ll_med)), brier_mediana: r4(mean(acc.gen.br_med)), logloss_mas3: r4(mean(acc.gen.ll_p3)), logloss_menos3: r4(mean(acc.gen.ll_m3)),
    var_ratio: r2(mean(acc.gen.var_obs) / mean(acc.gen.var_pred)), calibracion: acc.gen.cal.map((c, i) => ({ decil: i, n: c.n, p: c.n ? r4(c.p / c.n) : null, obs: c.n ? r4(c.y / c.n) : null })) },
  liga_plana: { mae_kills: r2(mean(acc.liga.ae)), logloss_mediana: r4(mean(acc.liga.ll_med)), brier_mediana: r4(mean(acc.liga.br_med)), logloss_mas3: r4(mean(acc.liga.ll_p3)), logloss_menos3: r4(mean(acc.liga.ll_m3)) },
  liga_hist: { n: acc.liga_hist.ae.length, mae_kills: r2(mean(acc.liga_hist.ae)), logloss_mediana: r4(mean(acc.liga_hist.ll_med)), logloss_mas3: r4(mean(acc.liga_hist.ll_p3)), logloss_menos3: r4(mean(acc.liga_hist.ll_m3)) },
  circuito: { mae_kills: r2(mean(acc.circuito.ae)), logloss_mediana: r4(mean(acc.circuito.ll_med)), brier_mediana: r4(mean(acc.circuito.br_med)) },
};
out.multilinea = { lineas: OFFS, gen: r4(mean(ML.gen)), liga_plana: r4(mean(ML.liga)), liga_hist: r4(mean(ML.hist)), gen_misma_muestra: r4(mean(ML.gen_same || [])), n_hist: (ML.hist.length / OFFS.length) | 0 };
out.skill_multilinea_vs_hist_pct = out.multilinea.liga_hist ? r4(100 * (1 - out.multilinea.gen_misma_muestra / out.multilinea.liga_hist)) : null;
out.skill_multilinea_vs_plana_pct = r4(100 * (1 - out.multilinea.gen / out.multilinea.liga_plana));
out.skill_vs_liga_pct = r2(100 * (1 - out.generador.logloss_mas3 / out.liga_plana.logloss_mas3));
out.skill_vs_liga_hist_pct = out.liga_hist.logloss_mas3 ? r2(100 * (1 - (out.generador.logloss_mas3 + out.generador.logloss_menos3) / (out.liga_hist.logloss_mas3 + out.liga_hist.logloss_menos3))) : null;
out.lectura = `walk-forward mensual ${FROM}→${TO}, ${nPred} partidas; pMap = 0,5 (sin fuerza). El generador se compara con la liga plana en log-loss de "más de L" con L = mediana ± 3.`;
console.log(JSON.stringify(out, null, 1));
if (WRITE) { const f = path.join(__dirname, '..', 'data', 'esports', 'lol', 'gen-priors.json'); fs.writeFileSync(f, JSON.stringify(out, null, 1)); console.log('escrito', f); }
