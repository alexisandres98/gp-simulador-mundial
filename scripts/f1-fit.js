// scripts/f1-fit.js — VALIDACIÓN WALK-FORWARD DEL GEMELO DE F1 (blueprint 7.0, bloque 29)
//
// Doctrina intacta: constantes barridas SOLO en desarrollo (2014 → 2024), holdout intocable
// (2025 → hoy) evaluado UNA vez. El cambio reglamentario de 2022 CAE DENTRO del desarrollo — ahí se
// mide cuánto estado de coche debe sobrevivir a un cambio de reglas (regimeKeep), y esa constante
// medida es la que 2026 hereda (F-0049: transfer de priors elegido por rendimiento predictivo).
//
// Dos ESTADOS de información se validan por separado (bloque 05): PRE-QUALI (sin parrilla) y
// POS-QUALI (parrilla real). Baselines: uniforme, favorito-por-parrilla (histórico por casilla en dev).
//
// Métricas: log-loss del ganador (multiclase), Brier de podio por piloto, Spearman del orden final,
// Brier del abandono. USO: node scripts/f1-fit.js
'use strict';

const fs = require('fs');
const path = require('path');
const R = require(path.join(__dirname, '..', 'f1-engine', 'ratings.js'));
const S = require(path.join(__dirname, '..', 'f1-engine', 'sim.js'));

const BASE = path.join(__dirname, '..', 'data', 'f1');
const { races } = JSON.parse(fs.readFileSync(path.join(BASE, 'races.json'), 'utf8'));
const DEV_END = 2025; // temporada donde EMPIEZA el holdout

const done = races.filter((r) => Object.values(r.rows).some((x) => x.pos != null));
console.log(`[f1-fit] ${done.length} carreras completadas ${done[0].season}→${done.at(-1).season} R${done.at(-1).round}`);

function replay(C, evalFrom, evalTo, { collectSim = false, simCfg = null, useGrid = true } = {}) {
  const st = R.newState(C);
  const out = [];
  for (const race of done) {
    const inWin = race.season >= evalFrom && race.season < evalTo;
    if (inWin) {
      const entries = Object.values(race.rows);
      const field = R.fieldFor(st, entries, { useGrid });
      const winner = entries.find((r) => r.pos === 1);
      const rec = { key: race.season + '|' + race.round, season: race.season, winner: winner && winner.d, field, entries };
      if (collectSim && winner) {
        const res = S.simulateRace(field, { ...simCfg, seed: race.season * 100 + race.round });
        rec.sim = new Map(res.map((x) => [x.id, x]));
      }
      out.push(rec);
    }
    R.update(st, race);
  }
  return out;
}

function rankCorr(recs) { // Spearman medio entre perf esperada y posición final
  let sum = 0, n = 0;
  for (const rec of recs) {
    const fin = rec.entries.filter((r) => r.pos != null);
    if (fin.length < 8) continue;
    const perf = new Map(rec.field.map((f) => [f.id, f.perf]));
    const byPerf = fin.slice().sort((a, b) => (perf.get(b.d) || 0) - (perf.get(a.d) || 0));
    const rp = new Map(byPerf.map((r, i) => [r.d, i + 1]));
    let d2 = 0;
    for (const r of fin) { const dd = rp.get(r.d) - r.pos; d2 += dd * dd; }
    const m = fin.length;
    sum += 1 - (6 * d2) / (m * (m * m - 1)); n++;
  }
  return n ? sum / n : 0;
}

