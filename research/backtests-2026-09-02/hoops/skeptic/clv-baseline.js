'use strict';
const B = require('../../../research/hoops_picks_league_wnba.json');
const S = B.settled.filter((p) => p.result_code !== 'VOID');
const r2 = (x) => +x.toFixed(2), r3 = (x) => +x.toFixed(3);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const tt = (a) => r2(mean(a) / (sdv(a) / Math.sqrt(a.length)));
for (const fam of ['SPREAD', 'TOTAL', 'MONEYLINE']) {
  const L = S.filter((p) => p.family === fam && p.clv_pct != null && p.close_odds != null);
  const clv = L.map((p) => p.clv_pct);
  const base = L.map((p) => 100 * (p.best_odds * p.market_prob - 1));          // CLV si la prob justa no se hubiera movido
  const move = L.map((p, i) => clv[i] - base[i]);                                // lo que de verdad se movió el mercado (en % de cuota)
  const dp = L.map((p) => 100 * (1 / p.close_odds - p.market_prob));           // Δ prob justa de nuestro lado (pp); <0 = se movió en contra
  console.log(`${fam}: n=${L.length} CLV medio ${r2(mean(clv))} (t ${tt(clv)}) · BASELINE mecánico (best_odds·market_prob−1) ${r2(mean(base))} · movimiento real ${r2(mean(move))} ± ${r2(sdv(move) / Math.sqrt(move.length))} (t ${tt(move)}) · Δp justa ${r2(mean(dp))} pp ± ${r2(sdv(dp) / Math.sqrt(dp.length))} (t ${tt(dp)}) · Δp<0 en ${dp.filter((x) => x < 0).length}/${dp.length}`);
  // por tesis
  const cl = {}; for (const p of L) (cl[p.game_id + '|' + p.side] = cl[p.game_id + '|' + p.side] || []).push(p);
  const dpT = Object.values(cl).map((l) => mean(l.map((p) => 100 * (1 / p.close_odds - p.market_prob))));
  const mvT = Object.values(cl).map((l) => mean(l.map((p) => p.clv_pct - 100 * (p.best_odds * p.market_prob - 1))));
  console.log(`   por tesis (n=${dpT.length}): Δp justa ${r2(mean(dpT))} pp ± ${r2(sdv(dpT) / Math.sqrt(dpT.length))} (t ${tt(dpT)}) · movimiento real en cuota ${r2(mean(mvT))} % (t ${tt(mvT)}) · negativas ${dpT.filter((x) => x < 0).length}`);
  if (fam === 'SPREAD') {
    const absL = (p) => Math.abs(p.line);
    for (const [lo, hi] of [[0, 8], [8, 12], [12, 30]]) { const l = L.filter((p) => absL(p) >= lo && absL(p) < hi); const d = l.map((p) => 100 * (1 / p.close_odds - p.market_prob)); console.log(`   |línea| ${lo}-${hi}: n=${l.length} Δp justa ${r2(mean(d))} pp (t ${tt(d)}) · CLV bruto ${r2(mean(l.map((p) => p.clv_pct)))}`); }
  }
}
// Fisher exacto: tesis TOTAL bug 2W/9 vs resto 2W/2
const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
console.log('Fisher (tesis TOTAL): P(resto 2/2 ganadas | 4 ganadas de 11) =', r3(C(4, 2) * C(7, 0) / C(11, 2)));
