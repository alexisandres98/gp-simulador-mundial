// scripts/tennis-fit.js — VALIDACIÓN WALK-FORWARD DEL MODELO DE TENIS (blueprint 6.0, bloques 20+27)
//
// Doctrina de la casa: las constantes se barren SOLO en la ventana de desarrollo (2015 → 2024-12-31)
// y el holdout intocable (2025-01-01 → fin de la base) se evalúa UNA vez con todo congelado.
// ATP y WTA se ajustan POR SEPARADO (T-0010). Ningún precio de mercado entra al modelo: market-blind.
//
// Candidatos (bloque 20), del más simple al compilado:
//   B0 moneda · B1 ranking (logístico sobre log-ratio) · B2 Elo general (K estilo 538: s·250/(n+5)^0.4)
//   B3 mezcla Elo general+superficie (peso w en logit) · B4 saque/resto compilado punto→partido
//   B5 ensamble logit de B3+B4 (peso u)
// Los retiros actualizan ratings pero NO se puntúan (el desenlace es parcialmente exógeno, T-0290).
//
// Además: sobre el holdout se mide la CALIDAD DE FORMA del compilado — MAE de juegos totales y
// Brier de "hubo tiebreak" — porque esas son las familias que la sombra va a vigilar.
//
// USO: node scripts/tennis-fit.js            (lee data/tennis/matches.json, escribe model-priors.json)
'use strict';

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'tennis-engine', 'compiler.js'));

const BASE = path.join(__dirname, '..', 'data', 'tennis');
const { schema, rows } = JSON.parse(fs.readFileSync(path.join(BASE, 'matches.json'), 'utf8'));
const F = {}; schema.forEach((k, i) => { F[k] = i; });
const DEV_END = +(process.env.GP_TEN_DEV_END || 20250101); // exclusivo: desde aquí empieza el holdout intocable

const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function metrics(preds) { // preds: [{p, y}] con p = prob del jugador A, y = 1 si A ganó
  let ll = 0, br = 0, acc = 0;
  for (const { p, y } of preds) {
    const pc = clamp(p, 1e-6, 1 - 1e-6);
    ll += y ? -Math.log(pc) : -Math.log(1 - pc);
    br += (pc - y) * (pc - y);
    acc += (pc >= 0.5) === (y === 1) ? 1 : 0;
  }
  const n = preds.length;
  // AUC por ranking (empates a medias)
  const sorted = [...preds].sort((a, b) => a.p - b.p);
  let rank = 0, sumRankPos = 0, nPos = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i; while (j < sorted.length && sorted[j].p === sorted[i].p) j++;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) { if (sorted[k].y === 1) { sumRankPos += avg; nPos++; } }
    i = j;
  }
  const nNeg = n - nPos;
  const auc = nNeg && nPos ? (sumRankPos - nPos * (nPos + 1) / 2) / (nPos * nNeg) : 0.5;
  const llCoin = Math.log(2);
  return { n, logloss: ll / n, brier: br / n, acc: acc / n, auc, skill_pct: 100 * (1 - (ll / n) / llCoin) };
}

