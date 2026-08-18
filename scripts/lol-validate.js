// scripts/lol-validate.js — ¿HAY RATING PROPIO DE LoL, O SOLO HAY DATOS? (18-ago, blueprint 3.0 Fase 3)
//
// La lección de CS2 y Dota, aplicada ANTES de enchufar nada: walk-forward estricto sobre la base propia,
// contra alternativas más simples, y el resultado ESCRITO — el w_model del motor sale de aquí, no de una
// corazonada. Requisitos del blueprint que este script cubre: LOL-0005 (point-in-time por construcción),
// rating con lado azul/rojo (Fase 3 · "blue/red side effects"), recencia por parche ("same-patch recency
// weighting"), calibración (Brier/AUC/ECE) y ventana de validación intacta (los últimos 120 días solo se
// tocan una vez, con las constantes ya elegidas en la ventana anterior).
//
// LOS PREDICTORES, todos sobre exactamente las mismas partidas:
//   moneda      0,5 siempre                                — el suelo
//   lado        la ventaja del lado azul, y nada más       — ¿basta con saber el lado?
//   elo         Elo global por equipo (sin lado)           — la fuerza, sola
//   gp          Elo + lado + recencia por parche           — el candidato a motor
// gp añade: (a) ventaja de lado azul ONLINE en puntos Elo; (b) el peso de cada partido decae con la
// DISTANCIA DE PARCHE además del tiempo — un Elo actualizado en 13.x pesa menos al predecir en 14.x
// (implementado como decaimiento extra del K tras cada cambio de parche mayor).
//
// USO
//   node scripts/lol-validate.js
//   node scripts/lol-validate.js --k=20 --min-n=10 --json=/tmp/lol-val.json
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'esports', 'lol');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const K0 = +arg('k', 0);          // 0 = barrer
const MIN_N = +arg('min-n', 10);
const OUT = arg('json', null);

const raw = (() => {
  try { return JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(DIR, 'games.json.gz'))).toString('utf8')); } catch { }
  return JSON.parse(fs.readFileSync(path.join(DIR, 'games.json'), 'utf8'));
})();
const all = Object.values(raw.rows)
  .filter((g) => g.t1 && g.t2 && g.win && g.at)
  .sort((a, b) => (a.at < b.at ? -1 : 1));
console.log(`[val:lol] ${all.length} partidas con resultado (${all[0] && all[0].at} → ${all[all.length - 1] && all[all.length - 1].at})`);

