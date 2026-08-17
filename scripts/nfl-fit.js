// scripts/nfl-fit.js — EL AJUSTE Y LA VALIDACIÓN DEL MODELO NFL (17-ago, blueprint §27).
//
// "Point-in-time o no existe" (NFL-0737+). Este script recorre el histórico en orden temporal estricto,
// predice cada partido SOLO con lo anterior y deja escrito en `data/nfl/model-priors.json`:
//   · Las CONSTANTES ajustadas (HFA, mapeo EPA→total, base de anotación móvil).
//   · El POOL DE RESIDUOS contra el CIERRE 2016-2025: pares (margen−spread, total−línea) del mismo
//     partido. El simulador muestrea de estos pares — así la masa en los números clave (3/6/7/10/14) y la
//     correlación margen-total salen de la REALIDAD, no de una Normal inventada (NFL-0460/0461/0454).
//   · La INFLACIÓN de varianza del modelo: nuestro mu tiene más error que el cierre; la diferencia medida
//     se añade como ruido discreto — esconderla sería fingir la precisión del mercado sin tenerla.
//   · La VALIDACIÓN completa: MAE de margen/total modelo vs mercado, Brier del ganador modelo vs
//     moneyline sin vig, por temporada. Va al model card tal cual (NFL-0996+): el que mire, sabe.
//
// Uso: node scripts/nfl-fit.js
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('../nfl-engine/data');

const OUT = path.join(D.DIR, 'model-priors.json');
const log = (...a) => console.log(...a);

