#!/usr/bin/env node
// h4.js — ¿qué capa mejoraría el margen frente al cierre?
//  1) distancia del modelo al cierre en HÁNDICAP y TOTAL (con las filas de hoops-bt.js): sd(modelo − mercado),
//     β = cov(real − mercado, modelo − mercado)/var(modelo − mercado) — si β≈0 el desacuerdo es ruido.
//  2) ¿tiene el CIERRE un residuo predecible con datos que el repo YA guarda? Regresión del residuo del
//     cierre (real − línea) sobre rasgos conocidos antes del partido, construidos SOLO con partidos anteriores:
//     descanso (días) de cada equipo, back-to-back, ritmo reciente, tasa de triples reciente, tasa de faltas
//     de la terna arbitral (WNBA), y el desacuerdo del modelo. Ajuste en el primer 60 %, evaluación en el
//     último 40 % (correlación fuera de muestra + ROI de una regla simple sobre el signo).
// uso: node h4.js --league=wnba
'use strict';
const path = require('path');
const fs = require('fs');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const LG = String(args.league || 'wnba');
const REPO = '/home/user/gp-simulador-mundial';
const OUT = path.join(__dirname, 'out');
const rowsF = require(path.join(OUT, `rows_${LG}_cur.json`));
const GJ = JSON.parse(fs.readFileSync(path.join(REPO, 'data/basketball', `games-${LG}-2026.json`), 'utf8'));
const games = Object.values(GJ.games).filter((g) => g.home.pts != null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const byId = {}; for (const g of games) byId[String(g.id)] = g;
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null), r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const cov = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1); };
const corr = (a, b) => cov(a, b) / (sdv(a) * sdv(b));
const out = { league: LG };

// ── 1) distancia al cierre ──
const G = {}; for (const b of rowsF.rows) if (b.family === 'spread' && b.side === 'home') G[b.gid] = b;
const S = Object.values(G).sort((a, b) => a.i - b.i);
const dS = S.map((g) => g.sim_margin + g.mkt_sp), eS = S.map((g) => g.act_margin + g.mkt_sp), eMS = S.map((g) => g.act_margin - g.sim_margin);
const betaS = cov(eS, dS) / cov(dS, dS), seBS = Math.sqrt((cov(eS, eS) - betaS * cov(eS, dS)) / (S.length - 2) / cov(dS, dS));
out.spread_diag = { n: S.length, mae_model_margin: r2(mean(eMS.map(Math.abs))), mae_market_margin: r2(mean(eS.map(Math.abs))), sd_model_err: r2(sdv(eMS)), sd_market_err: r2(sdv(eS)),
  sd_model_minus_market: r2(sdv(dS)), mean_model_minus_market: r2(mean(dS)), beta: r3(betaS), beta_se: r3(seBS), beta_t: r2(betaS / seBS), corr_errors: r3(corr(eMS, eS)) };
console.log(`\n══════════ ${LG.toUpperCase()} · H4 · distancia al cierre`);
console.log('  HÁNDICAP:', JSON.stringify(out.spread_diag));
// ¿comprime el modelo a los favoritos? desacuerdo medio por |línea|
out.spread_by_absline = [[0, 4], [4, 8], [8, 12], [12, 40]].map(([lo, hi]) => { const l = S.filter((g) => Math.abs(g.mkt_sp) >= lo && Math.abs(g.mkt_sp) < hi); if (!l.length) return null;
  // signo hacia el favorito: d_fav = (sim_margin − (−sp))·sign(−sp) → >0 el modelo ve al favorito MÁS fuerte que el mercado
  const dFav = l.map((g) => (g.sim_margin + g.mkt_sp) * Math.sign(-g.mkt_sp || 1)), eFav = l.map((g) => (g.act_margin + g.mkt_sp) * Math.sign(-g.mkt_sp || 1));
  const favCover = l.filter((g) => (g.act_margin + g.mkt_sp) * Math.sign(-g.mkt_sp || 1) > 0).length;
  return { band: `|línea| ${lo}-${hi}`, n: l.length, model_minus_market_toward_fav_pts: r2(mean(dFav)), real_minus_market_toward_fav_pts: r2(mean(eFav)), fav_cover_pct: r2(100 * favCover / l.length), p_home_model_avg: r3(mean(l.map((g) => g.p))), home_cover_pct: r2(100 * l.filter((g) => g.won === 1).length / l.filter((g) => g.won !== null).length) }; }).filter(Boolean);
console.log('  hándicap por |línea| (¿el modelo comprime al favorito?):'); for (const b of out.spread_by_absline) console.log('   ', JSON.stringify(b));
// calibración de P(local cubre)
out.spread_calibration = [[0, .4], [.4, .47], [.47, .53], [.53, .6], [.6, 1.01]].map(([lo, hi]) => { const l = S.filter((g) => g.p >= lo && g.p < hi && g.won !== null); return { bin: `${lo}-${hi}`, n: l.length, p_avg: r3(mean(l.map((g) => g.p))), cover_rate: r3(mean(l.map((g) => g.won))) }; });
console.log('  calibración P(local cubre):', out.spread_calibration.map((x) => `${x.bin}: n=${x.n} p̄=${x.p_avg} real=${x.cover_rate}`).join(' | '));

