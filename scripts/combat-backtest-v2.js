#!/usr/bin/env node
/**
 * BACKTEST PAREADO R6 (12-ago, orden de Alexis: "haz el modelo más profundo y DEMUÉSTRALO con backtest").
 *
 * Compara, EN LA MISMA PASADA walk-forward (mismo Elo, mismas peleas out-of-sample, cero leakage):
 *   A) Elo puro
 *   B) modelo ACTUAL (FEATS + FEATS_FINE)
 *   C) modelo V2 (+ FEATS_X: interacciones de matchup grap/power/absorb/age5)
 *
 * A diferencia de scripts/combat-backtest.js (que pasa fine=null y deja inertes las features finas),
 * este harness ALIMENTA las stats finas por pelea (afstats-mma.json, el mismo join del server) — sin
 * eso ni B ni C pueden expresarse. Reporta accuracy/Brier/logloss/calibración, segmentos (era, banda,
 * subset fino, 5R) y bootstrap PAREADO del Brier (B vs C) con 1000 remuestreos.
 *
 * Uso: node scripts/combat-backtest-v2.js [--org=ufc|mma|both] [--warm=0.35]
 */
'use strict';
process.env.COMBAT_X_FEATURES = 'true'; // el harness SIEMPRE testea el set completo (en prod el flag decide)
const fs = require('fs');
const path = require('path');
const CE = require('../combat-engine/ratings');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const ORGS = args.org && args.org !== 'both' ? [args.org] : ['ufc', 'mma'];
const WARM = Number(args.warm || 0.35);
const FEAT_LR = 0.01;
const X_ALL = ['grap', 'power', 'absorb', 'age5', 'subth'];
const X_SET = new Set(X_ALL);
const BASE_FEATS = CE.ALL_FEATS.filter(k => !X_SET.has(k));
const VARIANTS = [
  { name: 'ACTUAL', feats: BASE_FEATS },
  { name: '+absorb', feats: BASE_FEATS.concat(['absorb']) },
  { name: '+abs+grap', feats: BASE_FEATS.concat(['absorb', 'grap']) },
  { name: '+abs+grap+subth', feats: BASE_FEATS.concat(['absorb', 'grap', 'subth']) },
  { name: 'FULL', feats: CE.ALL_FEATS },
];
const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const cm = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---- fine join (port del combatFineStats del server: match por nombre + día ±1, empate→null) ----
function fineJoin(fights) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combat', 'afstats-mma.json'), 'utf8')); } catch { return {}; }
  const full = {}, last = {}, dupLast = {};
  for (const f of fights) for (const side of ['f1', 'f2']) {
    const n = norm(f[side].name); if (!n) continue;
    if (!full[n]) full[n] = f[side].id;
    const ln = n.split(' ').pop();
    if (ln && ln.length >= 3) { if (last[ln] && last[ln] !== f[side].id) { dupLast[ln] = 1; delete last[ln]; } else if (!dupLast[ln]) last[ln] = f[side].id; }
  }
  const byName = (nm) => { const n = norm(nm); return full[n] || last[n.split(' ').pop()] || null; };
  const byDay = {};
  for (const f of fights) {
    const d0 = String(f.date).slice(0, 10);
    for (const dd of [-1, 0, 1]) (byDay[new Date(Date.parse(d0) + dd * 864e5).toISOString().slice(0, 10)] = byDay[new Date(Date.parse(d0) + dd * 864e5).toISOString().slice(0, 10)] || []).push(f);
  }
  const perFight = {}; let joined = 0;
  for (const af of (raw.fights || [])) {
    const rows = raw.stats[af.id]; if (!rows || !rows.length) continue;
    const h = byName((af.f1 || {}).name), a = byName((af.f2 || {}).name);
    if (!h || !a) continue;
    const ours = (byDay[af.date] || []).find(f => (f.f1.id === h && f.f2.id === a) || (f.f1.id === a && f.f2.id === h));
    if (!ours) continue;
    joined++;
    const minutes = ((ours.end_round || 3) - 1) * 5 + cm(ours.end_clock);
    const afToOur = {}; afToOur[(af.f1 || {}).id] = h; afToOur[(af.f2 || {}).id] = a;
    const pf = perFight[ours.comp_id] = {};
    for (const row of rows) {
      const ourId = afToOur[(row.fighter || {}).id]; if (!ourId) continue;
      const st = row.strikes || {}; const tot = st.total || {};
      pf[ourId] = {
        min: minutes, str: (tot.head || 0) + (tot.body || 0) + (tot.legs || 0),
        td_att: (st.takedowns || {}).attempt || 0, td: (st.takedowns || {}).landed || 0,
        ctrl: cm(st.control_time), kd: st.knockdowns || 0,
      };
    }
  }
  return { perFight, joined };
}

