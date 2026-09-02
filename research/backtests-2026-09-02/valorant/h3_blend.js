// H3 — ¿sirve la opinión de GP como corrección del mercado? Blend p* = σ(logit(p_mkt_sin_margen) + c·Δ),
// Δ = logit(p_gp) − logit(p_mkt_sin_margen), sobre el libro de picks de Valorant (es_full_valorant.json).
// Split temporal por born_at: primer 60 % = ajuste de c (máx. verosimilitud), último 40 % = evaluación UNA vez.
// Margen: el libro solo guarda el lado tomado (0 pares complementarios) → NO se puede estimar. Se ASUME
// 5 % en Pinnacle y 7,5 % en Bovada (dos vías, mercados derivados) y se declara; sensibilidad con 3 % y 8 %.
// ROI a la cuota tomada y al cierre (close_odds) con la regla fijada a priori: apostar si p*·cuota − 1 > 0
// (y variante con ventaja ≥ 3 pp sobre la implícita bruta 1/cuota, que es el listón mínimo de producción).
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const RESEARCH = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research';
const C = require('/home/user/gp-simulador-mundial/esports-engine/core.js');
const book = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'es_full_valorant.json'), 'utf8')).recent
  .filter((p) => p.result_code === 'WIN' || p.result_code === 'LOSS')
  .sort((a, b) => (a.born_at < b.born_at ? -1 : 1));
const lg = (p) => Math.log(p / (1 - p)), sg = (x) => 1 / (1 + Math.exp(-x));
const cl = (p) => Math.min(0.98, Math.max(0.02, p));
const r4 = (x) => +x.toFixed(4), r2 = (x) => +x.toFixed(2);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const MARGIN = { pinnacle: 0.05, bovada: 0.075 };

const nFit = Math.round(0.6 * book.length);
const fit = book.slice(0, nFit), ev = book.slice(nFit);
console.log(`[h3] ${book.length} picks liquidadas; ajuste ${fit.length} (${fit[0].born_at.slice(0, 10)} → ${fit[fit.length - 1].born_at.slice(0, 10)}), evaluación ${ev.length} (${ev[0].born_at.slice(0, 10)} → ${ev[ev.length - 1].born_at.slice(0, 10)})`);

function prep(p, marginBy = MARGIN) {
  const m = marginBy[p.book] != null ? marginBy[p.book] : 0.05;
  const pm = cl(p.p_market / (1 + m));            // p_market del libro = 1/cuota CON margen
  const pg = cl(p.p_gp);
  return { y: p.result_code === 'WIN' ? 1 : 0, pm, pg, d: lg(pg) - lg(pm), odds: p.odds, close: p.close_odds || null, fam: p.family, book: p.book };
}
const ll = (rows, c) => -mean(rows.map((r) => { const p = cl(sg(lg(r.pm) + c * r.d)); return r.y ? Math.log(p) : Math.log(1 - p); }));
const brier = (rows, pf) => mean(rows.map((r) => (pf(r) - r.y) ** 2));
function fitC(rows) {
  let best = null;
  for (let c = -1.0; c <= 1.5001; c += 0.05) { const v = ll(rows, c); if (!best || v < best.ll) best = { c: +c.toFixed(2), ll: r4(v) }; }
  return best;
}
function roi(rows, pf, { minEdgePp = 0, atClose = false } = {}) {
  let n = 0, units = 0, w = 0, nc = 0, unitsC = 0;
  for (const r of rows) {
    const p = pf(r); const edge = (p - 1 / r.odds) * 100;
    if (!(p * r.odds - 1 > 0) || edge < minEdgePp) continue;
    n++; units += r.y ? r.odds - 1 : -1; w += r.y;
    if (r.close) { nc++; unitsC += r.y ? r.close - 1 : -1; }
  }
  return { n, hit_pct: n ? r2(100 * w / n) : null, roi_pct: n ? r2(100 * units / n) : null, n_cierre: nc, roi_cierre_pct: nc ? r2(100 * unitsC / nc) : null };
}
function bootRoi(rows, pf, reps = 2000, seed = 11) {
  const sel = rows.filter((r) => pf(r) * r.odds - 1 > 0).map((r) => (r.y ? r.odds - 1 : -1));
  if (!sel.length) return null;
  const rnd = C.rng(seed); const out = [];
  for (let k = 0; k < reps; k++) { let s = 0; for (let i = 0; i < sel.length; i++) s += sel[(rnd() * sel.length) | 0]; out.push(100 * s / sel.length); }
  out.sort((a, b) => a - b);
  const m = mean(out); const se = Math.sqrt(mean(out.map((x) => (x - m) ** 2)));
  return { n: sel.length, roi_pct: r2(100 * mean(sel)), se_pct: r2(se), ci95: [r2(out[Math.floor(0.025 * reps)]), r2(out[Math.floor(0.975 * reps)])] };
}