// una pasada cronológica que produce predicciones de TODOS los candidatos con una configuración dada
function runPass(tour, cfg, collectFrom, collectTo) {
  const elo = new Map(), eloSurf = [new Map(), new Map(), new Map(), new Map()], nMatch = new Map();
  // saque/resto: medias EW por jugador (dev del promedio del tour) — spw y rpw
  const srv = new Map(), ret = new Map(); // id → {v, w}
  let tourSpw = tour === 0 ? 0.63 : 0.57, tourN = 50; // arranque suave; se vuelve media móvil real
  const alpha = Math.log(2) / cfg.halfLife;
  const preds = [];
  const K = (n) => cfg.kScale * 250 / Math.pow(n + 5, 0.4);
  const g = (m, k, d) => (m.has(k) ? m.get(k) : d);

  for (const r of rows) {
    if (r[F.tour] !== tour) continue;
    const date = r[F.date], surf = r[F.surface], bo = r[F.best_of] === 5 ? 5 : 3;
    const A = r[F.wid], B = r[F.lid]; // A = ganador (la etiqueta se orienta por id para no filtrar)
    const eA = g(elo, A, 1500), eB = g(elo, B, 1500);
    const sT = surf >= 0 ? eloSurf[surf] : null;
    const sA = sT ? g(sT, A, 1500) : 1500, sB = sT ? g(sT, B, 1500) : 1500;
    const pGen = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const pSurf = 1 / (1 + Math.pow(10, -(sA - sB) / 400));
    const pMix = sig((1 - cfg.surfW) * logit(pGen) + cfg.surfW * logit(clamp(pSurf, 0.01, 0.99)));

    // compilado saque/resto: srvStr = cuánto saca por encima del tour; retStr = cuánto BAJA el spw rival
    const dev = (m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + cfg.shrinkK)) : 0; };
    const paSrv = clamp(tourSpw + dev(srv, A) - dev(ret, B), 0.45, 0.8);
    const pbSrv = clamp(tourSpw + dev(srv, B) - dev(ret, A), 0.45, 0.8);
    let comp = null;
    if (cfg.needComp && collectFrom <= date && date < collectTo) comp = C.matchLite(paSrv, pbSrv, bo, cfg.shock || 0);

    if (collectFrom <= date && date < collectTo && !r[F.ret]) {
      // orientación por id (determinista, sin fuga): el "jugador X" es el de id menor
      const flip = !(A < B);
      const put = (p) => (flip ? 1 - p : p);
      const rkA = r[F.w_rank], rkB = r[F.l_rank];
      const pRank = rkA > 0 && rkB > 0 ? sig(cfg.rankAlpha * Math.log(rkB / rkA)) : 0.5;
      preds.push({
        y: flip ? 0 : 1, date, bo,
        rank: put(pRank), gen: put(pGen), mix: put(pMix), comp: comp ? put(comp.pA) : 0.5,
        expGames: comp ? comp.expGames : 0, tbAny: comp ? comp.tbAny : 0,
        actGames: r[F.games_w] + r[F.games_l],
        actTb: / \d+-\d+\(/.test(' ' + r[F.score]) || /7-6|6-7/.test(r[F.score]) ? 1 : 0,
      });
    }

    // updates (siempre, retiros incluidos)
    const nA = g(nMatch, A, 0), nB = g(nMatch, B, 0);
    elo.set(A, eA + K(nA) * (1 - pGen)); elo.set(B, eB - K(nB) * (1 - pGen));
    if (sT) { sT.set(A, sA + K(nA) * (1 - pSurf)); sT.set(B, sB - K(nB) * (1 - pSurf)); }
    nMatch.set(A, nA + 1); nMatch.set(B, nB + 1);
    // stats de saque del partido (si hay datos de puntos)
    const upd = (m, id, val) => {
      const o = m.get(id) || { v: 0, w: 0 };
      o.v = o.v * (1 - alpha) + val; o.w = o.w * (1 - alpha) + 1;
      m.set(id, o);
    };
    const wsv = r[F.w_svpt], lsv = r[F.l_svpt];
    if (wsv > 30 && lsv > 30) {
      const wSpw = (r[F.w_1stWon] + r[F.w_2ndWon]) / wsv;
      const lSpw = (r[F.l_1stWon] + r[F.l_2ndWon]) / lsv;
      tourSpw = (tourSpw * tourN + wSpw + lSpw) / (tourN + 2); tourN = Math.min(tourN + 2, 4000);
      // ajuste por rival (T-0026/T-0186): la observación devuelve lo que el rival suprime/regala
      upd(srv, A, wSpw - tourSpw + dev(ret, B)); upd(srv, B, lSpw - tourSpw + dev(ret, A));
      upd(ret, A, tourSpw + dev(srv, B) - lSpw); upd(ret, B, tourSpw + dev(srv, A) - wSpw);
    }
  }
  return preds;
}

function evalSet(preds, key, uBlend) {
  const m = preds.map((p) => ({ p: uBlend != null ? sig((1 - uBlend) * logit(clamp(p.mix, 1e-4, 1 - 1e-4)) + uBlend * logit(clamp(p.comp, 1e-4, 1 - 1e-4))) : p[key], y: p.y }));
  return metrics(m);
}

const OUT = { model_version: 'tennis-sr-1', built_at: new Date().toISOString(), dev_end: DEV_END, tours: {} };

