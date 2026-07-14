// clubs-engine/ratings.js — RATINGS ELO POR COMPETICIÓN (fase clubes, post-Mundial). PURO, sin I/O.
// El motor del Mundial corre sobre Elo de selecciones (db.elos); los clubes no tienen rating → este módulo
// lo construye desde el historial backfilleado (data/history/*.json de multi-comp-backfill). La conversión
// rating→probabilidades REUSA engine.matchProbs (misma matemática Elo→Poisson→Dixon-Coles→calibración λ)
// para que la fase de clubes herede el núcleo probado del Mundial; la calibración POR LIGA llega después
// con walk-forward + gates (NUNCA publicar picks de una liga sin gate — regla de la casa).
//
// Diseño del fit:
//  · Elo clásico secuencial (orden cronológico), base 1500.
//  · K adaptativo: ×2 durante los primeros 6 partidos de cada equipo (converge rápido desde el prior plano).
//  · Ventaja de local (hfa) AJUSTADA A LA LIGA: se resuelve iterativamente para que la media de resultado
//    esperado del local iguale a la observada (cada liga tiene su localía: MLS viaja, Sudamérica pesa).
//  · Empates cuentan 0.5 (el 1X2 fino lo pone matchProbs, no el fit).
'use strict';

const BASE_ELO = 1500;

function expectedHome(rh, ra, hfa) { return 1 / (1 + Math.pow(10, -((rh + hfa - ra) / 400))); }

// matches: [{utc, home:{id,name,goals}, away:{id,name,goals}}] — se ignoran filas sin marcador numérico.
// opts: { k (default 28), warmupGames (6), hfa0 (60), hfaIters (4) }
function fit(matches, opts = {}) {
  const K = opts.k != null ? opts.k : 28;
  const WARM = opts.warmupGames != null ? opts.warmupGames : 6;
  const rows = (matches || [])
    .filter(m => m && m.home && m.away && Number.isFinite(Number(m.home.goals)) && Number.isFinite(Number(m.away.goals)))
    .slice()
    .sort((a, b) => new Date(a.utc || 0) - new Date(b.utc || 0));

  function runPass(hfa) {
    const R = {}, games = {}, names = {};
    let expSum = 0, obsSum = 0;
    for (const m of rows) {
      const h = String(m.home.id), a = String(m.away.id);
      if (R[h] == null) { R[h] = BASE_ELO; games[h] = 0; }
      if (R[a] == null) { R[a] = BASE_ELO; games[a] = 0; }
      names[h] = m.home.name; names[a] = m.away.name;
      const exp = expectedHome(R[h], R[a], hfa);
      const hg = Number(m.home.goals), ag = Number(m.away.goals);
      const obs = hg > ag ? 1 : hg === ag ? 0.5 : 0;
      const kh = games[h] < WARM ? K * 2 : K;
      const ka = games[a] < WARM ? K * 2 : K;
      R[h] += kh * (obs - exp);
      R[a] += ka * ((1 - obs) - (1 - exp));
      games[h]++; games[a]++;
      expSum += exp; obsSum += obs;
    }
    return { R, games, names, expAvg: rows.length ? expSum / rows.length : 0.5, obsAvg: rows.length ? obsSum / rows.length : 0.5 };
  }

  // hfa iterativo: mover la ventaja de local hasta que lo esperado promedio iguale lo observado.
  let hfa = opts.hfa0 != null ? opts.hfa0 : 60;
  let pass = runPass(hfa);
  const iters = opts.hfaIters != null ? opts.hfaIters : 4;
  for (let i = 0; i < iters; i++) {
    const gap = pass.obsAvg - pass.expAvg;              // >0: la localía real pesa más de lo asumido
    if (Math.abs(gap) < 0.002) break;
    hfa = Math.max(0, Math.min(160, hfa + gap * 700));  // paso proporcional, acotado a un rango sano
    pass = runPass(hfa);
  }

  const ratings = {};
  for (const id of Object.keys(pass.R)) {
    ratings[id] = { elo: Math.round(pass.R[id]), name: pass.names[id], games: pass.games[id] };
  }
  return {
    ratings, hfa: Math.round(hfa), n_matches: rows.length,
    home_score_avg: +pass.obsAvg.toFixed(3), expected_home_avg: +pass.expAvg.toFixed(3),
  };
}

