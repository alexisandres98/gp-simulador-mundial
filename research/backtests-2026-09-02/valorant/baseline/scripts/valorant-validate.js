// scripts/valorant-validate.js — ¿HAY RATING PROPIO DE VALORANT, O SOLO HAY DATOS? (18-ago, blueprint 4.0)
//
// La doctrina de la casa aplicada a la base de series de vlr.gg: walk-forward estricto, constantes
// elegidas SOLO en la ventana de desarrollo, los últimos 120 días intactos y evaluados UNA vez.
// El nivel de resolución de esta V1 es la SERIE (V-0081 pide mapa/lado — eso llega cuando el detalle
// termine de cosecharse); aun así la pregunta operativa es la misma: ¿el Elo propio predice mejor que
// una moneda, y aporta algo el margen de la serie y el óxido por inactividad?
//
// PREDICTORES, todos sobre exactamente las mismas series:
//   moneda   0,5 siempre                                  — el suelo
//   elo      Elo clásico por serie ganada                 — la fuerza, sola
//   gp       Elo + margen (2-0 pesa más que 2-1) + óxido  — el candidato a motor
// gp añade: (a) actualización escalada por margen normalizado de la serie; (b) K transitorio mayor para
// un equipo que vuelve tras ≥60 días sin jugar (su rating está oxidado y debe re-aprenderse rápido).
//
// USO: node scripts/valorant-validate.js [--min-n=10] [--json=/tmp/val.json]
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_VAL_DIR || (fs.existsSync('/data') ? '/data/val-raw' : path.join(__dirname, '..', 'data', 'esports', 'valorant'));
const OUT = path.join(__dirname, '..', 'data', 'esports', 'valorant');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const MIN_N = +arg('min-n', 10);
const JOUT = arg('json', null);

const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'series.json'), 'utf8'));
const all = Object.values(raw.rows)
  .filter((s) => s.t1 && s.t2 && s.at && s.s1 != null && s.s2 != null && (s.s1 + s.s2) > 0 && s.s1 !== s.s2)
  .sort((a, b) => (a.at + (a.time || '') < b.at + (b.time || '') ? -1 : 1));
console.log(`[val:valorant] ${all.length} series con resultado (${all[0] && all[0].at} → ${all[all.length - 1] && all[all.length - 1].at})`);

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

function runPass({ K, marginBoost, idleBoost }, { holdStart = null, evalHold = false } = {}) {
  const elo = new Map(); const games = new Map(); const lastPlayed = new Map();
  const P = { moneda: [], elo: [], gp: [] };
  const get = (m, t, d) => (m.has(t) ? m.get(t) : d);
  for (const s of all) {
    const y = s.s1 > s.s2 ? 1 : 0;
    const inHold = holdStart && s.at >= holdStart;
    if (holdStart && !evalHold && inHold) break;
    const ra = get(elo, s.t1, 1500), rb = get(elo, s.t2, 1500);
    const nA = get(games, s.t1, 0), nB = get(games, s.t2, 0);
    const pElo = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const use = evalHold ? inHold : true;
    if (use && nA >= MIN_N && nB >= MIN_N) {
      P.moneda.push({ p: 0.5, y });
      P.elo.push({ p: pElo, y });
      P.gp.push({ p: pElo, y });   // gp difiere en la ACTUALIZACIÓN, no en la forma de predecir
    }
    // actualización (después de predecir)
    const t = Date.parse(s.at + 'T12:00:00Z');
    const idle = (team) => { const lp = lastPlayed.get(team); return lp != null && (t - lp) > 60 * 864e5; };
    const margin = (Math.abs(s.s1 - s.s2)) / Math.max(1, s.s1 + s.s2);   // 2-0 → 1,0 · 2-1 → 0,33
    const kA = K * (idle(s.t1) ? idleBoost : 1), kB = K * (idle(s.t2) ? idleBoost : 1);
    const scale = 1 + (marginBoost - 1) * margin;
    const updA = kA * scale * (y - pElo), updB = kB * scale * (y - pElo);
    elo.set(s.t1, ra + updA); elo.set(s.t2, rb - updB);
    games.set(s.t1, nA + 1); games.set(s.t2, nB + 1);
    lastPlayed.set(s.t1, t); lastPlayed.set(s.t2, t);
  }
  return { P, teams: elo.size };
}