for (const [tour, label] of [[0, 'atp'], [1, 'wta']]) {
  console.log(`\n══════ ${label.toUpperCase()} ══════`);
  // 1) barrido Elo en dev
  let bestElo = null;
  for (const kScale of [0.6, 0.8, 1.0, 1.3]) for (const surfW of [0, 0.15, 0.3, 0.45]) {
    const preds = runPass(tour, { kScale, surfW, halfLife: 25, shrinkK: 15, rankAlpha: 0.28, needComp: false }, 20180101, DEV_END);
    const m = evalSet(preds, 'mix');
    if (!bestElo || m.logloss < bestElo.m.logloss) bestElo = { kScale, surfW, m };
  }
  console.log(`[dev] Elo: kScale=${bestElo.kScale} surfW=${bestElo.surfW} → LL ${bestElo.m.logloss.toFixed(4)} skill ${bestElo.m.skill_pct.toFixed(1)}%`);
  // 2) barrido saque/resto con Elo congelado
  let bestSR = null;
  for (const halfLife of [15, 30, 60]) for (const shrinkK of [8, 15, 30]) {
    const preds = runPass(tour, { kScale: bestElo.kScale, surfW: bestElo.surfW, halfLife, shrinkK, rankAlpha: 0.28, needComp: true }, 20180101, DEV_END);
    const m = evalSet(preds, 'comp');
    if (!bestSR || m.logloss < bestSR.m.logloss) bestSR = { halfLife, shrinkK, m, preds };
  }
  console.log(`[dev] compilado: halfLife=${bestSR.halfLife} shrinkK=${bestSR.shrinkK} → LL ${bestSR.m.logloss.toFixed(4)} skill ${bestSR.m.skill_pct.toFixed(1)}%`);
  // 2b) choque de ejecución: parámetro de FORMA — se elige por MAE de juegos en dev (no toca al ganador)
  const devMae = (preds) => { let n = 0, mae = 0, tb = 0; for (const p of preds) { if (p.actGames > 5) { mae += Math.abs(p.expGames - p.actGames); tb += (p.tbAny - p.actTb) ** 2; n++; } } return { mae: mae / n, tb: tb / n, n }; };
  let bestShock = null;
  for (const shock of [0, 0.04, 0.07, 0.09, 0.11]) {
    const preds = shock === bestSR.shock ? bestSR.preds : runPass(tour, { kScale: bestElo.kScale, surfW: bestElo.surfW, halfLife: bestSR.halfLife, shrinkK: bestSR.shrinkK, rankAlpha: 0.28, needComp: true, shock }, 20180101, DEV_END);
    const fm = devMae(preds);
    if (!bestShock || fm.mae < bestShock.fm.mae) bestShock = { shock, fm, preds };
  }
  // baseline ingenuo de forma en dev (media por formato) — el listón que la forma DEBE batir
  let m3 = 0, n3 = 0, m5 = 0, n5 = 0;
  for (const p of bestShock.preds) { if (p.actGames > 5) { if (p.bo === 5) { m5 += p.actGames; n5++; } else { m3 += p.actGames; n3++; } } }
  const mean3 = n3 ? m3 / n3 : 0, mean5 = n5 ? m5 / n5 : 0;
  let naive = 0, nN = 0;
  for (const p of bestShock.preds) { if (p.actGames > 5) { naive += Math.abs(p.actGames - (p.bo === 5 ? mean5 : mean3)); nN++; } }
  // 2c) calibración lineal de juegos en dev (mínimos cuadrados por formato) — corrige el sesgo del IID
  const calFit = (bo) => {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (const p of bestShock.preds) { if (p.actGames > 5 && p.bo === bo) { sx += p.expGames; sy += p.actGames; sxx += p.expGames ** 2; sxy += p.expGames * p.actGames; n++; } }
    if (n < 50) return [0, 1];
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    return [a, b];
  };
  const cal3 = calFit(3), cal5 = calFit(5);
  const calG = (p) => (p.bo === 5 ? cal5 : cal3)[0] + (p.bo === 5 ? cal5 : cal3)[1] * p.expGames;
  let cMae = 0, cN = 0;
  for (const p of bestShock.preds) { if (p.actGames > 5) { cMae += Math.abs(calG(p) - p.actGames); cN++; } }
  console.log(`[dev] forma: shock=${bestShock.shock} → MAE juegos ${bestShock.fm.mae.toFixed(2)} · calibrado ${(cMae / cN).toFixed(2)} (ingenuo ${(naive / nN).toFixed(2)}) · Brier TB ${bestShock.fm.tb.toFixed(4)}`);
  // 3) barrido del ensamble sobre las MISMAS predicciones dev
  let bestU = { u: 0, m: evalSet(bestSR.preds, null, 0) };
  for (const u of [0.15, 0.3, 0.45, 0.6]) {
    const m = evalSet(bestSR.preds, null, u);
    if (m.logloss < bestU.m.logloss) bestU = { u, m };
  }
  // barrido del alpha del baseline ranking (solo informativo)
  let bestRank = null;
  for (const rankAlpha of [0.2, 0.28, 0.38]) {
    const preds = runPass(tour, { kScale: bestElo.kScale, surfW: bestElo.surfW, halfLife: bestSR.halfLife, shrinkK: bestSR.shrinkK, rankAlpha, needComp: false }, 20180101, DEV_END);
    const m = evalSet(preds, 'rank');
    if (!bestRank || m.logloss < bestRank.m.logloss) bestRank = { rankAlpha, m };
  }
  console.log(`[dev] ensamble u=${bestU.u} → LL ${bestU.m.logloss.toFixed(4)} skill ${bestU.m.skill_pct.toFixed(1)}% · ranking α=${bestRank.rankAlpha} skill ${bestRank.m.skill_pct.toFixed(1)}%`);

  // 4) HOLDOUT — una sola evaluación con todo congelado
  const cfg = { kScale: bestElo.kScale, surfW: bestElo.surfW, halfLife: bestSR.halfLife, shrinkK: bestSR.shrinkK, rankAlpha: bestRank.rankAlpha, shock: bestShock.shock, naiveMean3: mean3, naiveMean5: mean5 };
  const ho = runPass(tour, { ...cfg, needComp: true }, DEV_END, 99999999);
  if (!ho.length) { console.log('[HOLDOUT] sin partidos en la ventana — tour omitido'); OUT.tours[label] = { constants: { ...cfg, ensembleU: bestU.u }, empty: true }; continue; }
  const H = {
    rank: evalSet(ho, 'rank'), gen: evalSet(ho, 'gen'), mix: evalSet(ho, 'mix'),
    comp: evalSet(ho, 'comp'), ens: evalSet(ho, null, bestU.u),
  };
  // calidad de forma del compilado (familias de la sombra)
  let gN = 0, gMae = 0, tbBr = 0, gNaive = 0;
  for (const p of ho) { if (p.actGames > 5) { gMae += Math.abs(calG(p) - p.actGames); tbBr += (p.tbAny - p.actTb) ** 2; gNaive += Math.abs(p.actGames - (p.bo === 5 ? mean5 : mean3)); gN++; } }
  console.log(`[HOLDOUT n=${H.ens.n}] ranking ${H.rank.skill_pct.toFixed(1)}% · Elo ${H.gen.skill_pct.toFixed(1)}% · Elo+superficie ${H.mix.skill_pct.toFixed(1)}% · compilado ${H.comp.skill_pct.toFixed(1)}% · ensamble ${H.ens.skill_pct.toFixed(1)}% (AUC ${H.ens.auc.toFixed(3)})`);
  console.log(`[HOLDOUT forma] MAE juegos ${(gMae / gN).toFixed(2)} vs ingenuo ${(gNaive / gN).toFixed(2)} · Brier TB ${(tbBr / gN).toFixed(4)} (n=${gN})`);

  OUT.tours[label] = {
    constants: { ...cfg, ensembleU: bestU.u, tourSpwStart: tour === 0 ? 0.63 : 0.57, gamesCal: { bo3: cal3, bo5: cal5 } },
    dev: { elo_mix: bestElo.m, compiled: bestSR.m, ensemble: bestU.m, form: bestShock.fm, form_naive: naive / nN },
    holdout: { ...H, games_mae: gMae / gN, games_mae_naive: gNaive / gN, tb_brier: tbBr / gN, form_n: gN },
  };
}

fs.writeFileSync(path.join(BASE, 'model-priors.json'), JSON.stringify(OUT, null, 1));
console.log('\n[fit] priors escritos en data/tennis/model-priors.json');