// BACKTEST WALK-FORWARD del 1X2 (gate por liga, patrón de la casa: nunca publicar sin gate).
// Por construcción el pase secuencial ES walk-forward: cada partido se predice con los ratings PRE-partido.
// opts.probs = fn(eloConLocalia, eloVisita) → {home,draw,away} (se inyecta engine.matchProbs para testear el
// modelo COMPLETO Elo→Poisson→DC→calibración, no solo el Elo). Se excluye el warmup de cada equipo (ratings
// aún fríos) — mismo espíritu que el LOO de props.
// Política clubs-gate-1 (inicial, revisable con más ligas): APPROVED si n>=120 y Brier(3-way)<=0.63 y
// |gap| de calibración del favorito <=6pp. Referencias: uniforme=0.667; mercado típico 0.58-0.60.
function backtest(matches, opts = {}) {
  const K = opts.k != null ? opts.k : 28;
  const WARM = opts.warmupGames != null ? opts.warmupGames : 6;
  const probsFn = opts.probs;
  if (typeof probsFn !== 'function') throw new Error('backtest: opts.probs requerido');
  const rows = (matches || [])
    .filter(m => m && m.home && m.away && Number.isFinite(Number(m.home.goals)) && Number.isFinite(Number(m.away.goals)))
    .slice()
    .sort((a, b) => new Date(a.utc || 0) - new Date(b.utc || 0));
  // hfa del fit completo (estable); el pase de predicción usa el mismo valor.
  const full = fit(rows, opts);
  const hfa = full.hfa;
  const R = {}, games = {};
  let n = 0, brier = 0, logloss = 0;
  const favBuckets = {}; // bucket de prob del favorito → {n, hit}
  let obsH = 0, obsD = 0, obsA = 0, prdH = 0, prdD = 0, prdA = 0;
  for (const m of rows) {
    const h = String(m.home.id), a = String(m.away.id);
    if (R[h] == null) { R[h] = BASE_ELO; games[h] = 0; }
    if (R[a] == null) { R[a] = BASE_ELO; games[a] = 0; }
    const warm = games[h] >= WARM && games[a] >= WARM;
    const hg = Number(m.home.goals), ag = Number(m.away.goals);
    const yh = hg > ag ? 1 : 0, yd = hg === ag ? 1 : 0, ya = hg < ag ? 1 : 0;
    if (warm) {
      const pr = probsFn(R[h] + hfa, R[a]);
      const eps = 1e-9;
      brier += Math.pow(pr.home - yh, 2) + Math.pow(pr.draw - yd, 2) + Math.pow(pr.away - ya, 2);
      logloss += -Math.log(Math.max(eps, yh ? pr.home : yd ? pr.draw : pr.away));
      const fav = Math.max(pr.home, pr.draw, pr.away);
      const hit = (fav === pr.home && yh) || (fav === pr.draw && yd) || (fav === pr.away && ya) ? 1 : 0;
      const bk = Math.min(80, Math.floor(fav * 100 / 10) * 10);
      (favBuckets[bk] = favBuckets[bk] || { n: 0, hit: 0, p: 0 }); favBuckets[bk].n++; favBuckets[bk].hit += hit; favBuckets[bk].p += fav;
      obsH += yh; obsD += yd; obsA += ya; prdH += pr.home; prdD += pr.draw; prdA += pr.away;
      n++;
    }
    // update Elo (igual que fit)
    const exp = expectedHome(R[h], R[a], hfa);
    const obs = hg > ag ? 1 : hg === ag ? 0.5 : 0;
    const kh = games[h] < WARM ? K * 2 : K;
    const ka = games[a] < WARM ? K * 2 : K;
    R[h] += kh * (obs - exp); R[a] += ka * ((1 - obs) - (1 - exp));
    games[h]++; games[a]++;
  }
  const calib = Object.keys(favBuckets).sort((x, y) => x - y).map(k => {
    const b = favBuckets[k];
    return { bucket: `${k}-${+k + 10}`, n: b.n, predicted: +(b.p / b.n).toFixed(3), observed: +(b.hit / b.n).toFixed(3) };
  });
  const calErr = calib.length
    ? +(calib.reduce((s, b) => s + Math.abs(b.predicted - b.observed) * b.n, 0) / Math.max(1, n)).toFixed(4)
    : null;
  const out = {
    n, hfa,
    brier: n ? +(brier / n).toFixed(4) : null,
    brier_uniform: 0.6667,
    logloss: n ? +(logloss / n).toFixed(4) : null,
    cal_err: calErr,
    dist: n ? { obs: [+(obsH / n).toFixed(3), +(obsD / n).toFixed(3), +(obsA / n).toFixed(3)], pred: [+(prdH / n).toFixed(3), +(prdD / n).toFixed(3), +(prdA / n).toFixed(3)] } : null,
    calibration: calib,
  };
  out.status = (n >= 120 && out.brier != null && out.brier <= 0.63 && (calErr == null || calErr <= 0.06)) ? 'approved' : 'shadow';
  out.policy = 'clubs-gate-1';
  return out;
}

