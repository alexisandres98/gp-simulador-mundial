#!/usr/bin/env node
// recheck.js — recomputo independiente de H1/H2 desde mis propias filas (skeptic/rows_*).
// uso: node recheck.js --league=wnba
'use strict';
const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const LG = String(args.league || 'wnba');
const cur = require(path.join(__dirname, `rows_${LG}_cur.json`)), old = require(path.join(__dirname, `rows_${LG}_old.json`));
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null), r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const cov = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1); };
const STD = 1.909;
// ROI propio: unidades ganadas/perdidas; el push devuelve la apuesta. Recalculo won desde los datos crudos, no desde b.won.
const won = (b) => {
  if (b.family === 'total') { if (Math.abs(b.act_total - b.mkt_ou) < 1e-9) return null; return (b.act_total > b.mkt_ou) === (b.side === 'over') ? 1 : 0; }
  if (b.family === 'spread') { const c = b.act_margin + b.mkt_sp; if (Math.abs(c) < 1e-9) return null; return (c > 0) === (b.side === 'home') ? 1 : 0; }
  return (b.act_margin > 0) === (b.side === 'home') ? 1 : 0;
};
let wonMism = 0; for (const b of cur.rows) if (won(b) !== b.won) wonMism++;
console.log(`\n═══ ${LG.toUpperCase()} · filas ${cur.rows.length} · partidos ${cur.games_evaluated} · won recalculado ≠ b.won: ${wonMism}`);
// edge recalculado: edge_pp = 100·(p − 1/odds) (p ya condicionada al no-push)
let edgeMism = 0; for (const b of cur.rows) if (Math.abs(100 * (b.p - 1 / b.odds) - b.edge_pp) > 0.06) edgeMism++;
console.log(`edge_pp recalculado ≠ fila (tol 0,06): ${edgeMism}`);
const settle = (b) => { const w = won(b); return w === null ? 0 : w ? b.odds - 1 : -1; };
const agg = (l) => { if (!l.length) return { n: 0 }; const u = l.map(settle); const st = l.filter((b) => won(b) !== null); const w = st.filter((b) => won(b)).length; const se = sdv(u) / Math.sqrt(u.length); return { n: l.length, pushes: l.length - st.length, hit: r2(100 * w / st.length), roi: r2(100 * mean(u)), se: r2(100 * se), t: r2(mean(u) / se) }; };
const TH = { moneyline: 2.5, spread: 2, total: 2 };
const isPick = (b) => b.edge_pp >= TH[b.family] && b.ev_pct >= 2;
console.log('H1 picks por familia (regla de producción th/EV):');
for (const f of ['total', 'spread', 'moneyline']) console.log(`  ${f.padEnd(9)} NUEVO ${JSON.stringify(agg(cur.rows.filter((b) => b.family === f && isPick(b))))}  VIEJO ${JSON.stringify(agg(old.rows.filter((b) => b.family === f && isPick(b))))}`);
// pushes en el dataset: líneas enteras
const intOU = new Set(cur.rows.filter((b) => b.family === 'total' && Number.isInteger(b.mkt_ou)).map((b) => b.gid)).size, intSP = new Set(cur.rows.filter((b) => b.family === 'spread' && Number.isInteger(b.mkt_sp)).map((b) => b.gid)).size;
const pushT = cur.rows.filter((b) => b.family === 'total' && b.side === 'over' && won(b) === null).length, pushS = cur.rows.filter((b) => b.family === 'spread' && b.side === 'home' && won(b) === null).length;
console.log(`partidos con total entero: ${intOU} (empujes reales ${pushT}) · con hándicap entero: ${intSP} (empujes reales ${pushS})`);
// ¿Alguna vez se pickean ambos lados del mismo partido? (imposible con edge>0 en un solo lado, pero comprobar)
const both = {}; for (const b of cur.rows.filter(isPick)) (both[b.gid + b.family] = both[b.gid + b.family] || []).push(b.side);
console.log('picks a ambos lados del mismo partido/familia:', Object.values(both).filter((s) => s.length > 1).length);
// sesgo del histograma viejo por residuo: recalculo directo
const byG = {}; for (const b of cur.rows) if (b.family === 'total' && b.side === 'over') byG[b.gid] = b;
const sh = {}; for (const b of old.rows) if (b.family === 'total' && b.side === 'over' && byG[b.gid]) { const k = r2(((b.mkt_ou % 5) + 5) % 5); (sh[k] = sh[k] || []).push(b.p - byG[b.gid].p); }
console.log('p_over viejo − nuevo por residuo (pp):', Object.keys(sh).sort((a, b) => a - b).map((k) => `${k}: ${r2(100 * mean(sh[k]))} (sd ${r2(100 * sdv(sh[k]))}, n ${sh[k].length})`).join(' | '));
// sesgo direccional en las picks: over/under y hit por versión
for (const [lab, R] of [['VIEJO', old], ['NUEVO', cur]]) { const P = R.rows.filter((b) => b.family === 'total' && isPick(b)); console.log(`  ${lab} TOTAL picks: over ${JSON.stringify(agg(P.filter((b) => b.side === 'over')))} under ${JSON.stringify(agg(P.filter((b) => b.side === 'under')))}`); }
// ─── β y test de "el desacuerdo informa" con bootstrap ───
const G = Object.values(byG).sort((a, b) => a.i - b.i);
const eK = G.map((g) => g.act_total - g.mkt_ou), d = G.map((g) => g.sim_total - g.mkt_ou);
const beta = cov(eK, d) / cov(d, d);
const boots = []; for (let k = 0; k < 2000; k++) { const idx = Array.from({ length: G.length }, () => Math.floor(Math.random() * G.length)); const a = idx.map((i) => eK[i]), b = idx.map((i) => d[i]); boots.push(cov(a, b) / cov(b, b)); }
boots.sort((a, b) => a - b);
console.log(`β total = ${r3(beta)} · bootstrap IC95 [${r3(boots[50])}, ${r3(boots[1949])}] · sd(modelo−mercado) ${r2(sdv(d))} · sesgo modelo ${r2(mean(G.map((g) => g.act_total - g.sim_total)))} pts, mercado ${r2(mean(eK))} pts`);
// también el signo: % de partidos donde el lado del modelo (signo de d) acierta el signo del residuo
const signHit = G.filter((g) => Math.abs(g.sim_total - g.mkt_ou) >= 2 && g.act_total !== g.mkt_ou).map((g) => Math.sign(g.sim_total - g.mkt_ou) === Math.sign(g.act_total - g.mkt_ou) ? 1 : 0);
console.log(`signo del desacuerdo (|d|≥2) acierta el residuo: ${r2(100 * mean(signHit))}% (n=${signHit.length}, se ${r2(100 * Math.sqrt(0.25 / signHit.length))}) · break-even −110 = 52,4%`);
// ─── H2: comprobar la elección en desarrollo y el test; además sensibilidad del corte 50/50 y 70/30 ───
const N = cur.dataset_games;
const lo = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
const blend = (p, w) => 1 / (1 + Math.exp(-(w * lo(p))));
const applyA = (rows, w, th) => rows.filter((b) => { const p = blend(b.p, w); return 100 * (p - 1 / STD) >= th && 100 * ((1 - b.push) * (p * STD - 1)) >= 2; });
const rowsT = cur.rows.filter((b) => b.family === 'total');
for (const frac of [0.5, 0.6, 0.7]) {
  const cut = Math.floor(N * frac); const dev = rowsT.filter((b) => b.i < cut), tst = rowsT.filter((b) => b.i >= cut);
  let best = null; const cells = [];
  for (const w of [1, 0.5, 0.233]) for (const th of [2, 3, 4, 6]) { const a = agg(applyA(dev, w, th)); cells.push({ w, th, dev: a, test: agg(applyA(tst, w, th)) }); if (a.n >= 40 && (!best || a.roi > best.dev.roi)) best = cells[cells.length - 1]; }
  console.log(`H2(a) corte ${frac * 100}/${100 - frac * 100}: elegido ${best ? `w=${best.w} th=${best.th} dev ${JSON.stringify(best.dev)} → TEST ${JSON.stringify(best.test)}` : 'ninguna celda n≥40'}`);
  const posBoth = cells.filter((c) => c.dev.n >= 20 && c.test.n >= 20 && c.dev.roi > 0 && c.test.roi > 0);
  console.log(`   celdas positivas en dev Y test (n≥20 ambos): ${posBoth.length ? posBoth.map((c) => `w=${c.w} th=${c.th} dev ${c.dev.roi}±${c.dev.se} (n${c.dev.n}) test ${c.test.roi}±${c.test.se} (n${c.test.n})`).join(' ; ') : 'ninguna'}`);
}
// ─── la regla de producción completa (w=0,233 real) en TODA la muestra ───
console.log('regla de producción (w=0,233, th 2, EV 2) TOTAL en toda la muestra:', JSON.stringify(agg(applyA(rowsT, 0.233, 2))));
console.log('regla de producción SPREAD (w=0,233, th 2):', JSON.stringify(agg(applyA(cur.rows.filter((b) => b.family === 'spread'), 0.233, 2))));
