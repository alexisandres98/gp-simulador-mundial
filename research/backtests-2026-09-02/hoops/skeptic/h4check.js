#!/usr/bin/env node
// h4check.js — robustez de la señal "descanso diferencial → total" (H4) en WNBA/NBA.
// Reconstruye los rasgos igual que h4.js (solo pasado) y comprueba: multiplicidad, colinealidad, sensibilidad al
// corte temporal y al umbral, y el resultado por bins de rest_diff en TODA la muestra.
'use strict';
const path = require('path');
const fs = require('fs');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const LG = String(args.league || 'wnba');
const REPO = '/home/user/gp-simulador-mundial';
const rowsF = require(path.join(__dirname, `rows_${LG}_cur.json`));
const GJ = JSON.parse(fs.readFileSync(path.join(REPO, 'data/basketball', `games-${LG}-2026.json`), 'utf8'));
const games = Object.values(GJ.games).filter((g) => g.home.pts != null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null), r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const cov = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1); };
const corr = (a, b) => cov(a, b) / (sdv(a) * sdv(b));
const T = {}; for (const b of rowsF.rows) if (b.family === 'total' && b.side === 'over') T[b.gid] = b;
const teamHist = {}; const feats = [];
for (const g of games) {
  const t = Date.parse(g.date); const row = T[String(g.id)]; const o = (g.odds || [])[0];
  if (row && o && o.ou != null) {
    const f = { gid: g.id, i: row.i, date: g.date, act_total: g.home.pts + g.away.pts, ou: o.ou, resid: g.home.pts + g.away.pts - o.ou, model_dis: row.sim_total - o.ou, home: g.home.abbr, away: g.away.abbr };
    for (const side of ['home', 'away']) { const h = (teamHist[g[side].id] || []).filter((x) => x.t < t); const last = h[h.length - 1]; f[side + '_rest'] = last ? Math.min(7, (t - last.t) / 864e5) : 3; f[side + '_rest_raw'] = last ? (t - last.t) / 864e5 : null; }
    f.rest_diff = f.home_rest - f.away_rest; feats.push(f);
  }
  for (const side of ['home', 'away']) (teamHist[g[side].id] = teamHist[g[side].id] || []).push({ t });
}
console.log(`\n═══ ${LG.toUpperCase()} · H4 rest_diff · n=${feats.length}`);
const ret = (f) => (f.resid > 0 ? 0.909 : -1);   // over a −110
// 1) correlación total y por corte
const cAll = corr(feats.map((f) => f.rest_diff), feats.map((f) => f.resid));
console.log(`corr(rest_diff, real−línea) toda la muestra: ${r3(cAll)} (t ${r2(cAll * Math.sqrt((feats.length - 2) / (1 - cAll * cAll)))})`);
console.log(`colinealidad: corr(rest_diff, home_rest)=${r3(corr(feats.map((f) => f.rest_diff), feats.map((f) => f.home_rest)))} corr(rest_diff, away_rest)=${r3(corr(feats.map((f) => f.rest_diff), feats.map((f) => f.away_rest)))}`);
// 2) bins de rest_diff sobre TODA la muestra: tasa de over
const bins = [[-8, -1.5], [-1.5, -0.5], [-0.5, 0.5], [0.5, 1.5], [1.5, 8]];
for (const [lo, hi] of bins) { const l = feats.filter((f) => f.rest_diff >= lo && f.rest_diff < hi && f.resid !== 0); if (!l.length) continue; const ov = l.filter((f) => f.resid > 0).length; console.log(`  rest_diff [${lo},${hi}): n=${l.length} over ${ov} (${r2(100 * ov / l.length)}%) resid medio ${r2(mean(l.map((f) => f.resid)))} pts · ROI over ${r2(100 * mean(l.map(ret)))}%`); }
// 3) la regla exacta del agente (away descansa ≥0,9 días más → over) con distintos cortes temporales y umbrales
const N = rowsF.dataset_games;
for (const frac of [0.5, 0.6, 0.7]) {
  const cut = Math.floor(N * frac); const dev = feats.filter((f) => f.i < cut), tst = feats.filter((f) => f.i >= cut);
  const cd = corr(dev.map((f) => f.rest_diff), dev.map((f) => f.resid)), ct = corr(tst.map((f) => f.rest_diff), tst.map((f) => f.resid));
  const sgn = Math.sign(cd); // igual que h4.js: over si rest_diff·sgn > umbral (corr<0 ⇒ over cuando el visitante descansa más)
  const baseOver = tst.filter((f) => f.resid !== 0); console.log(`   tasa de over ciega en TEST: ${r2(100 * baseOver.filter((f) => f.resid > 0).length / baseOver.length)}% (n=${baseOver.length}) → ROI over ciego ${r2(100 * mean(baseOver.map(ret)))}%`);
  const vals = dev.map((f) => f.rest_diff * sgn).sort((a, b) => a - b); const q75 = vals[Math.floor(vals.length * 0.75)];
  const bet = (rows, thr) => rows.filter((f) => f.rest_diff * sgn > thr && f.resid !== 0).map(ret);
  const bd = bet(dev, q75), bt = bet(tst, q75);
  const wins = (a) => a.filter((x) => x > 0).length;
  console.log(`corte ${frac * 100}/${100 - frac * 100}: corr dev ${r3(cd)} (n${dev.length}) test ${r3(ct)} (n${tst.length}) · umbral p75_dev=${r2(q75)} · dev n=${bd.length} ${wins(bd)}W ROI ${r2(100 * mean(bd))}±${r2(100 * sdv(bd) / Math.sqrt(bd.length || 1))} · TEST n=${bt.length} ${wins(bt)}W ROI ${r2(100 * mean(bt))}±${r2(100 * sdv(bt) / Math.sqrt(bt.length || 1))}`);
  for (const thr of [0, 0.5, 1, 1.5, 2]) { const b = bet(tst, thr); console.log(`     test umbral ${thr}: n=${b.length} ${wins(b)}W ROI ${r2(100 * mean(b))}`); }
}
// 4) ¿la señal está concentrada en el tiempo (All-Star, Copa) o en pocos equipos?
const cut60 = Math.floor(N * 0.6);
const sel = feats.filter((f) => -f.rest_diff > 0.9 && f.resid !== 0);
console.log(`regla (away_rest − home_rest > 0,9) toda la muestra: n=${sel.length} over ${sel.filter((f) => f.resid > 0).length} · por mes: ${JSON.stringify(sel.reduce((a, f) => { const m = f.date.slice(0, 7); a[m] = a[m] || [0, 0]; a[m][0]++; if (f.resid > 0) a[m][1]++; return a; }, {}))}`);
console.log(`   descanso bruto del visitante en esas picks: media ${r2(mean(sel.map((f) => f.away_rest_raw || 0)))} días · local ${r2(mean(sel.map((f) => f.home_rest_raw || 0)))} · casos con away_rest_raw ≥ 6: ${sel.filter((f) => (f.away_rest_raw || 0) >= 6).length}`);
console.log(`   equipos visitantes: ${JSON.stringify(sel.reduce((a, f) => (a[f.away] = (a[f.away] || 0) + 1, a), {}))}`);
// 5) sin recortar el descanso a 7 y excluyendo casos con descanso ≥6 (parón All-Star)
const sel2 = sel.filter((f) => (f.away_rest_raw || 0) < 6 && (f.home_rest_raw || 0) < 6);
console.log(`   excluyendo parones (≥6 días): n=${sel2.length} over ${sel2.filter((f) => f.resid > 0).length} ROI ${r2(100 * mean(sel2.map(ret)))}`);
// 6) permutación: ¿cuántas de 8 features con signo libre y umbral p75 darían un test ROI ≥ el observado por azar? (aprox. con barajado del residuo)
let ge = 0; const tstF = feats.filter((f) => f.i >= cut60), devF = feats.filter((f) => f.i < cut60);
const obs = (() => { const vals = devF.map((f) => -f.rest_diff).sort((a, b) => a - b); const q = vals[Math.floor(vals.length * 0.75)]; return mean(tstF.filter((f) => -f.rest_diff > q && f.resid !== 0).map(ret)); })();
const PER = 2000; const res = tstF.map((f) => f.resid);
for (let k = 0; k < PER; k++) { const sh = res.slice().sort(() => Math.random() - 0.5); const vals = devF.map((f) => -f.rest_diff).sort((a, b) => a - b); const q = vals[Math.floor(vals.length * 0.75)]; const sub = tstF.map((f, i) => ({ f, r: sh[i] })).filter((x) => -x.f.rest_diff > q && x.r !== 0).map((x) => (x.r > 0 ? 0.909 : -1)); if (mean(sub) >= obs) ge++; }
console.log(`permutación (una sola feature, signo fijado en dev): P(ROI test ≥ ${r2(100 * obs)}%) = ${r3(ge / PER)}`);