const F = fit.map((p) => prep(p)), E = ev.map((p) => prep(p));
const cAll = fitC(F);
const byFam = {};
for (const fam of ['RONDAS', 'RONDAS_HANDICAP', 'RONDAS_EQUIPO', 'HANDICAP']) { const rows = F.filter((r) => r.fam === fam); if (rows.length >= 15) byFam[fam] = { n: rows.length, ...fitC(rows) }; }
console.log(`[h3] c global ajustado = ${cAll.c} (logloss ${cAll.ll}); referencias: c=0 → ${r4(ll(F, 0))}, c=1 → ${r4(ll(F, 1))}`);
console.log('[h3] c por familia (ajuste):', JSON.stringify(byFam));

const preds = {
  mercado_sin_margen: (r) => r.pm,
  gp_original: (r) => r.pg,
  ['blend_c=' + cAll.c]: (r) => cl(sg(lg(r.pm) + cAll.c * r.d)),
  blend_por_familia: (r) => cl(sg(lg(r.pm) + ((byFam[r.fam] && byFam[r.fam].c) || 0) * r.d)),
};
const evalTab = {};
for (const [k, pf] of Object.entries(preds)) {
  evalTab[k] = { brier: r4(brier(E, pf)), logloss: r4(-mean(E.map((r) => { const p = cl(pf(r)); return r.y ? Math.log(p) : Math.log(1 - p); }))),
    ...roi(E, pf), con_3pp: roi(E, pf, { minEdgePp: 3 }), boot: bootRoi(E, pf) };
}
// la regla actual: TODAS las picks del libro tal cual nacieron (p_gp con su gate) — es lo que hay que batir
const asBorn = { n: E.length, hit_pct: r2(100 * mean(E.map((r) => r.y))), roi_pct: r2(100 * mean(E.map((r) => (r.y ? r.odds - 1 : -1)))),
  n_cierre: E.filter((r) => r.close).length, roi_cierre_pct: r2(100 * mean(E.filter((r) => r.close).map((r) => (r.y ? r.close - 1 : -1)))),
  clv_pct_medio: r2(mean(E.filter((r) => r.close).map((r) => 100 * (r.odds / r.close - 1)))) };
console.log('\n[h3] EVALUACIÓN (último 40 %) — regla actual (todas las picks nacidas):', JSON.stringify(asBorn));
console.log('[h3] EVALUACIÓN — predictores (apuesta si p·cuota>1):');
for (const [k, v] of Object.entries(evalTab)) console.log(`  ${k.padEnd(20)} brier ${v.brier} logloss ${v.logloss} · n=${v.n} hit ${v.hit_pct}% ROI ${v.roi_pct}% (SE ${v.boot ? v.boot.se_pct : '—'}) · cierre n=${v.n_cierre} ROI ${v.roi_cierre_pct}% · con ≥3pp: n=${v.con_3pp.n} ROI ${v.con_3pp.roi_pct}%`);
// Brier sobre TODO el libro (referencia)
const ALL = book.map((p) => prep(p));
const allTab = { n: ALL.length, brier_mercado_sin_margen: r4(brier(ALL, (r) => r.pm)), brier_mercado_bruto: r4(brier(ALL, (r) => cl(r.pm * (1 + (MARGIN[r.book] || 0.05))))), brier_gp: r4(brier(ALL, (r) => r.pg)), hit_pct: r2(100 * mean(ALL.map((r) => r.y))), p_gp_medio: r4(mean(ALL.map((r) => r.pg))), p_mkt_medio: r4(mean(ALL.map((r) => r.pm))) };
console.log('[h3] libro completo:', JSON.stringify(allTab));
// sensibilidad al margen asumido
const sens = {};
for (const m of [0.03, 0.05, 0.08]) {
  const F2 = fit.map((p) => prep(p, { pinnacle: m, bovada: m })), E2 = ev.map((p) => prep(p, { pinnacle: m, bovada: m }));
  const c2 = fitC(F2); const pf = (r) => cl(sg(lg(r.pm) + c2.c * r.d));
  sens['margen_' + m] = { c: c2.c, brier_eval: r4(brier(E2, pf)), brier_mercado: r4(brier(E2, (r) => r.pm)), ...roi(E2, pf) };
}
console.log('[h3] sensibilidad al margen:', JSON.stringify(sens));
// ¿y la señal INVERSA? (c<0 significa que donde GP se separa del mercado, la verdad está al otro lado)
const inv = { c_ajustado: cAll.c, interpretacion: cAll.c < 0 ? 'la desviación de GP respecto al mercado es ANTI-informativa en el ajuste' : cAll.c < 0.2 ? 'GP no añade información al mercado' : 'GP añade algo' };
fs.writeFileSync(path.join(HERE, 'h3_result.json'), JSON.stringify({ at: new Date().toISOString(), margen_asumido: MARGIN, n_fit: fit.length, n_eval: ev.length, c: cAll, c_por_familia: byFam, regla_actual_eval: asBorn, eval: evalTab, libro_completo: allTab, sensibilidad: sens, lectura: inv }, null, 1));
console.log('[h3] escrito h3_result.json');