// pasada aparte para elo PURO (sin margen ni óxido) con el mismo K — comparación limpia
function runPlain(K, opts) { return runPass({ K, marginBoost: 1, idleBoost: 1 }, opts); }

(async () => {
  const lastAt = all[all.length - 1].at;
  const holdStart = new Date(Date.parse(lastAt + 'T12:00:00Z') - 120 * 864e5).toISOString().slice(0, 10);
  console.log(`[val:valorant] ventana intacta desde ${holdStart} (últimos 120 días)`);

  let best = null;
  for (const K of [12, 16, 20, 26, 32]) for (const mb of [1, 1.35, 1.7]) for (const ib of [1, 1.5, 2]) {
    const r = runPass({ K, marginBoost: mb, idleBoost: ib }, { holdStart, evalHold: false });
    const rep = report('gp', r.P.gp);
    if (!rep.n) continue;
    if (!best || rep.brier < best.rep.brier) best = { K, mb, ib, rep };
  }
  console.log(`[val:valorant] mejor en desarrollo: K=${best.K} marginBoost=${best.mb} idleBoost=${best.ib} → Brier ${best.rep.brier} (skill ${best.rep.skill_pct}%, n=${best.rep.n})`);

  const hold = runPass({ K: best.K, marginBoost: best.mb, idleBoost: best.ib }, { holdStart, evalHold: true });
  const dev = runPass({ K: best.K, marginBoost: best.mb, idleBoost: best.ib }, { holdStart, evalHold: false });
  const holdPlain = runPlain(best.K, { holdStart, evalHold: true });
  const table = (tag, P, plainP) => {
    console.log(`\n${tag}:`);
    console.log('  predictor  n        Brier     skill%   AUC      ECE      acierto%');
    const rows = [['moneda', P.moneda], ['elo', plainP ? plainP.elo : P.elo], ['gp', P.gp]];
    for (const [k, pairs] of rows) {
      const r = report(k, pairs);
      if (!r.n) { console.log(`  ${k.padEnd(9)} —`); continue; }
      console.log(`  ${k.padEnd(9)} ${String(r.n).padEnd(8)} ${String(r.brier).padEnd(9)} ${String(r.skill_pct).padEnd(8)} ${String(r.auc).padEnd(8)} ${String(r.ece).padEnd(8)} ${r.hit_pct}`);
    }
  };
  table(`DESARROLLO (hasta ${holdStart}, cualificadas ≥${MIN_N} series por equipo)`, dev.P, null);
  table('VENTANA INTACTA (últimos 120 días, evaluada UNA vez)', hold.P, holdPlain.P);
  console.log(`\n[val:valorant] ${dev.teams} equipos en la base`);

  const holdGp = report('gp', hold.P.gp), holdElo = report('elo', holdPlain.P.elo), devGp = report('gp', dev.P.gp);
  const out = {
    at: new Date().toISOString(), model_version: 'val-elo-series-1',
    source: 'base propia (vlr.gg, research_only — RIGHTS.md)',
    constants: { K: best.K, margin_boost: best.mb, idle_boost: best.ib, min_n: MIN_N, idle_days: 60 },
    series: all.length, teams: dev.teams,
    validation: { development: { gp: devGp }, holdout_120d: { gp: holdGp, elo_plain: holdElo },
      note: 'walk-forward estricto a nivel de SERIE; constantes elegidas SOLO en desarrollo; la ventana de 120 días se evaluó una única vez. Brier skill NO es rentabilidad: la probabilidad publicada sigue anclada a mercado y el peso propio sube con esta evidencia. La resolución por mapa/lado llega cuando el detalle termine de cosecharse.' },
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'priors.json'), JSON.stringify(out, null, 1));
  console.log(`[val:valorant] priors.json escrito · skill intacta gp=${holdGp.skill_pct}% vs elo=${holdElo.skill_pct}%`);
  if (JOUT) fs.writeFileSync(JOUT, JSON.stringify(out, null, 1));
})();