const acc0 = () => ({ n: 0, hit: 0, brier: 0, logl: 0, calP: Array(10).fill(0), calY: Array(10).fill(0), calN: Array(10).fill(0) });
function push(A, p, y) {
  A.n++; if ((p >= 0.5) === (y === 1)) A.hit++;
  A.brier += (p - y) ** 2;
  A.logl += -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));
  const b = Math.min(9, Math.floor(p * 10)); A.calP[b] += p; A.calY[b] += y; A.calN[b]++;
}
const calErr = (A) => { let e = 0, w = 0; for (let i = 0; i < 10; i++) { if (A.calN[i] < 30) continue; e += A.calN[i] * Math.abs(A.calP[i] / A.calN[i] - A.calY[i] / A.calN[i]); w += A.calN[i]; } return w ? e / w : null; };
const rep = (A) => A.n ? { n: A.n, acc: +(A.hit / A.n).toFixed(4), brier: +(A.brier / A.n).toFixed(4), skill: +((0.25 * A.n - A.brier) / A.n).toFixed(4), logloss: +(A.logl / A.n).toFixed(4), cal_err: calErr(A) != null ? +calErr(A).toFixed(4) : null } : null;

function run(org) {
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combat', `fights-${org}.json`), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combat', `fighters-${org}.json`), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const { perFight, joined } = fineJoin(fights);
  const warm = Math.floor(fights.length * WARM);
  console.log(`\n${'='.repeat(90)}\nORG ${org.toUpperCase()} — ${fights.length} peleas (${fights[0].date.slice(0, 10)} → ${fights[fights.length - 1].date.slice(0, 10)}) · fine join: ${joined} peleas · warm ${warm}`);

  // modelo compartido (Elo + agregados; sin SGD interno: PF=null) — la predicción de cada variante usa
  // EXACTAMENTE el mismo estado, así la comparación es pareada de verdad.
  const model = CE.newModel(null, {});
  const W = VARIANTS.map(() => CE.newW());
  const A = { elo: acc0() }; VARIANTS.forEach(v => { A[v.name] = acc0(); });
  const seg = {}; const addSeg = (k, variant, p, y) => { const K = k + '|' + variant; (seg[K] = seg[K] || acc0()); push(seg[K], p, y); };
  const pairs = []; // [brierB, brierV2] por pelea OOS (bootstrap pareado)
  const era = (d) => (d < '2013' ? 'a2012' : d < '2020' ? '2013-19' : '2020-26');

  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const ctx = { sched: f.rounds_sched || 3 };
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1; // model.w null → Elo puro con rust
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, ctx);
    const ps = VARIANTS.map((v, vi) => { let z = W[vi].elo * logit(pElo); for (const k of v.feats) z += W[vi][k] * fd[k]; return sigm(z); });
    if (i >= warm) {
      push(A.elo, pElo, y); VARIANTS.forEach((v, vi) => push(A[v.name], ps[vi], y));
      pairs.push(ps.map(p => (p - y) ** 2));
      const fineBoth = fd.slpm !== 0 || fd.td15 !== 0 || fd.ctrl !== 0;
      const tags = [`era:${era(f.date)}`, `sched:${(f.rounds_sched || 3) >= 5 ? '5R' : '3R'}`, fineBoth ? 'fino:sí' : 'fino:no'];
      if (fd.grap !== 0 || fd.subth !== 0) tags.push('interaccion:activa');
      for (const t of tags) { addSeg(t, 'base', ps[0], y); addSeg(t, 'v2', ps[ps.length - 1], y); }
    }
    VARIANTS.forEach((v, vi) => {
      const g = ps[vi] - y;
      W[vi].elo -= FEAT_LR * g * logit(pElo); for (const k of v.feats) W[vi][k] -= FEAT_LR * g * fd[k];
    });
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });

  console.log('\nGANADOR (out-of-sample):');
  console.log('  Elo puro        ', JSON.stringify(rep(A.elo)));
  VARIANTS.forEach(v => console.log(`  ${v.name.padEnd(16)}`, JSON.stringify(rep(A[v.name]))));
  // bootstrap pareado del Brier de cada variante vs ACTUAL (índice 0)
  const N = pairs.length;
  for (let vi = 1; vi < VARIANTS.length; vi++) {
    let better = 0;
    for (let b = 0; b < 1000; b++) {
      let d0 = 0, dv = 0;
      for (let j = 0; j < N; j++) { const r = pairs[(Math.random() * N) | 0]; d0 += r[0]; dv += r[vi]; }
      if (dv < d0) better++;
    }
    console.log(`  bootstrap: P(${VARIANTS[vi].name} mejor que ACTUAL) = ${(better / 1000).toFixed(3)}`);
  }
  console.log('\nSEGMENTOS (ACTUAL → V2):');
  const keys = [...new Set(Object.keys(seg).map(k => k.split('|')[0]))].sort();
  for (const k of keys) {
    const b = rep(seg[k + '|base']), v = rep(seg[k + '|v2']);
    if (!b || b.n < 50) continue;
    console.log(`  ${k.padEnd(20)} n=${String(b.n).padStart(5)}  acc ${b.acc}→${v.acc}  brier ${b.brier}→${v.brier}  skill ${b.skill}→${v.skill}`);
  }
  console.log('\nPESOS FULL:', JSON.stringify(Object.fromEntries(Object.entries(W[W.length - 1]).map(([k, v]) => [k, +v.toFixed(4)]))));
  return { org, elo: rep(A.elo), variants: VARIANTS.map(v => ({ name: v.name, ...rep(A[v.name]) })) };
}

const out = ORGS.map(run);
console.log('\n' + '='.repeat(90));
for (const o of out) for (const v of o.variants) console.log(`${o.org.toUpperCase()} ${v.name.padEnd(16)} brier ${v.brier} acc ${v.acc} skill ${v.skill}`);
