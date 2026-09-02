'use strict';
// pass.js — UNA pasada cronológica por circuito con las constantes CONGELADAS de data/tennis/model-priors.json
// (copiada de scripts/tennis-fit.js::runPass) que además calcula, sin mirar el futuro:
//   · H1  rasgos de fatiga/calendario por jugador ANTES del partido
//   · H2  variantes del compilado con saque/resto por superficie (encogidas hacia la global del jugador)
//   · H3  la distribución completa de juegos del compilado (matchDist, rejilla 0,004 en p de punto)
//   · H4  historial de retiros, edad y ranking por jugador
// Escribe preds-atp.json / preds-wta.json en este directorio. NO toca el repo.
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const C = require(REPO + '/tennis-engine/compiler.js');
const U = require('./util.js');
const OUT = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis-skeptic/rerun';

const { schema, rows } = JSON.parse(fs.readFileSync(REPO + '/data/tennis/matches.json', 'utf8'));
const players = JSON.parse(fs.readFileSync(REPO + '/data/tennis/players.json', 'utf8'));
const priors = JSON.parse(fs.readFileSync(REPO + '/data/tennis/model-priors.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync(REPO + '/data/tennis/meta.json', 'utf8'));
const F = {}; schema.forEach((k, i) => { F[k] = i; });
const TAIL_FROM = (meta.tail && meta.tail.from) || 99999999; // desde aquí la fecha es la REAL del partido (ESPN)
const COLLECT_FROM = 20180101;
const { logit, sig, clamp } = U;

const dayNum = (d) => Math.round(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100) / 864e5);
// pre-pasada: ronda mínima por (torneo, fecha) → tamaño de cuadro → desplazamiento estimado del día del partido
const minRound = new Map();
for (const r of rows) { const k = r[F.tid] + '|' + r[F.date]; minRound.set(k, Math.min(minRound.get(k) || 99, r[F.round])); }
// APROXIMACIÓN DECLARADA: Sackmann fecha todos los partidos de un torneo con el día de INICIO. El día real se
// estima por ronda y formato de cuadro (semana normal, 500 de 56, Masters de 12 días, Grand Slam de 14).
const OFF = {
  G: { 4: 1.5, 5: 3.5, 6: 5.5, 7: 7.5, 8: 9.5, 9: 11.5, 10: 13 },
  M12: { 4: 1, 5: 3, 6: 5, 7: 7, 8: 8.5, 9: 10, 10: 11.5 },
  W64: { 5: 0.5, 6: 1.5, 7: 3, 8: 4, 9: 5, 10: 6.5 },
  W32: { 6: 0.5, 7: 2.5, 8: 4, 9: 5, 10: 6 },
};
function estDay(r) {
  const d = dayNum(r[F.date]);
  if (r[F.date] >= TAIL_FROM) return d;
  const lvl = r[F.level], mr = minRound.get(r[F.tid] + '|' + r[F.date]), rd = r[F.round];
  let tab;
  if (lvl === 'G' && mr <= 4) tab = OFF.G; else if (mr <= 4) tab = OFF.M12; else if (mr === 5) tab = OFF.W64; else tab = OFF.W32;
  const key = Math.max(rd, Math.min(...Object.keys(tab).map(Number)));
  return d + (tab[key] != null ? tab[key] : tab[10]);
}

const SURF_VARIANTS = [ // H2
  { id: 'V0_prod', surfTour: false, K2: null },
  { id: 'V1_tourSpwSurf', surfTour: true, K2: null },
  { id: 'V2_devSurf_K5', surfTour: false, K2: 5 },
  { id: 'V3_devSurf_K15', surfTour: false, K2: 15 },
  { id: 'V4_devSurf_K40', surfTour: false, K2: 40 },
  { id: 'V5_both_K15', surfTour: true, K2: 15 },
];
const GRID = 0.004; // rejilla de matchDist (H3)

function runTour(tour) {
  const label = tour === 0 ? 'atp' : 'wta';
  const cst = priors.tours[label].constants;
  const cfg = { kScale: cst.kScale, surfW: cst.surfW, halfLife: cst.halfLife, shrinkK: cst.shrinkK, shock: cst.shock || 0, u: cst.ensembleU };
  const elo = new Map(), eloSurf = [new Map(), new Map(), new Map(), new Map()], nMatch = new Map();
  const srv = new Map(), ret = new Map();
  const srvS = [new Map(), new Map(), new Map()], retS = [new Map(), new Map(), new Map()]; // dura, arcilla, hierba (moqueta→dura)
  let tourSpw = cst.tourSpwStart, tourN = 50;
  const tourSpwS = [cst.tourSpwStart, cst.tourSpwStart, cst.tourSpwStart], tourNS = [50, 50, 50];
  const alpha = Math.log(2) / cfg.halfLife;
  const K = (n) => cfg.kScale * 250 / Math.pow(n + 5, 0.4);
  const g = (m, k, d) => (m.has(k) ? m.get(k) : d);
  const dev = (m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + cfg.shrinkK)) : 0; };
  const devS = (mS, mG, id, K2) => { const gd = dev(mG, id); const o = mS.get(id); return o ? (o.v + K2 * gd) / (o.w + K2) : gd; };
  const upd = (m, id, val) => { const o = m.get(id) || { v: 0, w: 0 }; o.v = o.v * (1 - alpha) + val; o.w = o.w * (1 - alpha) + 1; m.set(id, o); };
  // estado por jugador para fatiga/retiros
  const st = new Map(); // id → {lastDay, lastMin, lastSets, lastBo, lastRet(loser retired), days:[], nM, nRet, retDays:[]}
  const S = (id) => { let o = st.get(id); if (!o) { o = { lastDay: null, lastMin: null, lastSets: null, lastBo: null, lastRet: 0, days: [], nM: 0, nRet: 0, retDays: [] }; st.set(id, o); } return o; };
  let meanMin = { 3: 100, 5: 160 }, nMin = { 3: 20, 5: 20 }; // media móvil de minutos por formato para imputar

  const distCache = new Map(); const dists = []; // H3
  const distKey = (pa, pb, bo) => { const ka = Math.round(pa / GRID), kb = Math.round(pb / GRID); const k = `${ka},${kb},${bo}`; if (!distCache.has(k)) { const md = C.matchDist(ka * GRID, kb * GRID, bo, cfg.shock); distCache.set(k, dists.length); dists.push({ ...U.distFromPairs(md.totalGames), expGames: md.expGames, tbAny: md.tbAny }); } return distCache.get(k); };

  const preds = [];
  let t0 = Date.now();
  for (const r of rows) {
    if (r[F.tour] !== tour) continue;
    const date = r[F.date], surf = r[F.surface];
    // FORMATO: la cola ESPN trae best_of=5 en TODOS los partidos ATP (incl. 250s) y en 508 de la WTA (defecto
    // de la cola, medido 2-sep). El formato se toma del propio marcador: 3 sets ganados → bo5, 2 → bo3; con
    // retiro (marcador incompleto) se cae a la columna, y en la cola a la regla nivel G y ATP → 5.
    let bo = r[F.best_of] === 5 ? 5 : 3;
    if (!r[F.ret] && r[F.sets_w] === 3) bo = 5; else if (!r[F.ret] && r[F.sets_w] === 2) bo = 3;
    else if (date >= TAIL_FROM) bo = (r[F.tour] === 0 && r[F.level] === 'G') ? 5 : 3;
    const sIdx = surf === 3 ? 0 : surf; // moqueta → dura para stats; -1 = desconocida
    const A = r[F.wid], B = r[F.lid];
    const eA = g(elo, A, 1500), eB = g(elo, B, 1500);
    const sT = surf >= 0 ? eloSurf[surf] : null;
    const sA = sT ? g(sT, A, 1500) : 1500, sB = sT ? g(sT, B, 1500) : 1500;
    const pGen = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const pSurf = 1 / (1 + Math.pow(10, -(sA - sB) / 400));
    const pMix = sig((1 - cfg.surfW) * logit(pGen) + cfg.surfW * logit(clamp(pSurf, 0.01, 0.99)));
    const collect = date >= COLLECT_FROM;
    const day = estDay(r);

    if (collect) {
      const flip = !(A < B); // X = jugador de id menor
      const put = (p) => (flip ? 1 - p : p);
      const rec = { date, day, tid: r[F.tid], lvl: r[F.level], rd: r[F.round], surf, bo, ret: r[F.ret] ? 1 : 0, y: flip ? 0 : 1, min: r[F.minutes] > 0 ? r[F.minutes] : null,
        actGames: r[F.games_w] + r[F.games_l], sets: r[F.sets_w] + r[F.sets_l], mix: put(pMix), gen: put(pGen), comp: {}, expG: {}, tbAny: {} };
      // variantes del compilado (H2). V0 = producción
      for (const v of SURF_VARIANTS) {
        const tsp = v.surfTour && sIdx >= 0 ? tourSpwS[sIdx] : tourSpw;
        let dA_s, dB_s, dA_r, dB_r;
        if (v.K2 != null && sIdx >= 0) { dA_s = devS(srvS[sIdx], srv, A, v.K2); dB_s = devS(srvS[sIdx], srv, B, v.K2); dA_r = devS(retS[sIdx], ret, A, v.K2); dB_r = devS(retS[sIdx], ret, B, v.K2); }
        else { dA_s = dev(srv, A); dB_s = dev(srv, B); dA_r = dev(ret, A); dB_r = dev(ret, B); }
        const pa = clamp(tsp + dA_s - dB_r, 0.45, 0.8), pb = clamp(tsp + dB_s - dA_r, 0.45, 0.8);
        const c = C.matchLite(pa, pb, bo, cfg.shock);
        rec.comp[v.id] = put(c.pA); rec.expG[v.id] = c.expGames; rec.tbAny[v.id] = c.tbAny;
        if (v.id === 'V0_prod') { rec.pa = flip ? pb : pa; rec.pb = flip ? pa : pb; rec.dist = distKey(pa, pb, bo); }
      }
      // rasgos de fatiga y retiro por jugador, orientados X (id menor) / Y
      const feat = (id, rk) => {
        const s = S(id); const pl = players[tour + ':' + id] || {};
        const dob = pl.dob; const age = dob ? (dayNum(date) - dayNum(dob)) / 365.25 : null;
        const days = s.lastDay != null ? day - s.lastDay : null;
        const n7 = s.days.filter((d) => d < day && d >= day - 7).length;
        const n14 = s.days.filter((d) => d < day && d >= day - 14).length;
        return { days, minLast: s.lastMin, n7, n14, dist: s.lastSets != null && s.lastBo != null && s.lastSets >= s.lastBo ? 1 : 0, retLast: s.lastRet,
          nM: s.nM, nRet: s.nRet, ret365: s.retDays.filter((d) => d >= day - 365 && d < day).length, age, rank: rk > 0 ? rk : null, hasPrev: s.lastDay != null ? 1 : 0 };
      };
      const fA = feat(A, r[F.w_rank]), fB = feat(B, r[F.l_rank]);
      rec.fX = flip ? fB : fA; rec.fY = flip ? fA : fB;
      rec.meanMin = meanMin[bo];
      preds.push(rec);
    }

    // ── actualizaciones (siempre, retiros incluidos) ──
    const nA = g(nMatch, A, 0), nB = g(nMatch, B, 0);
    elo.set(A, eA + K(nA) * (1 - pGen)); elo.set(B, eB - K(nB) * (1 - pGen));
    if (sT) { sT.set(A, sA + K(nA) * (1 - pSurf)); sT.set(B, sB - K(nB) * (1 - pSurf)); }
    nMatch.set(A, nA + 1); nMatch.set(B, nB + 1);
    const wsv = r[F.w_svpt], lsv = r[F.l_svpt];
    if (wsv > 30 && lsv > 30) {
      const wSpw = (r[F.w_1stWon] + r[F.w_2ndWon]) / wsv;
      const lSpw = (r[F.l_1stWon] + r[F.l_2ndWon]) / lsv;
      tourSpw = (tourSpw * tourN + wSpw + lSpw) / (tourN + 2); tourN = Math.min(tourN + 2, 4000);
      upd(srv, A, wSpw - tourSpw + dev(ret, B)); upd(srv, B, lSpw - tourSpw + dev(ret, A));
      upd(ret, A, tourSpw + dev(srv, B) - lSpw); upd(ret, B, tourSpw + dev(srv, A) - wSpw);
      if (sIdx >= 0) { // superficie: misma mecánica, ajuste por rival con el dev de superficie (K2=15 para el residuo)
        tourSpwS[sIdx] = (tourSpwS[sIdx] * tourNS[sIdx] + wSpw + lSpw) / (tourNS[sIdx] + 2); tourNS[sIdx] = Math.min(tourNS[sIdx] + 2, 4000);
        const ts = tourSpwS[sIdx];
        const rB = devS(retS[sIdx], ret, B, 15), rA = devS(retS[sIdx], ret, A, 15), sBv = devS(srvS[sIdx], srv, B, 15), sAv = devS(srvS[sIdx], srv, A, 15);
        upd(srvS[sIdx], A, wSpw - ts + rB); upd(srvS[sIdx], B, lSpw - ts + rA);
        upd(retS[sIdx], A, ts + sBv - lSpw); upd(retS[sIdx], B, ts + sAv - wSpw);
      }
    }
    // estado de fatiga/retiros
    const mins = r[F.minutes] > 0 ? r[F.minutes] : null;
    if (mins) { meanMin[bo] = (meanMin[bo] * nMin[bo] + mins) / (nMin[bo] + 1); nMin[bo] = Math.min(nMin[bo] + 1, 2000); }
    const sets = r[F.sets_w] + r[F.sets_l];
    for (const [id, lost] of [[A, false], [B, true]]) {
      const s = S(id);
      s.lastDay = day; s.lastMin = mins; s.lastSets = r[F.ret] ? null : sets; s.lastBo = bo; s.lastRet = lost && r[F.ret] ? 1 : 0;
      s.days.push(day); if (s.days.length > 40) s.days.shift();
      s.nM++; if (lost && r[F.ret]) { s.nRet++; s.retDays.push(day); if (s.retDays.length > 30) s.retDays.shift(); }
    }
  }
  console.log(`[${label}] preds ${preds.length} · dists ${dists.length} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  fs.writeFileSync(path.join(OUT, `preds-${label}.json`), JSON.stringify({ tour, label, cfg, cst, variants: SURF_VARIANTS.map((v) => v.id), dists, preds }));
}

runTour(0); runTour(1);
console.log('[pass] escrito preds-atp.json / preds-wta.json en', OUT);