const majorPatch = (p) => { const m = String(p || '').match(/^(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : null; };

// ── métricas ─────────────────────────────────────────────────────────────────────────────────────────────
function auc(pairs) {
  const pos = pairs.filter((x) => x.y === 1).length, neg = pairs.length - pos;
  if (!pos || !neg) return null;
  const sorted = pairs.slice().sort((a, b) => a.p - b.p);
  let i = 0, rankSum = 0;
  while (i < sorted.length) {
    let j = i; while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (sorted[k].y === 1) rankSum += avgRank;
    i = j + 1;
  }
  return +((rankSum - pos * (pos + 1) / 2) / (pos * neg)).toFixed(4);
}
function ece(pairs, bins = 10) {
  let tot = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inb = pairs.filter((x) => x.p >= lo && (b === bins - 1 ? x.p <= hi : x.p < hi));
    if (!inb.length) continue;
    const pm = inb.reduce((a, x) => a + x.p, 0) / inb.length;
    const ym = inb.reduce((a, x) => a + x.y, 0) / inb.length;
    tot += (inb.length / pairs.length) * Math.abs(pm - ym);
  }
  return +tot.toFixed(4);
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function report(name, pairs) {
  if (!pairs.length) return { name, n: 0 };
  const brier = mean(pairs.map((x) => (x.p - x.y) ** 2));
  const hit = pairs.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.y).length / pairs.length;
  return { name, n: pairs.length, brier: +brier.toFixed(5), skill_pct: +(100 * (1 - brier / 0.25)).toFixed(2),
    auc: auc(pairs), ece: ece(pairs), hit_pct: +(100 * hit).toFixed(2) };
}

// ── una pasada walk-forward ──────────────────────────────────────────────────────────────────────────────
// `holdStart` marca la ventana intacta: el barrido de constantes SOLO mira las partidas anteriores; la
// ventana se evalúa una única vez al final con las constantes ganadoras (la doctrina de la casa).
function runPass({ K, patchDecay, sideStep }, { holdStart = null, evalHold = false } = {}) {
  const elo = new Map(); const games = new Map();
  let sideElo = 0, seenN = 0, seenB = 0, lastPatch = null;
  const P = { moneda: [], lado: [], elo: [], gp: [] };
  const get = (t) => (elo.has(t) ? elo.get(t) : 1500);
  for (const g of all) {
    const y = g.win === g.t1 ? 1 : 0;   // t1 = lado azul
    const inHold = holdStart && g.at >= holdStart;
    if (holdStart && !evalHold && inHold) break;      // en fase de barrido la ventana ni se recorre
    const ra = get(g.t1), rb = get(g.t2);
    const nA = games.get(g.t1) || 0, nB = games.get(g.t2) || 0;
    const pSide = seenN >= 100 ? seenB / seenN : 0.5;
    const pElo = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const pGp = 1 / (1 + Math.pow(10, (rb - ra - sideElo) / 400));
    const use = evalHold ? inHold : true;
    if (use && nA >= MIN_N && nB >= MIN_N) {
      P.moneda.push({ p: 0.5, y });
      P.lado.push({ p: pSide, y });
      P.elo.push({ p: pElo, y });
      P.gp.push({ p: pGp, y });
    }
    // actualización (siempre DESPUÉS de predecir)
    const mp = majorPatch(g.patch);
    let kEff = K;
    // recencia por parche: al cambiar el parche mayor, el conocimiento viejo pesa menos → K sube un
    // escalón transitorio (equivale a decaer lo aprendido en el parche anterior)
    if (mp && lastPatch && mp !== lastPatch) kEff = K * patchDecay;
    if (mp) lastPatch = mp;
    const upd = kEff * (y - pGp);
    elo.set(g.t1, ra + upd); elo.set(g.t2, rb - upd);
    games.set(g.t1, nA + 1); games.set(g.t2, nB + 1);
    sideElo += sideStep * (y - pGp);
    seenN++; seenB += y;
  }
  return { P, sideElo, blueWr: seenN ? seenB / seenN : null, teams: elo.size };
}

(async () => {
  // ventana intacta: últimos 120 días de la base
  const lastAt = all[all.length - 1].at;
  const holdStart = new Date(Date.parse(lastAt.replace(' ', 'T') + 'Z') - 120 * 864e5)
    .toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[val:lol] ventana intacta desde ${holdStart} (últimos 120 días)`);

  // ── barrido en la ventana de desarrollo ────────────────────────────────────────────────────────────────
  let best = null;
  const Ks = K0 ? [K0] : [12, 16, 20, 26, 32];
  for (const K of Ks) for (const pd of [1, 1.5, 2]) for (const ss of [1, 2]) {
    const r = runPass({ K, patchDecay: pd, sideStep: ss }, { holdStart, evalHold: false });
    const rep = report('gp', r.P.gp);
    if (!rep.n) continue;
    if (!best || rep.brier < best.rep.brier) best = { K, pd, ss, rep };
  }
  console.log(`[val:lol] mejor en desarrollo: K=${best.K} patchDecay=${best.pd} sideStep=${best.ss} → Brier ${best.rep.brier} (skill ${best.rep.skill_pct}%, n=${best.rep.n})`);

  // ── evaluación ÚNICA de la ventana intacta con las constantes ganadoras ────────────────────────────────
  const hold = runPass({ K: best.K, patchDecay: best.pd, sideStep: best.ss }, { holdStart, evalHold: true });
  const dev = runPass({ K: best.K, patchDecay: best.pd, sideStep: best.ss }, { holdStart, evalHold: false });
  const table = (tag, P) => {
    console.log(`\n${tag}:`);
    console.log('  predictor  n        Brier     skill%   AUC      ECE      acierto%');
    for (const k of ['moneda', 'lado', 'elo', 'gp']) {
      const r = report(k, P[k]);
      if (!r.n) { console.log(`  ${k.padEnd(9)} —`); continue; }
      console.log(`  ${k.padEnd(9)} ${String(r.n).padEnd(8)} ${String(r.brier).padEnd(9)} ${String(r.skill_pct).padEnd(8)} ${String(r.auc).padEnd(8)} ${String(r.ece).padEnd(8)} ${r.hit_pct}`);
    }
  };
  table(`DESARROLLO (hasta ${holdStart}, cualificadas ≥${MIN_N} partidas por equipo)`, dev.P);
  table('VENTANA INTACTA (últimos 120 días, evaluada UNA vez)', hold.P);
  console.log(`\n[val:lol] ventaja del lado azul: ${dev.sideElo.toFixed(1)} pts de Elo (tasa azul ${(100 * dev.blueWr).toFixed(2)}%) · ${dev.teams} equipos`);

  const devGp = report('gp', dev.P.gp), holdGp = report('gp', hold.P.gp), holdElo = report('elo', hold.P.elo), holdSide = report('lado', hold.P.lado);
  const out = {
    at: new Date().toISOString(), model_version: 'lol-elo-side-patch-1',
    source: 'base propia (Leaguepedia, research_attribution_ccbysa)',
    constants: { K: best.K, patch_decay: best.pd, side_step: best.ss, min_n: MIN_N },
    side_advantage_elo: +dev.sideElo.toFixed(1), blue_wr_pct: +(100 * dev.blueWr).toFixed(2),
    games: all.length, teams: dev.teams,
    validation: { development: { gp: devGp, elo: report('elo', dev.P.elo), lado: report('lado', dev.P.lado) },
      holdout_120d: { gp: holdGp, elo: holdElo, lado: holdSide },
      note: 'walk-forward estricto; constantes elegidas SOLO en desarrollo; la ventana de 120 días se evaluó una única vez. Brier skill NO es rentabilidad: sin histórico de cuotas propio de LoL, esto dice que el modelo predice, no que gane dinero — por eso la probabilidad publicada sigue anclada a mercado y el peso propio sube con esta evidencia.' },
  };
  fs.writeFileSync(path.join(DIR, 'priors.json'), JSON.stringify(out, null, 1));
  console.log(`[val:lol] priors.json escrito · skill intacta gp=${holdGp.skill_pct}% vs elo=${holdElo.skill_pct}% vs lado=${holdSide.skill_pct}%`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
})();
