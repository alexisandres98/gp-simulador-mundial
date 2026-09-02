#!/usr/bin/env node
// h1h2.js — análisis sobre las filas volcadas por hoops-bt.js.
//  H1: efecto del histograma (cubos de 5 → 1 punto) sobre TOTAL: picks, acierto, ROI, por banda y por
//      residuo de la línea módulo 5 (que es donde vive el bug).
//  H2: barrido umbral × peso de mezcla en ventana de desarrollo (primer 60 % de la temporada) y UNA
//      evaluación en el último 40 %. Dos formas de mezcla: (a) la del código, log-odds hacia 0,5 con peso w
//      sobre el modelo; (b) mezcla en ESPACIO DE LÍNEA: total_mix = λ·total_modelo + (1−λ)·línea, p_over =
//      Φ((total_mix − línea)/σ_dev) con σ estimada en la ventana de desarrollo.
// uso: node h1h2.js --league=wnba
'use strict';
const path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const LG = String(args.league || 'wnba');
const OUT = path.join(__dirname, 'out');
const cur = require(path.join(OUT, `rows_${LG}_cur.json`)), old = require(path.join(OUT, `rows_${LG}_old.json`));
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null), r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const STD = 1.909;
const settle = (b) => (b.won === null ? 0 : b.won ? b.odds - 1 : -1);
const agg = (list) => {
  if (!list.length) return { n: 0 };
  const rets = list.map(settle); const mu = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, rets.length - 1)); const se = sd / Math.sqrt(rets.length);
  const st = list.filter((b) => b.won !== null), w = st.filter((b) => b.won).length;
  return { n: list.length, wins: w, losses: st.length - w, pushes: list.length - st.length, hit_pct: st.length ? r2(100 * w / st.length) : null, roi_pct: r2(100 * mu), roi_se_pp: r2(100 * se), t: se > 0 ? r2(mu / se) : null, avg_edge_pp: r2(list.reduce((s, b) => s + b.edge_pp, 0) / list.length) };
};
const isPick = (b, th = 2) => b.edge_pp >= th && b.ev_pct >= 2;
const FAM_TH = { moneyline: 2.5, spread: 2, total: 2 };
const picksOf = (rows) => rows.filter((b) => isPick(b, FAM_TH[b.family]));

// ───────── H1 ─────────
console.log(`\n══════════ ${LG.toUpperCase()} · H1 histograma 1 pt (cur) vs cubos de 5 (old) · ${cur.games_evaluated} partidos (${cur.first_date} → ${cur.last_date}) · sims ${cur.sims}`);
const out = { league: LG, games: cur.games_evaluated, h1: {}, h2: {} };
for (const fam of ['total', 'spread', 'moneyline']) {
  out.h1[fam] = { cur: agg(picksOf(cur.rows).filter((b) => b.family === fam)), old: agg(picksOf(old.rows).filter((b) => b.family === fam)) };
  console.log(`  ${fam.padEnd(10)} NUEVO ${JSON.stringify(out.h1[fam].cur)}\n             VIEJO ${JSON.stringify(out.h1[fam].old)}`);
}
// totales: por residuo de línea mod 5, y por lado
const resid = (line) => r2(((line % 5) + 5) % 5);
const T = { cur: picksOf(cur.rows).filter((b) => b.family === 'total'), old: picksOf(old.rows).filter((b) => b.family === 'total') };
out.h1.total_by_residue = {};
console.log('  TOTAL por residuo de la línea (línea mod 5) — bug: x3,5/x4/x4,5 regalaban over; x0,5/x1/x1,5 regalaban under');
for (const v of ['old', 'cur']) {
  const by = {};
  for (const b of T[v]) { const k = resid(b.mkt_ou); (by[k] = by[k] || []).push(b); }
  out.h1.total_by_residue[v] = {};
  for (const k of Object.keys(by).sort((a, b) => +a - +b)) {
    const l = by[k]; const ov = l.filter((b) => b.side === 'over');
    out.h1.total_by_residue[v][k] = { ...agg(l), overs: ov.length, unders: l.length - ov.length };
    console.log(`    ${v} residuo ${String(k).padStart(4)}: n=${String(l.length).padStart(3)} overs=${String(ov.length).padStart(3)} unders=${String(l.length - ov.length).padStart(3)} hit=${agg(l).hit_pct}% roi=${agg(l).roi_pct}%`);
  }
}
// desplazamiento medio de p(over) inducido por el bug, por residuo
const byKey = {}; for (const b of cur.rows) if (b.family === 'total' && b.side === 'over') byKey[b.gid] = b;
const shift = {};
for (const b of old.rows) if (b.family === 'total' && b.side === 'over' && byKey[b.gid]) { const k = resid(b.mkt_ou); (shift[k] = shift[k] || []).push(b.p - byKey[b.gid].p); }
out.h1.p_over_shift_old_minus_new_by_residue = {};
for (const k of Object.keys(shift).sort((a, b) => +a - +b)) { const a = shift[k]; const m = a.reduce((s, x) => s + x, 0) / a.length; out.h1.p_over_shift_old_minus_new_by_residue[k] = { n: a.length, mean_pp: r2(100 * m) }; }
console.log('  sesgo de p(over) viejo − nuevo por residuo (pp):', JSON.stringify(out.h1.p_over_shift_old_minus_new_by_residue));
// por lado y banda
for (const v of ['old', 'cur']) {
  const ov = T[v].filter((b) => b.side === 'over'), un = T[v].filter((b) => b.side === 'under');
  out.h1[`total_by_side_${v}`] = { over: agg(ov), under: agg(un) };
  console.log(`  ${v} TOTAL over ${JSON.stringify(agg(ov))}\n      TOTAL under ${JSON.stringify(agg(un))}`);
  const BANDS = [[2, 4], [4, 6], [6, 8], [8, 12], [12, 100]];
  out.h1[`total_by_band_${v}`] = BANDS.map(([lo, hi]) => ({ band: `${lo}-${hi}`, ...agg(cur.rows.length && (v === 'cur' ? cur : old).rows.filter((b) => b.family === 'total' && b.edge_pp >= lo && b.edge_pp < hi && b.ev_pct > 0)) }));
  console.log(`  ${v} TOTAL por banda: ${out.h1[`total_by_band_${v}`].map((x) => `${x.band}pp n=${x.n} hit=${x.hit_pct} roi=${x.roi_pct}±${x.roi_se_pp}`).join(' | ')}`);
}
// picks que cambian entre versiones
const key = (b) => b.gid + '|' + b.side;
const sOld = new Set(T.old.map(key)), sCur = new Set(T.cur.map(key));
out.h1.total_pick_overlap = { only_old: [...sOld].filter((k) => !sCur.has(k)).length, only_cur: [...sCur].filter((k) => !sOld.has(k)).length, both: [...sCur].filter((k) => sOld.has(k)).length };
console.log('  solapamiento de picks TOTAL viejo/nuevo:', JSON.stringify(out.h1.total_pick_overlap));

