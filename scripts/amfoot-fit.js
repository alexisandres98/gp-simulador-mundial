// scripts/amfoot-fit.js — AJUSTE Y VALIDACIÓN WALK-FORWARD DE NCAAF Y CFL (18-ago).
//
// La MISMA doctrina de nfl-fit.js aplicada a las dos ligas nuevas, con las diferencias que el deporte
// obliga y ninguna más:
//   · El rating es el MISMO solucionador iterativo de nfl-engine/data.ratings (margen opponent-adjusted,
//     recencia por medio-vida, arrastre entre temporadas encogido, shrinkage bayesiano a 0), pero con las
//     constantes AJUSTADAS POR LIGA con barrido walk-forward — heredar las de NFL sería fingir que un
//     favorito de −40 del college y una liga de 9 equipos se comportan como la NFL.
//   · College: el CAP de margen sube (aquí 60-0 existe y 28 tiraba información); los cruces FBS-FCS se
//     modelan con un rating fijo de división para el rival (ajustado aparte), no como un FBS malo.
//   · CFL: solo 9 equipos y ~85 partidos/temporada — el arrastre entre temporadas pesa más y se dice.
//   · El TOTAL no tiene EPA aquí (CFBD lo da para college pero gastaría el presupuesto de llamadas y CFL
//     no lo tiene de ninguna forma): total esperado = base móvil de liga + tendencia de ANOTACIÓN propia
//     de los dos equipos (media móvil de puntos a favor/en contra vs la media de liga), walk-forward.
//   · La validación es la de la casa: MAE del modelo vs MAE del CIERRE, Brier vs moneyline sin vig
//     (college; CFL no tiene ML histórico), pool de residuos vs cierre para el simulador, e inflación de
//     varianza medida — el mismo model-priors que consume el motor.
//
// USO
//   node scripts/amfoot-fit.js --league=ncaaf
//   node scripts/amfoot-fit.js --league=cfl
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'amfoot');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const LG = String(arg('league', 'ncaaf')).toLowerCase();
const CFG = {
  ncaaf: { file: 'ncaaf-games.json', cap: 45, halflife: 14, carry: 0.35, K: 5, firstSeason: 2016, fcsPrior: -24, sdWin: 21, baseWin: 300 },
  // baseWin corto en CFL: la liga cambió reglas en 2026 y anota +6 pts (53,0 → 59,1 medidos); una base
  // de 300 partidos arrastraría el régimen viejo media temporada
  cfl: { file: 'cfl-games.json', cap: 35, halflife: 18, carry: 0.55, K: 5, firstSeason: 2022, fcsPrior: 0, sdWin: 13.5, baseWin: 50 },
}[LG];
if (!CFG) { console.error('liga desconocida'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(path.join(DIR, CFG.file), 'utf8'));
const games = Object.values(raw.games)
  .filter((g) => g.date && g.home && g.away)
  .sort((a, b) => (a.date < b.date ? -1 : 1));
const done = games.filter((g) => g.hp != null && g.ap != null);
console.log(`[fit:${LG}] ${games.length} partidos, ${done.length} con resultado`);

// ── rating walk-forward (el solucionador de nfl-engine/data, parametrizado) ──────────────────────────────
function ratings(rows, { beforeDate, halflife, carry, K, cap, hfa }) {
  const use = rows.filter((g) => g.date < beforeDate);
  if (!use.length) return { teams: {}, n: 0 };
  const curSeason = Math.max(...use.map((g) => g.season));
  const perTeam = {}; const obs = [];
  for (const g of use) {
    const margin = Math.max(-cap, Math.min(cap, g.hp - g.ap));
    obs.push({ home: g.home, away: g.away, margin, season: g.season, neutral: !!g.neutral, fcs: !!g.fcs_opp });
    (perTeam[g.home] = perTeam[g.home] || []).push(obs.length - 1);
    (perTeam[g.away] = perTeam[g.away] || []).push(obs.length - 1);
  }
  for (const [team, idxs] of Object.entries(perTeam)) {
    for (let k = 0; k < idxs.length; k++) {
      const o = obs[idxs[k]];
      let w = Math.pow(0.5, (idxs.length - 1 - k) / halflife);
      if (o.season < curSeason) w *= Math.pow(carry, curSeason - o.season);
      obs[idxs[k]]['w_' + team] = w;
    }
  }
  const R = {}; for (const t of Object.keys(perTeam)) R[t] = 0;
  for (let it = 0; it < 30; it++) {
    const nxt = {};
    for (const [team, idxs] of Object.entries(perTeam)) {
      let sw = 0, sv = 0;
      for (const i of idxs) {
        const o = obs[i];
        const isHome = o.home === team;
        const opp = isHome ? o.away : o.home;
        const mAdj = (isHome ? o.margin : -o.margin) - (o.neutral ? 0 : (isHome ? hfa : -hfa));
        // rival de otra división (FBS vs FCS): rating fijo de división en vez del suyo (casi sin muestra)
        const oppR = o.fcs && !(perTeam[opp] && perTeam[opp].length >= 6) ? CFG.fcsPrior : (R[opp] || 0);
        const w = o['w_' + team];
        sw += w; sv += w * (mAdj + oppR);
      }
      nxt[team] = sv / (sw + K);
    }
    Object.assign(R, nxt);
  }
  const curN = {};
  for (const [team, idxs] of Object.entries(perTeam)) curN[team] = idxs.filter((i) => obs[i].season === curSeason).length;
  const out = {};
  for (const t of Object.keys(R)) out[t] = { pts: +R[t].toFixed(2), games_cur: curN[t] || 0 };
  return { teams: out, n: use.length, season: curSeason };
}

// tendencia de anotación para el TOTAL: (PF+PA del equipo, media móvil ponderada) − base de liga
function scoringTendency(rows, beforeDate, halflife) {
  const per = {};
  for (const g of rows) {
    if (g.date >= beforeDate || g.hp == null) continue;
    (per[g.home] = per[g.home] || []).push(g.hp + g.ap);
    (per[g.away] = per[g.away] || []).push(g.hp + g.ap);
  }
  const out = {};
  for (const [t, xs] of Object.entries(per)) {
    let sw = 0, sv = 0;
    for (let k = 0; k < xs.length; k++) { const w = Math.pow(0.5, (xs.length - 1 - k) / halflife); sw += w; sv += w * xs[k]; }
    out[t] = { avg: sv / sw, n: xs.length };
  }
  return out;
}
const baseAt = (date, win = CFG.baseWin || 300) => {
  const prev = done.filter((g) => g.date < date).slice(-win);
  return prev.length >= 30 ? prev.reduce((s, g) => s + g.hp + g.ap, 0) / prev.length : (LG === 'cfl' ? 50 : 55);
};

(async () => {
  const t0 = Date.now();
  // ── 0) convención del spread verificada (si hay cierres ya cosechados) ─────────────────────────────────
  const withLine = done.filter((g) => g.spread_close != null);
  if (withLine.length >= 30) {
    const cov = withLine.reduce((s, g) => s + ((g.hp - g.ap) - g.spread_close), 0) / withLine.length;
    if (Math.abs(cov) > 2.5) throw new Error(`convención de spread sospechosa: residuo medio ${cov.toFixed(2)}`);
    console.log(`[fit:${LG}] convención verificada: residuo medio result−spread = ${cov.toFixed(3)} (n=${withLine.length})`);
  } else console.log(`[fit:${LG}] aviso: solo ${withLine.length} cierres — la validación vs mercado será corta`);

  // ── 1) barrido de constantes del rating, walk-forward por FECHA (snapshots semanales) ──────────────────
  const evalRows = done.filter((g) => g.season >= CFG.firstSeason && !g.fcs_opp);
  const weeks = [...new Set(evalRows.map((g) => g.date.slice(0, 7) + '|' + (g.week || Math.ceil(new Date(g.date).getUTCDate() / 7))))];
  // snapshot por SEMANA-CALENDARIO real: agrupar por lunes anterior
  const monday = (d) => { const t = new Date(d + 'T00:00:00Z'); const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); };
  const snapDates = [...new Set(evalRows.map((g) => monday(g.date)))].sort();
  console.log(`[fit:${LG}] ${evalRows.length} partidos evaluables · ${snapDates.length} snapshots semanales`);

  function runPass({ halflife, carry, K, cap, hfa }) {
    const snaps = {};
    for (const sd of snapDates) snaps[sd] = ratings(done, { beforeDate: sd, halflife, carry, K, cap, hfa });
    const errs = []; const preds = [];
    for (const g of evalRows) {
      const R = snaps[monday(g.date)];
      const h = R.teams[g.home], a = R.teams[g.away];
      if (!h || !a) continue;
      const mu = h.pts - a.pts + (g.neutral ? 0 : hfa);
      errs.push((g.hp - g.ap) - mu);
      preds.push({ g, mu, gamesMin: Math.min(h.games_cur, a.games_cur) });
    }
    const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / errs.length;
    return { mae, preds, errs };
  }

  // HFA primero (con constantes por defecto), luego barrido de halflife/carry
  let hfa = LG === 'cfl' ? 2.2 : 2.5;
  {
    const p0 = runPass({ halflife: CFG.halflife, carry: CFG.carry, K: CFG.K, cap: CFG.cap, hfa: 0 });
    const homeErrs = p0.preds.filter((p) => !p.g.neutral).map((p) => (p.g.hp - p.g.ap) - p.mu);
    hfa = homeErrs.reduce((s, e) => s + e, 0) / homeErrs.length;
    console.log(`[fit:${LG}] HFA ajustado: ${hfa.toFixed(2)} pts`);
  }
  let best = null;
  for (const hl of LG === 'cfl' ? [12, 18, 26] : [10, 14, 20]) {
    for (const cy of LG === 'cfl' ? [0.45, 0.55, 0.65] : [0.25, 0.35, 0.5]) {
      const p = runPass({ halflife: hl, carry: cy, K: CFG.K, cap: CFG.cap, hfa });
      if (!best || p.mae < best.mae) best = { hl, cy, ...p };
    }
  }
  console.log(`[fit:${LG}] mejor: halflife=${best.hl} carry=${best.cy} → MAE margen ${best.mae.toFixed(2)}`);

  // ── 2) total: base móvil + tendencia de anotación de los dos equipos ───────────────────────────────────
  const totPreds = [];
  for (const p of best.preds) {
    const g = p.g;
    if (g.total_close == null && LG === 'ncaaf') { /* igual se predice: sirve para el MAE del modelo */ }
    const T = scoringTendency(done, monday(g.date), best.hl);
    const b = baseAt(g.date);
    const th = T[g.home], ta = T[g.away];
    if (!th || !ta || th.n < 6 || ta.n < 6) continue;
    // cada equipo aporta la mitad de su desviación (juega la mitad del partido en cada lado del balón)
    const mu = b + 0.5 * ((th.avg - b) + (ta.avg - b));
    totPreds.push({ g, mu, muM: p.mu });
  }
  // ── 3) validación vs cierre + pool de residuos ─────────────────────────────────────────────────────────
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
  const eM = [], eMkt = [], eT = [], eTmkt = [], pool = [];
  const brier = { model: [], market: [] };
  for (const q of totPreds) {
    const g = q.g;
    eM.push((g.hp - g.ap) - q.muM);
    eT.push((g.hp + g.ap) - q.mu);
    if (g.spread_close != null) {
      eMkt.push((g.hp - g.ap) - g.spread_close);
      if (g.total_close != null) {
        eTmkt.push((g.hp + g.ap) - g.total_close);
        pool.push([+((g.hp - g.ap) - g.spread_close).toFixed(1), +((g.hp + g.ap) - g.total_close).toFixed(1)]);
      }
    }
    if (g.ml_home != null && g.ml_away != null && g.hp !== g.ap) {
      const dec = (am) => (am > 0 ? 1 + am / 100 : 1 + 100 / -am);
      const ih = 1 / dec(g.ml_home), ia = 1 / dec(g.ml_away);
      const pMkt = ih / (ih + ia);
      const pMod = 1 / (1 + Math.exp(-q.muM / (CFG.sdWin * 0.6)));
      const y = g.hp > g.ap ? 1 : 0;
      brier.model.push((pMod - y) ** 2); brier.market.push((pMkt - y) ** 2);
    }
  }
  const sigmaExtraM = Math.sqrt(Math.max(0, sd(eM) ** 2 - (eMkt.length > 50 ? sd(eMkt) ** 2 : sd(eM) ** 2 * 0.85)));
  const sigmaExtraT = Math.sqrt(Math.max(0, sd(eT) ** 2 - (eTmkt.length > 50 ? sd(eTmkt) ** 2 : sd(eT) ** 2 * 0.85)));

  // ── 4) backtest de picks vs cierre (la prueba ácida, misma regla que NFL) ──────────────────────────────
  const backtest = { at_price: 1.91, rule: 'entrar AL CIERRE cuando |modelo − cierre| ≥ umbral; -110', families: {} };
  for (const thr of [2, 3, 4, 6]) {
    const F = { SPREAD: { n: 0, w: 0, p: 0, units: 0 }, TOTAL: { n: 0, w: 0, p: 0, units: 0 } };
    for (const q of totPreds) {
      const g = q.g;
      if (g.spread_close != null && Math.abs(q.muM - g.spread_close) >= thr) {
        const betHome = q.muM > g.spread_close;
        const cover = (g.hp - g.ap) - g.spread_close;
        F.SPREAD.n++;
        if (cover === 0) F.SPREAD.p++;
        else if ((betHome && cover > 0) || (!betHome && cover < 0)) { F.SPREAD.w++; F.SPREAD.units += 0.91; }
        else F.SPREAD.units -= 1;
      }
      if (g.total_close != null && Math.abs(q.mu - g.total_close) >= thr) {
        const betOver = q.mu > g.total_close;
        const dT = (g.hp + g.ap) - g.total_close;
        F.TOTAL.n++;
        if (dT === 0) F.TOTAL.p++;
        else if ((betOver && dT > 0) || (!betOver && dT < 0)) { F.TOTAL.w++; F.TOTAL.units += 0.91; }
        else F.TOTAL.units -= 1;
      }
    }
    for (const [fam, S] of Object.entries(F)) {
      const dec2 = S.n - S.p;
      (backtest.families[fam] = backtest.families[fam] || {})['umbral_' + thr + 'pts'] = {
        n: S.n, hit_pct: dec2 ? +(100 * S.w / dec2).toFixed(1) : null, roi_pct: S.n ? +(100 * S.units / S.n).toFixed(2) : null, breakeven_pct: 52.4,
      };
    }
  }

  console.log(`[fit:${LG}] margen: MAE modelo ${mean(eM.map(Math.abs)).toFixed(2)} vs cierre ${eMkt.length ? mean(eMkt.map(Math.abs)).toFixed(2) : '—'} (n cierre ${eMkt.length})`);
  console.log(`[fit:${LG}] total : MAE modelo ${mean(eT.map(Math.abs)).toFixed(2)} vs cierre ${eTmkt.length ? mean(eTmkt.map(Math.abs)).toFixed(2) : '—'}`);
  if (brier.model.length) console.log(`[fit:${LG}] Brier ganador: modelo ${mean(brier.model).toFixed(4)} vs cierre ${mean(brier.market).toFixed(4)} (n=${brier.model.length})`);
  console.log(`[fit:${LG}] backtest:`, JSON.stringify(backtest.families));

  fs.writeFileSync(path.join(DIR, `priors-${LG}.json`), JSON.stringify({
    at: new Date().toISOString(), model_version: `${LG}-margin-1`, league: LG,
    hfa: +hfa.toFixed(2), halflife: best.hl, carry: best.cy, K: CFG.K, cap: CFG.cap,
    base_win: CFG.baseWin || 300,
    fcs_prior: CFG.fcsPrior, sd_win: CFG.sdWin,
    sigma_margin: +sd(eM).toFixed(2), sigma_total: +sd(eT).toFixed(2),
    sigma_extra_margin: +sigmaExtraM.toFixed(2), sigma_extra_total: +sigmaExtraT.toFixed(2),
    resid_pool: pool,
    spec: `margen = rating(local) − rating(visita) + HFA (0 en neutral); rating = solucionador iterativo opponent-adjusted con recencia (halflife ${best.hl}) y arrastre entre temporadas ${best.cy}. total = base móvil de liga + ½·(tendencia de anotación de cada equipo). Distribución: normal bivariada con las sigmas medidas fuera de muestra${pool.length >= 150 ? ' + pool de residuos reales vs cierre' : ' (pool de residuos aún corto: normal pura, declarado)'}. Market-blind por construcción.`,
    validation: {
      note: `walk-forward semanal ${CFG.firstSeason}→: cada partido predicho SOLO con lo anterior. Cierre = benchmark, no label.`,
      overall: {
        n: totPreds.length, n_close: eMkt.length,
        mae_margen_modelo: +mean(eM.map(Math.abs)).toFixed(2), mae_margen_cierre: eMkt.length ? +mean(eMkt.map(Math.abs)).toFixed(2) : null,
        mae_total_modelo: +mean(eT.map(Math.abs)).toFixed(2), mae_total_cierre: eTmkt.length ? +mean(eTmkt.map(Math.abs)).toFixed(2) : null,
        brier_modelo: brier.model.length ? +mean(brier.model).toFixed(4) : null, brier_cierre: brier.market.length ? +mean(brier.market).toFixed(4) : null,
        sd_error_margen_modelo: +sd(eM).toFixed(2), sd_error_margen_cierre: eMkt.length ? +sd(eMkt).toFixed(2) : null,
      },
      backtest,
    },
  }));
  console.log(`[fit:${LG}] priors-${LG}.json escrito · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