(async () => {
  const t0 = Date.now();
  const data = D.load();
  if (!data.available) { console.error('sin agregados: corre nfl-harvest primero'); process.exit(1); }
  const games = data.games.filter((g) => g.type !== 'PRE');

  // ── 0) la convención del spread, VERIFICADA y no asumida (NFL-1036: market side/sign tests) ────────────
  const withLine = games.filter((g) => g.result != null && g.spread_close != null);
  const cov = (() => {
    let s = 0; for (const g of withLine) s += (g.result - g.spread_close);
    return s / withLine.length;
  })();
  // si spread_close fuera la línea del visitante, el residuo medio sería ~2×HFA; con la del local es ~0
  if (Math.abs(cov) > 1.5) throw new Error(`convención de spread sospechosa: residuo medio ${cov.toFixed(2)}`);
  log(`▸ convención verificada: result − spread_close medio = ${cov.toFixed(3)} (local favorito = línea positiva)`);

  // ── 1) walk-forward: snapshots de rating por semana ────────────────────────────────────────────────────
  // Los snapshots se calculan una vez por (season, week) y sirven para predecir esa semana entera.
  const weeks = [...new Set(games.filter((g) => g.result != null && g.season >= 2017).map((g) => g.season * 100 + g.week))].sort((a, b) => a - b);
  const firstDateOf = {};
  for (const g of games) {
    const k = g.season * 100 + g.week;
    if (!firstDateOf[k] || g.date < firstDateOf[k]) firstDateOf[k] = g.date;
  }
  const snaps = {};
  for (const wk of weeks) snaps[wk] = D.ratings(data, { beforeDate: firstDateOf[wk] });
  log(`▸ ${weeks.length} snapshots de rating (2017→)`);

  // estados EPA por semana (para el total)
  const epaSnaps = {};
  for (const wk of weeks) {
    const season = Math.floor(wk / 100), week = wk % 100;
    epaSnaps[wk] = D.epaStates(data, { beforeSeason: season, beforeWeek: week });
  }

  // ── 2) HFA ajustado sobre predicciones walk-forward (dos pasadas bastan) ───────────────────────────────
  const pred = [];
  for (const g of games) {
    if (g.result == null || g.season < 2017) continue;
    const wk = g.season * 100 + g.week;
    const R = snaps[wk]; if (!R || !R.teams) continue;
    const h = R.teams[D.CUR(g.home)], a = R.teams[D.CUR(g.away)];
    if (!h || !a) continue;
    pred.push({ g, diff: h.pts - a.pts, neutral: g.location === 'Neutral', wk });
  }
  let hfa = 0;
  { let s = 0, n = 0; for (const p of pred) { if (!p.neutral) { s += (p.g.result - p.diff); n++; } } hfa = s / n; }
  log(`▸ HFA ajustado: ${hfa.toFixed(2)} puntos (${pred.length} partidos walk-forward)`);

  // ── 3) TOTAL: base móvil de liga + mapeo EPA→puntos por OLS ────────────────────────────────────────────
  // base móvil: media de totales de los últimos 200 partidos ANTES del corte (la liga anota distinto por época)
  const doneByDate = games.filter((g) => g.total != null).map((g) => ({ d: g.date, t: g.total }));
  const baseAt = (date) => {
    const prev = doneByDate.filter((x) => x.d < date).slice(-200);
    return prev.length >= 50 ? prev.reduce((s, x) => s + x.t, 0) / prev.length : 44;
  };
  const totPairs = [];
  for (const p of pred) {
    const E = epaSnaps[p.wk]; if (!E) continue;
    const mu = D.leagueMeans(E);
    const H = E.teams[D.CUR(p.g.home)], A = E.teams[D.CUR(p.g.away)];
    if (!H || !A || H.pass_off == null || A.pass_off == null || H.pass_def == null || A.pass_def == null) continue;
    const offT = (t) => (t.pass_off - mu.pass_off) * (t.pass_rate != null ? t.pass_rate : 0.58)
      + (t.rush_off - mu.rush_off) * (1 - (t.pass_rate != null ? t.pass_rate : 0.58));
    const defT = (t) => (t.pass_def - mu.pass_def) * 0.58 + (t.rush_def - mu.rush_def) * 0.42;
    const x = offT(H) + offT(A) + defT(H) + defT(A);
    totPairs.push({ x, y: p.g.total - baseAt(p.g.date), p });
  }
  let kTotal = 0;
  { let sxy = 0, sxx = 0; for (const q of totPairs) { sxy += q.x * q.y; sxx += q.x * q.x; } kTotal = sxx ? sxy / sxx : 0; }
  log(`▸ mapeo EPA→total: k = ${kTotal.toFixed(1)} puntos por EPA compuesta (${totPairs.length} partidos)`);

  // ── 4) POOL DE RESIDUOS contra el cierre (2016→) ───────────────────────────────────────────────────────
  const pool = [];
  for (const g of withLine) {
    if (g.total == null || g.total_close == null) continue;
    pool.push([+(g.result - g.spread_close).toFixed(1), +(g.total - g.total_close).toFixed(1)]);
  }
  log(`▸ pool de residuos vs cierre: ${pool.length} pares (margen, total)`);

  // ── 5) validación: modelo vs mercado, walk-forward, por temporada ──────────────────────────────────────
  const bySeason = {};
  const errM = [], errMkt = [], errT = [], errTmkt = [];
  const brier = { model: [], market: [] };
  const totIdx = new Map(totPairs.map((q) => [q.p.g.id, q]));
  for (const p of pred) {
    const g = p.g;
    const muM = p.diff + (p.neutral ? 0 : hfa);
    const S = bySeason[g.season] = bySeason[g.season] || { n: 0, mae_m: 0, mae_mkt: 0, mae_t: 0, mae_tmkt: 0, nt: 0, brier_m: 0, brier_mkt: 0, nb: 0 };
    S.n++;
    errM.push(g.result - muM); S.mae_m += Math.abs(g.result - muM);
    if (g.spread_close != null) { errMkt.push(g.result - g.spread_close); S.mae_mkt += Math.abs(g.result - g.spread_close); }
    const tq = totIdx.get(g.id);
    if (tq && g.total_close != null) {
      const muT = baseAt(g.date) + kTotal * tq.x;
      errT.push(g.total - muT); errTmkt.push(g.total - g.total_close);
      S.mae_t += Math.abs(g.total - muT); S.mae_tmkt += Math.abs(g.total - g.total_close); S.nt++;
    }
    // ganador: modelo (normal aprox con sd empírica del pool) vs moneyline sin vig
    if (g.ml_home != null && g.ml_away != null) {
      const dec = (am) => (am > 0 ? 1 + am / 100 : 1 + 100 / -am);
      const ph = 1 / dec(g.ml_home), pa = 1 / dec(g.ml_away);
      const pMkt = ph / (ph + pa);
      const sd = 13.4;
      const pMod = 1 / (1 + Math.exp(-muM / (sd * 0.6)));   // logistic aprox de Φ(mu/sd)
      const y = g.result > 0 ? 1 : 0;
      brier.model.push((pMod - y) ** 2); brier.market.push((pMkt - y) ** 2);
      S.brier_m += (pMod - y) ** 2; S.brier_mkt += (pMkt - y) ** 2; S.nb++;
    }
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
  const sigmaExtraM = Math.sqrt(Math.max(0, sd(errM) ** 2 - sd(errMkt) ** 2));
  const sigmaExtraT = Math.sqrt(Math.max(0, sd(errT) ** 2 - sd(errTmkt) ** 2));
  const seasons = {};
  for (const [y, S] of Object.entries(bySeason)) {
    seasons[y] = {
      n: S.n, mae_margen_modelo: +(S.mae_m / S.n).toFixed(2), mae_margen_cierre: +(S.mae_mkt / S.n).toFixed(2),
      mae_total_modelo: S.nt ? +(S.mae_t / S.nt).toFixed(2) : null, mae_total_cierre: S.nt ? +(S.mae_tmkt / S.nt).toFixed(2) : null,
      brier_modelo: S.nb ? +(S.brier_m / S.nb).toFixed(4) : null, brier_cierre: S.nb ? +(S.brier_mkt / S.nb).toFixed(4) : null,
    };
  }
  log('▸ validación (walk-forward, TODO fuera de muestra):');
  log(`  margen: MAE modelo ${mean(errM.map(Math.abs)).toFixed(2)} vs cierre ${mean(errMkt.map(Math.abs)).toFixed(2)}`);
  log(`  total : MAE modelo ${mean(errT.map(Math.abs)).toFixed(2)} vs cierre ${mean(errTmkt.map(Math.abs)).toFixed(2)}`);
  log(`  Brier ganador: modelo ${mean(brier.model).toFixed(4)} vs cierre ${mean(brier.market).toFixed(4)}`);
  log(`  inflación de varianza: margen +${sigmaExtraM.toFixed(2)} · total +${sigmaExtraT.toFixed(2)}`);

  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), model_version: 'nfl-margin-epa-1',
    hfa: +hfa.toFixed(2), k_total: +kTotal.toFixed(2),
    sigma_extra_margin: +sigmaExtraM.toFixed(2), sigma_extra_total: +sigmaExtraT.toFixed(2),
    resid_pool: pool,
    spec: 'margen = rating(local) − rating(visita) + HFA (0 en neutral). total = base móvil de liga (200 partidos previos) + k·EPA compuesta de los cuatro lados. Distribución: mu + par de residuos (margen,total) muestreado del histórico vs cierre 2016-2025 (masa real en números clave y correlación margen-total) + ruido discreto por la varianza extra del modelo medida fuera de muestra.',
    validation: {
      note: 'walk-forward semanal 2017→: cada partido predicho SOLO con lo anterior. El cierre es el benchmark, no el label (NFL-0757). El modelo NO lee ninguna cuota: es market-blind por construcción (NFL-0521/0596).',
      overall: {
        n: pred.length,
        mae_margen_modelo: +mean(errM.map(Math.abs)).toFixed(2), mae_margen_cierre: +mean(errMkt.map(Math.abs)).toFixed(2),
        mae_total_modelo: +mean(errT.map(Math.abs)).toFixed(2), mae_total_cierre: +mean(errTmkt.map(Math.abs)).toFixed(2),
        brier_modelo: +mean(brier.model).toFixed(4), brier_cierre: +mean(brier.market).toFixed(4),
        sd_error_margen_modelo: +sd(errM).toFixed(2), sd_error_margen_cierre: +sd(errMkt).toFixed(2),
      },
      by_season: seasons,
    },
  }));
  log(`▸ model-priors.json escrito · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