// ───────── DIAGNÓSTICO DEL TOTAL (con el histograma correcto) ─────────
const G = {}; for (const b of cur.rows) if (b.family === 'total' && b.side === 'over') G[b.gid] = b;
const games = Object.values(G).sort((a, b) => a.i - b.i);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const eM = games.map((g) => g.act_total - g.sim_total), eK = games.map((g) => g.act_total - g.mkt_ou), d = games.map((g) => g.sim_total - g.mkt_ou);
const cov = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1); };
const beta = cov(eK, d) / cov(d, d);
const seBeta = Math.sqrt((cov(eK, eK) - beta * cov(eK, d)) / (games.length - 2) / cov(d, d));
out.total_diag = { n: games.length, bias_model_pts: r2(mean(eM)), mae_model: r2(mean(eM.map(Math.abs))), sd_model_err: r2(sdv(eM)), bias_market_pts: r2(mean(eK)), mae_market: r2(mean(eK.map(Math.abs))), sd_market_err: r2(sdv(eK)),
  sd_model_minus_market: r2(sdv(d)), mean_model_minus_market: r2(mean(d)), beta_actual_vs_model_disagreement: r3(beta), beta_se: r3(seBeta), beta_t: r2(beta / seBeta),
  corr_model_err_market_err: r3(cov(eM, eK) / (sdv(eM) * sdv(eK))) };
console.log('\n  DIAGNÓSTICO TOTAL (histograma correcto):', JSON.stringify(out.total_diag));
console.log('    → β = cuánto del desacuerdo modelo−mercado se traduce en resultado (1 = el modelo tiene razón, 0 = ruido puro). λ óptimo ≈ β.');
// calibración de p(over): PIT
const bins = [[0, .35], [.35, .45], [.45, .55], [.55, .65], [.65, 1.01]];
out.total_calibration = bins.map(([lo, hi]) => { const l = games.filter((g) => g.p >= lo && g.p < hi && g.won !== null); return { bin: `${lo}-${hi}`, n: l.length, p_avg: r3(mean(l.map((g) => g.p))), over_rate: r3(mean(l.map((g) => g.won))) }; });
console.log('  calibración p(over) modelo:', out.total_calibration.map((x) => `${x.bin}: n=${x.n} p̄=${x.p_avg} real=${x.over_rate}`).join(' | '));