function simMetrics(recs) {
  let ll = 0, n = 0, podBr = 0, podN = 0, dnfBr = 0, dnfN = 0;
  for (const rec of recs) {
    if (!rec.sim || !rec.winner) continue;
    const w = rec.sim.get(rec.winner);
    ll += -Math.log(Math.max(1e-4, w ? w.p_win : 1e-4)); n++;
    for (const r of rec.entries) {
      const sm = rec.sim.get(r.d); if (!sm) continue;
      if (r.pos != null || /^R/.test(String(r.txt || '')) || r.pos == null) {
        const isPod = r.pos != null && r.pos <= 3 ? 1 : 0;
        podBr += (sm.p_podium - isPod) ** 2; podN++;
        const isDnf = r.pos == null && !/^(D|E|W|F)$/.test(String(r.txt || '')) ? 1 : 0;
        dnfBr += (sm.p_dnf - isDnf) ** 2; dnfN++;
      }
    }
  }
  const nField = 20;
  return { n, logloss: ll / n, skill_vs_uniform_pct: 100 * (1 - (ll / n) / Math.log(nField)),
    podium_brier: podBr / podN, dnf_brier: dnfBr / dnfN };
}

// ── 1) barrido de RATINGS en dev por correlación de orden (barato, sin sim) ─────────────────────────────
let bestR = null;
for (const hlCar of [6, 10, 16]) for (const hlDrv of [15, 30]) for (const wq of [0.35, 0.5]) for (const regimeKeep of [0.15, 0.35, 0.6]) {
  const C = { ...R.DEFAULTS, hlCar, hlDrv, wq, regimeKeep };
  const rc = rankCorr(replay(C, 2016, DEV_END));
  if (!bestR || rc > bestR.rc) bestR = { C, rc };
}
console.log(`[dev] ratings: hlCar=${bestR.C.hlCar} hlDrv=${bestR.C.hlDrv} wq=${bestR.C.wq} regimeKeep=${bestR.C.regimeKeep} → Spearman ${bestR.rc.toFixed(3)}`);

// baseline por parrilla (dev): P(ganar | casilla) histórica — TAMBIÉN es el segundo miembro del ensamble
const gridWins = new Array(31).fill(0), gridN = new Array(31).fill(0);
for (const race of done) {
  if (race.season >= DEV_END) continue;
  for (const r of Object.values(race.rows)) {
    if (!r.grid || r.grid > 30) continue;
    gridN[r.grid]++; if (r.pos === 1) gridWins[r.grid]++;
  }
}
const gridPrior = gridWins.map((w, i) => (gridN[i] ? (w + 0.5) / (gridN[i] + 12) : 0.01));

// ensamble ganador: sim^(1-u) × priorParrilla^u, renormalizado por carrera (sin cuotas: parrilla es dato)
function blendWin(rec, u) {
  const raw = rec.entries.map((r) => {
    const sm = rec.sim.get(r.d);
    const sp = Math.max(1e-4, sm ? sm.p_win : 1e-4);
    const gp = Math.max(1e-4, gridPrior[r.grid && r.grid <= 30 ? r.grid : 30] || 0.01);
    return { d: r.d, v: Math.pow(sp, 1 - u) * Math.pow(gp, u) };
  });
  const z = raw.reduce((s2, x) => s2 + x.v, 0);
  return new Map(raw.map((x) => [x.d, x.v / z]));
}
function blendLL(recs, u) {
  let s2 = 0, n = 0;
  for (const rec of recs) { if (!rec.sim || !rec.winner) continue; const p = blendWin(rec, u).get(rec.winner) || 1e-4; s2 += -Math.log(Math.max(1e-4, p)); n++; }
  return s2 / n;
}