// ── 2) rasgos pre-partido construidos solo con el pasado ──
const teamHist = {}; // id → [{t, poss, tpa_rate, pts, date}]
const offHist = {};  // árbitro → [{t, resid_total}]
const feats = [];
const T = {}; for (const b of rowsF.rows) if (b.family === 'total' && b.side === 'over') T[b.gid] = b;
for (const g of games) {
  const t = Date.parse(g.date);
  const row = T[String(g.id)];
  const o = (g.odds || [])[0];
  if (row && o && o.ou != null) {
    const f = { gid: g.id, i: row.i, t, act_total: g.home.pts + g.away.pts, ou: o.ou, sim_total: row.sim_total, resid: g.home.pts + g.away.pts - o.ou, model_dis: row.sim_total - o.ou };
    for (const side of ['home', 'away']) {
      const h = (teamHist[g[side].id] || []).filter((x) => x.t < t).slice(-10);
      const last = h[h.length - 1];
      f[side + '_rest'] = last ? Math.min(7, (t - last.t) / 864e5) : 3;
      f[side + '_b2b'] = last && (t - last.t) / 864e5 < 1.4 ? 1 : 0;
      f[side + '_tpa'] = h.length >= 3 ? mean(h.map((x) => x.tpa_rate)) : null;
      f[side + '_pace'] = h.length >= 3 ? mean(h.map((x) => x.poss)) : null;
      f[side + '_ptsres'] = h.length >= 3 ? mean(h.map((x) => x.total_resid)) : null;   // ¿sus partidos vienen pasando el total?
      f[side + '_n'] = h.length;
    }
    // árbitros: media (encogida) del residuo del total en sus partidos anteriores
    const offs = (g.officials || []).map((n) => (offHist[n] || []).filter((x) => x.t < t));
    const offRes = offs.flat();
    f.off_n = offRes.length; f.off_resid = offRes.length ? mean(offRes.map((x) => x.r)) * (offRes.length / (offRes.length + 10)) : 0;
    f.tpa_sum = f.home_tpa != null && f.away_tpa != null ? f.home_tpa + f.away_tpa : null;
    f.rest_diff = f.home_rest - f.away_rest; f.b2b_any = f.home_b2b + f.away_b2b;
    f.ptsres_sum = f.home_ptsres != null && f.away_ptsres != null ? f.home_ptsres + f.away_ptsres : null;
    feats.push(f);
  }
  // actualizar historiales con este partido (después de usarlo como predicción)
  const resid = o && o.ou != null ? g.home.pts + g.away.pts - o.ou : null;
  for (const side of ['home', 'away']) (teamHist[g[side].id] = teamHist[g[side].id] || []).push({ t, poss: g.poss, tpa_rate: g[side].ff.tpa_rate, total_resid: resid != null ? resid : 0 });
  if (resid != null) for (const n of (g.officials || [])) (offHist[n] = offHist[n] || []).push({ t, r: resid });
}
const usable = feats.filter((f) => f.tpa_sum != null && f.ptsres_sum != null);
const N = rowsF.dataset_games, cut = Math.floor(N * 0.6);
const dev = usable.filter((f) => f.i < cut), tst = usable.filter((f) => f.i >= cut);
console.log(`\n  RESIDUO DEL CIERRE (real − línea) vs rasgos pre-partido · desarrollo n=${dev.length} · evaluación n=${tst.length}`);
const FEATS = ['model_dis', 'tpa_sum', 'rest_diff', 'b2b_any', 'home_rest', 'away_rest', 'ptsres_sum', 'off_resid'];
out.feature_corr = {};
for (const k of FEATS) {
  const cd = corr(dev.map((f) => f[k]), dev.map((f) => f.resid)), ct = corr(tst.map((f) => f[k]), tst.map((f) => f.resid));
  const tDev = cd * Math.sqrt((dev.length - 2) / (1 - cd * cd)), tTst = ct * Math.sqrt((tst.length - 2) / (1 - ct * ct));
  out.feature_corr[k] = { corr_dev: r3(cd), t_dev: r2(tDev), corr_test: r3(ct), t_test: r2(tTst) };
  console.log(`   ${k.padEnd(12)} corr dev ${String(r3(cd)).padStart(7)} (t ${r2(tDev)}) · corr test ${String(r3(ct)).padStart(7)} (t ${r2(tTst)})`);
}
// regla simple para cada rasgo con |corr dev| ≥ 0,1: signo elegido en desarrollo, evaluado en test — apostar over si rasgo·signo > umbral (mediana dev)
out.feature_rules = {};
for (const k of FEATS) {
  const fc = out.feature_corr[k]; if (Math.abs(fc.corr_dev) < 0.08) continue;
  const sgn = Math.sign(fc.corr_dev);
  const vals = dev.map((f) => f[k] * sgn).sort((a, b) => a - b); const q75 = vals[Math.floor(vals.length * 0.75)];
  const bet = (rows) => rows.filter((f) => f[k] * sgn > q75 && f.resid !== 0).map((f) => (f.resid > 0 ? 0.909 : -1));
  const bd = bet(dev), bt = bet(tst);
  out.feature_rules[k] = { rule: `over si ${k}·${sgn} > p75_dev(${r2(q75)})`, dev: { n: bd.length, roi_pct: r2(100 * mean(bd)), se_pp: r2(100 * sdv(bd) / Math.sqrt(bd.length || 1)) }, test: { n: bt.length, roi_pct: r2(100 * mean(bt)), se_pp: r2(100 * sdv(bt) / Math.sqrt(bt.length || 1)) } };
  console.log(`   regla ${k}: ${JSON.stringify(out.feature_rules[k])}`);
}
// árbitros: cobertura
out.officials_coverage = { games_with_officials: games.filter((g) => g.officials && g.officials.length).length, distinct: Object.keys(offHist).length, avg_prior_games_per_crew: r2(mean(feats.map((f) => f.off_n))) };
console.log('  árbitros:', JSON.stringify(out.officials_coverage));
fs.writeFileSync(path.join(OUT, `h4_${LG}.json`), JSON.stringify(out, null, 1));