// ───────── H2 ─────────
// ventana de desarrollo = primer 60 % de los partidos del dataset (por índice temporal), evaluación = último 40 %
const N = cur.dataset_games; const cut = Math.floor(N * 0.6);
const rowsT = cur.rows.filter((b) => b.family === 'total');
const dev = rowsT.filter((b) => b.i < cut), tst = rowsT.filter((b) => b.i >= cut);
console.log(`\n══════════ H2 TOTAL · desarrollo: partidos ${cur.rows[0].i}–${cut - 1} · evaluación: ${cut}–${N - 1}`);
const lo = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
const blend = (p, w) => 1 / (1 + Math.exp(-(w * lo(p) + (1 - w) * lo(0.5))));
const applyA = (rows, w, th) => rows.filter((b) => { const p = blend(b.p, w); const edge = 100 * (p - 1 / STD); const ev = 100 * ((1 - b.push) * (p * STD - 1)); return edge >= th && ev >= 2; });
const gridA = []; let bestA = null;
for (const w of [1, 0.5, 0.233]) for (const th of [2, 3, 4, 6]) {
  const a = agg(applyA(dev, w, th)); const cell = { w_model: w, th, dev: a }; gridA.push(cell);
  if (a.n >= 40 && (!bestA || a.roi_pct > bestA.dev.roi_pct)) bestA = cell;
}
console.log('  (a) mezcla log-odds hacia 0,5 (w = peso del modelo; w=0 ⇒ p=0,5 ⇒ cero picks, no se lista) — DESARROLLO:');
for (const c of gridA) console.log(`     w=${c.w_model} th=${c.th}: ${JSON.stringify(c.dev)}`);
if (bestA) { bestA.test = agg(applyA(tst, bestA.w_model, bestA.th)); console.log(`  → elegido en desarrollo: w=${bestA.w_model} th=${bestA.th} · EVALUACIÓN ${JSON.stringify(bestA.test)}`); }
else console.log('  → ninguna celda alcanza n≥40 en desarrollo');
// también todas las celdas en evaluación (solo informativo, NO para elegir)
for (const c of gridA) c.test_informativo = agg(applyA(tst, c.w_model, c.th));
out.h2.a = { grid: gridA, chosen: bestA };

// (b) mezcla en espacio de línea, σ estimada en desarrollo
const devG = games.filter((g) => g.i < cut), tstG = games.filter((g) => g.i >= cut);
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
const sigmaDev = sdv(devG.map((g) => g.act_total - g.mkt_ou));
const betaDev = (() => { const ek = devG.map((g) => g.act_total - g.mkt_ou), dd = devG.map((g) => g.sim_total - g.mkt_ou); return cov(ek, dd) / cov(dd, dd); })();
console.log(`  (b) mezcla en espacio de línea: σ_dev=${r2(sigmaDev)} · β_dev=${r3(betaDev)} (λ óptimo estimado en desarrollo)`);
const applyB = (gs, lam, th) => { const outB = []; for (const g of gs) { const mix = lam * g.sim_total + (1 - lam) * g.mkt_ou; const pOver = Phi((mix - g.mkt_ou) / sigmaDev); for (const side of ['over', 'under']) { const p = side === 'over' ? pOver : 1 - pOver; const edge = 100 * (p - 1 / STD); const ev = 100 * (p * STD - 1); if (edge >= th && ev >= 2) { const res = Math.abs(g.act_total - g.mkt_ou) < 1e-9 ? null : (g.act_total > g.mkt_ou) === (side === 'over') ? 1 : 0; outB.push({ ...g, side, p, edge_pp: edge, won: res, odds: STD }); } } } return outB; };
const gridB = []; let bestB = null;
for (const lam of [1, 0.75, 0.5, 0.25, r3(Math.max(0.05, betaDev))]) for (const th of [2, 3, 4, 6]) {
  const a = agg(applyB(devG, lam, th)); const cell = { lambda: lam, th, dev: a }; gridB.push(cell);
  if (a.n >= 40 && (!bestB || a.roi_pct > bestB.dev.roi_pct)) bestB = cell;
}
for (const c of gridB) console.log(`     λ=${c.lambda} th=${c.th}: ${JSON.stringify(c.dev)}`);
if (bestB) { bestB.test = agg(applyB(tstG, bestB.lambda, bestB.th)); console.log(`  → elegido en desarrollo: λ=${bestB.lambda} th=${bestB.th} · EVALUACIÓN ${JSON.stringify(bestB.test)}`); }
for (const c of gridB) c.test_informativo = agg(applyB(tstG, c.lambda, c.th));
out.h2.b = { sigma_dev: r2(sigmaDev), beta_dev: r3(betaDev), grid: gridB, chosen: bestB };
// β en evaluación (fuera de muestra) para ver si el desacuerdo del modelo informa
const betaTst = (() => { const ek = tstG.map((g) => g.act_total - g.mkt_ou), dd = tstG.map((g) => g.sim_total - g.mkt_ou); return cov(ek, dd) / cov(dd, dd); })();
out.h2.beta_test = r3(betaTst); console.log(`  β en evaluación (fuera de muestra): ${r3(betaTst)} (n=${tstG.length})`);

require('fs').writeFileSync(path.join(OUT, `h1h2_${LG}.json`), JSON.stringify(out, null, 1));