// ── 2) barrido del SIMULADOR en dev (ganador multiclase), estado pos-quali ──────────────────────────────
let bestS = null;
for (const sigma of [0.4, 0.5, 0.62, 0.75]) for (const gridW of [0.7, 1.0, 1.4, 1.9]) {
  const recs = replay(bestR.C, 2016, DEV_END, { collectSim: true, simCfg: { sigma, gridW, sims: 1500 } });
  const m = simMetrics(recs);
  if (!bestS || m.logloss < bestS.m.logloss) bestS = { sigma, gridW, m };
}
console.log(`[dev] sim: sigma=${bestS.sigma} gridW=${bestS.gridW} → LL ganador ${bestS.m.logloss.toFixed(3)} (skill vs uniforme ${bestS.m.skill_vs_uniform_pct.toFixed(1)}%) · Brier podio ${bestS.m.podium_brier.toFixed(4)}`);
// 2b) ensamble con el prior de casilla — el peso se gana en dev
const recsDev = replay(bestR.C, 2016, DEV_END, { collectSim: true, simCfg: { sigma: bestS.sigma, gridW: bestS.gridW, sims: 1500 } });
let bestU = { u: 0, ll: blendLL(recsDev, 0) };
for (const u of [0.25, 0.4, 0.55, 0.7, 0.85]) { const ll = blendLL(recsDev, u); if (ll < bestU.ll) bestU = { u, ll }; }
console.log(`[dev] ensamble ganador: u=${bestU.u} → LL ${bestU.ll.toFixed(3)}`);

// ── 3) HOLDOUT — una sola evaluación, ambos estados de información ──────────────────────────────────────
const cfg = { ratings: bestR.C, sim: { sigma: bestS.sigma, gridW: bestS.gridW, sims: 4000 }, blendU: bestU.u };
for (const [label, useGrid] of [['POS-QUALI (parrilla real)', true], ['PRE-QUALI (sin parrilla)', false]]) {
  const recs = replay(cfg.ratings, DEV_END, 9999, { collectSim: true, simCfg: { ...cfg.sim, gridW: useGrid ? cfg.sim.gridW : 0 }, useGrid });
  const m = simMetrics(recs);
  if (useGrid) { // el ensamble aplica pos-quali (usa la casilla real)
    let s3 = 0, n3 = 0;
    for (const rec of recs) { if (!rec.sim || !rec.winner) continue; const p = blendWin(rec, bestU.u).get(rec.winner) || 1e-4; s3 += -Math.log(Math.max(1e-4, p)); n3++; }
    m.logloss_blend = +(s3 / n3).toFixed(3);
    m.skill_blend_pct = +((100 * (1 - (s3 / n3) / Math.log(20)))).toFixed(1);
  }
  const rc = rankCorr(recs);
  // baseline parrilla solo tiene sentido pos-quali
  let llGrid = null;
  if (useGrid) {
    let s = 0, n = 0;
    for (const rec of recs) {
      const w = rec.entries.find((r) => r.pos === 1); if (!w) continue;
      const z = rec.entries.reduce((a, r) => a + (gridPrior[r.grid || 30] || 0.01), 0);
      s += -Math.log(Math.max(1e-4, (gridPrior[w.grid || 30] || 0.01) / z)); n++;
    }
    llGrid = s / n;
  }
  console.log(`[HOLDOUT ${label}] n=${m.n} · LL ganador ${m.logloss.toFixed(3)}${m.logloss_blend != null ? ` · ENSAMBLE ${m.logloss_blend}` : ''} (${llGrid != null ? `baseline parrilla ${llGrid.toFixed(3)}` : 'sin parrilla'}) · Brier podio ${m.podium_brier.toFixed(4)} · Brier DNF ${m.dnf_brier.toFixed(4)} · Spearman ${rc.toFixed(3)}`);
  cfg['holdout_' + (useGrid ? 'postquali' : 'prequali')] = { ...m, spearman: +rc.toFixed(3), grid_baseline_ll: llGrid != null ? +llGrid.toFixed(3) : null };
}

cfg.model_version = 'f1-twin-1';
cfg.built_at = new Date().toISOString();
cfg.dev = { spearman: +bestR.rc.toFixed(3), winner_ll: +bestS.m.logloss.toFixed(3) };
cfg.grid_prior = gridPrior.map((x) => +x.toFixed(4));
fs.writeFileSync(path.join(BASE, 'model-priors.json'), JSON.stringify(cfg, null, 1));
console.log('[f1-fit] priors escritos en data/f1/model-priors.json');