// GATE DE GOLES por liga (F3.1, clubs-goals-gate-1). Backtest walk-forward del GOAL ENGINE (Elo→lambdas→
// goalModelOutput) midiendo CALIBRACIÓN en O/U 2.5 y BTTS. Es el prerequisito de la regla dura para las picks
// de GOLES (donde el modelo lidera): sin calibración demostrada por liga, una pick "de valor" no es +EV real.
// Mismo walk-forward de Elo que backtest() (K, warmup, hfa del fit). approved: n≥120 · cal_err O/U ≤0.05 ·
// el modelo no peor que el base-rate (predecir siempre el % de over de la liga). BTTS informativo.
function goalsBacktest(matches, opts = {}) {
  const K = opts.k != null ? opts.k : 28;
  const WARM = opts.warmupGames != null ? opts.warmupGames : 6;
  const { lambdas } = require('../engine');
  const dist = require('../goal-engine/distribution');
  const rows = (matches || [])
    .filter(m => m && m.home && m.away && Number.isFinite(Number(m.home.goals)) && Number.isFinite(Number(m.away.goals)))
    .slice().sort((a, b) => new Date(a.utc || 0) - new Date(b.utc || 0));
  const full = fit(rows, opts);
  const hfa = full.hfa;
  const R = {}, games = {};
  const mk = () => ({ n: 0, brier: 0, obs: 0, pred: 0, buckets: {} });
  const OU = mk(), BT = mk();
  const acc = (M, p, y) => {
    M.n++; M.brier += Math.pow(p - y, 2); M.obs += y; M.pred += p;
    const bk = Math.min(90, Math.floor(p * 100 / 10) * 10);
    const b = M.buckets[bk] = M.buckets[bk] || { n: 0, hit: 0, p: 0 };
    b.n++; b.hit += y; b.p += p;
  };
  for (const m of rows) {
    const h = String(m.home.id), a = String(m.away.id);
    if (R[h] == null) { R[h] = BASE_ELO; games[h] = 0; }
    if (R[a] == null) { R[a] = BASE_ELO; games[a] = 0; }
    const warm = games[h] >= WARM && games[a] >= WARM;
    const hg = Number(m.home.goals), ag = Number(m.away.goals);
    if (warm) {
      const l = lambdas(R[h] + hfa, R[a]);
      const g = dist.goalModelOutput(l[0], l[1]);
      const ou25 = (g.over_under || []).find(x => Math.abs((x.line != null ? x.line : x.l) - 2.5) < 0.01);
      const pOver = ou25 ? (ou25.over != null ? ou25.over : ou25.o) : null;
      const pBtts = g.btts ? g.btts.yes : null;
      if (pOver != null) acc(OU, pOver, (hg + ag) > 2.5 ? 1 : 0);
      if (pBtts != null) acc(BT, pBtts, (hg > 0 && ag > 0) ? 1 : 0);
    }
    const exp = expectedHome(R[h], R[a], hfa);
    const obs = hg > ag ? 1 : hg === ag ? 0.5 : 0;
    const kh = games[h] < WARM ? K * 2 : K, ka = games[a] < WARM ? K * 2 : K;
    R[h] += kh * (obs - exp); R[a] += ka * ((1 - obs) - (1 - exp));
    games[h]++; games[a]++;
  }
  const summarize = (M) => {
    if (!M.n) return null;
    const baseRate = M.obs / M.n;
    const baseBrier = baseRate * (1 - baseRate); // Brier del modelo base-rate (predecir siempre el %)
    const calib = Object.keys(M.buckets).sort((x, y) => x - y).map(k => { const b = M.buckets[k]; return { bucket: `${k}-${+k + 10}`, n: b.n, predicted: +(b.p / b.n).toFixed(3), observed: +(b.hit / b.n).toFixed(3) }; });
    const calErr = +(calib.reduce((s, b) => s + Math.abs(b.predicted - b.observed) * b.n, 0) / M.n).toFixed(4);
    const brier = +(M.brier / M.n).toFixed(4);
    return { n: M.n, brier, base_brier: +baseBrier.toFixed(4), base_rate: +baseRate.toFixed(3), pred_rate: +(M.pred / M.n).toFixed(3), cal_err: calErr, skill: +(baseBrier - brier).toFixed(4), calibration: calib };
  };
  const ou = summarize(OU), bt = summarize(BT);
  // approved para picks de GOLES exige SKILL REAL: el modelo debe GANARLE al base-rate (predecir siempre el %
  // de over de la liga), no solo estar calibrado. Sin skill positivo, una pick "de valor" en O/U es ruido y
  // sale -EV tras el margen. Umbral: n≥120 · cal_err ≤0.04 · skill ≥0.005 (edge no-ruido sobre el base-rate).
  const status = (ou && ou.n >= 120 && ou.cal_err <= 0.04 && ou.skill >= 0.005) ? 'approved' : 'shadow';
  return { n: ou ? ou.n : 0, over25: ou, btts: bt, status, policy: 'clubs-goals-gate-1' };
}

module.exports = { fit, backtest, goalsBacktest, expectedHome, BASE_ELO };
