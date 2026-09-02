#!/usr/bin/env node
/**
 * H2 — Backtest PAREADO walk-forward de mejoras de features sobre el modelo ACTUAL de combate.
 * Copia del harness scripts/combat-backtest-v2.js (mismo Elo compartido, misma pasada, mismas peleas OOS),
 * con features nuevas y bootstrap pareado del Brier (seed fija) + t pareado.
 *
 * Variantes:
 *   ACTUAL      = FEATS + FEATS_FINE con pesaje REAL (como el fit de producción: fitElo con weighins)
 *   a_agebins   = + tramos de edad (<25, 25-29, 30-33, 34-36, >36) antisimétricos
 *   a_agediv    = + tramos + edad×división (pesado / mujeres)
 *   b_layoff    = + inactividad >18m (indicador) + "vuelve tras KO" (última pelea perdida por KO)
 *   c_qstreak   = + racha ponderada por calidad del rival (residuo vs Elo y fuerza del rival)
 *   d_*         = variantes de la codificación del pesaje (sin / real / fija 2 lb / real + indicador ≥2)
 *   e_spreaddiv = + pendiente del Elo por división (equivale a SPREAD por división en la capa logística)
 *   ALL         = a_agediv + b + c + e (con pesaje real)
 *
 * Uso: node h2_features.js [--org=ufc|mma|both] [--warm=0.35] [--boot=2000]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const CE = require(REPO + '/combat-engine/ratings');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const ORGS = args.org && args.org !== 'both' ? [args.org] : ['ufc', 'mma'];
const WARM = Number(args.warm || 0.35);
const NBOOT = Number(args.boot || 2000);
const FEAT_LR = 0.01;
const BASE_FEATS = CE.ALL_FEATS.slice(); // sin COMBAT_X_FEATURES → FEATS + FEATS_FINE (13)
const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const cm = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const YR = 365.25 * 24 * 3600e3;

// RNG determinista (mulberry32)
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- fine join (port del combatFineStats del server) ----
function fineJoin(fights) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', 'afstats-mma.json'), 'utf8')); } catch { return { perFight: {}, joined: 0 }; }
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
    for (const dd of [-1, 0, 1]) { const k = new Date(Date.parse(d0) + dd * 864e5).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(f); }
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
      pf[ourId] = { min: minutes, str: (tot.head || 0) + (tot.body || 0) + (tot.legs || 0), td_att: (st.takedowns || {}).attempt || 0, td: (st.takedowns || {}).landed || 0, ctrl: cm(st.control_time), kd: st.knockdowns || 0 };
    }
  }
  return { perFight, joined };
}

// ---- pesajes (port de combatWeighIndex del server) → comp_id → {f1:{over}, f2:{over}} ----
function weighIndex(org, fights) {
  let W; try { W = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', `weighins-${org}.json`), 'utf8')); } catch { return { idx: {}, known: new Set() }; }
  const nm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byEvent = {};
  for (const f of fights) if (f.event) (byEvent[f.event] = byEvent[f.event] || []).push(f);
  const out = {}; const known = new Set();
  for (const [ev, rec] of Object.entries(W.events || {})) {
    if (rec.status === 'miss' || rec.status === 'clean') known.add(ev);
    if (rec.status !== 'miss' || !rec.rows) continue;
    const cands = [];
    for (const f of (byEvent[ev] || [])) for (const side of ['f1', 'f2']) cands.push({ c: f.comp_id, s: side, n: f[side].name });
    for (const row of rec.rows) {
      const q = new Set(nm(row.name).split(' ').filter(Boolean)); if (!q.size) continue;
      let best = null, bs = 0, tie = false;
      for (const c of cands) {
        const t = new Set(nm(c.n).split(' ')); let ov = 0; for (const x of q) if (t.has(x)) ov++;
        if (!ov) continue;
        const sc = ov * 10 + ov / Math.max(1, t.size + q.size - ov);
        if (sc > bs) { best = c; bs = sc; tie = false; } else if (sc === bs && best && best.c + best.s !== c.c + c.s) tie = true;
      }
      if (!best || tie) continue;
      const sl = out[best.c] = out[best.c] || {}; const pv = sl[best.s];
      sl[best.s] = { over: row.over != null ? row.over : (pv ? pv.over : null) };
    }
  }
  return { idx: out, known };
}

// ---- grupos de división ----
const divGroup = (w) => {
  const s = String(w || '');
  if (/^W /.test(s)) return 'women';
  if (/Heavyweight/.test(s) && !/Light/.test(s)) return 'hw';
  if (/Light Heavyweight|Middleweight/.test(s)) return 'lhw_mw';
  if (/Welterweight|Lightweight/.test(s)) return 'ww_lw';
  if (/Featherweight|Bantamweight|Flyweight/.test(s)) return 'fw_bw_flw';
  return 'other';
};
const AGE_BINS = [[0, 25], [25, 30], [30, 34], [34, 37], [37, 99]]; // <25, 25-29, 30-33, 34-36, >36
const ageBin = (a) => { for (let i = 0; i < AGE_BINS.length; i++) if (a >= AGE_BINS[i][0] && a < AGE_BINS[i][1]) return i; return null; };

// ---- features nuevas (antisimétricas) ----
// X = estado auxiliar propio: LASTKO[id] (última pelea perdida por KO/TKO), HQ[id] = últimas 3 {y, e, opp}
function newFeats(model, X, fighters, f, pElo) {
  const id1 = f.f1.id, id2 = f.f2.id;
  const a = (fighters && fighters[id1]) || {}, b = (fighters && fighters[id2]) || {};
  const ageOf = (p) => (p.dob && p.dob.slice(0, 4) >= '1940') ? (new Date(f.date) - new Date(p.dob)) / YR : null;
  const a1 = ageOf(a), a2 = ageOf(b);
  const out = {};
  // (a) tramos de edad
  const g = divGroup(f.weight);
  for (let i = 0; i < AGE_BINS.length; i++) out['ageb' + i] = 0;
  out.age_hw = 0; out.age_w = 0; out.age_light = 0;
  if (a1 != null && a2 != null) {
    const b1 = ageBin(a1), b2 = ageBin(a2);
    if (b1 != null) out['ageb' + b1] += 1; if (b2 != null) out['ageb' + b2] -= 1;
    const ageD = (a1 - a2) / 8;
    out.age_hw = (g === 'hw' || g === 'lhw_mw') ? ageD : 0;
    out.age_w = g === 'women' ? ageD : 0;
    out.age_light = g === 'fw_bw_flw' ? ageD : 0;
  }
  // (b) inactividad no lineal + vuelve tras KO
  const lay = (id) => { const l = model.LAST[id]; return l ? (new Date(f.date) - new Date(l)) / YR : null; };
  const l1 = lay(id1), l2 = lay(id2);
  const long = (l) => (l != null && l > 1.5) ? 1 : 0;
  out.lay18 = long(l1) - long(l2);
  const ko1 = X.LASTKO[id1] ? 1 : 0, ko2 = X.LASTKO[id2] ? 1 : 0;
  out.retko = ko1 - ko2;
  // vuelta rápida (<6 meses) tras KO — el caso que preocupa a la literatura médica/competitiva
  const quick = (id, l, ko) => (ko && l != null && l < 0.5) ? 1 : 0;
  out.retko_quick = quick(id1, l1, ko1) - quick(id2, l2, ko2);
  // (c) racha ponderada por calidad: residuo (y − E) de las últimas 3 y "victorias sobre rivales fuertes"
  const q = (id) => { const h = X.HQ[id] || []; if (!h.length) return { res: 0, sos: 0 }; let res = 0, sos = 0; for (const r of h) { res += (r.y - r.e); sos += (r.y - 0.5) * Math.max(-1.5, Math.min(1.5, (r.opp - 1500) / 200)); } return { res: res / h.length, sos: sos / h.length }; };
  const q1 = q(id1), q2 = q(id2);
  out.qres = q1.res - q2.res;
  out.qsos = q1.sos - q2.sos;
  // (e) pendiente del Elo por división (SPREAD efectivo por división)
  const lz = logit(pElo);
  out.elo_w = g === 'women' ? lz : 0;
  out.elo_hw = g === 'hw' ? lz : 0;
  out.elo_light = g === 'fw_bw_flw' ? lz : 0;
  out.elo_lhwmw = g === 'lhw_mw' ? lz : 0;
  return out;
}

// codificaciones del pesaje
const missReal = (over) => Math.min(+over || 0, 5) / 2;                 // ACTUAL (fit de prod)
const missFixed = (over) => (over != null && over > 0) ? 1 : 0;          // señal fija 2 lb (missW(2)=1) como en serving
const missBig = (over) => (over != null && over >= 2) ? 1 : 0;           // indicador ≥2 lb (dosis-respuesta del test #1)

const VARIANTS = [
  { name: 'ACTUAL', extra: [], wi: 'real' },
  { name: 'd_nowi', extra: [], wi: 'none' },
  { name: 'd_fixed2', extra: [], wi: 'fixed' },
  { name: 'd_real+big', extra: ['missbig'], wi: 'real' },
  { name: 'a_agebins', extra: ['ageb0', 'ageb1', 'ageb2', 'ageb3', 'ageb4'], wi: 'real' },
  { name: 'a_agediv', extra: ['ageb0', 'ageb1', 'ageb2', 'ageb3', 'ageb4', 'age_hw', 'age_w', 'age_light'], wi: 'real' },
  { name: 'b_layoff', extra: ['lay18', 'retko', 'retko_quick'], wi: 'real' },
  { name: 'c_qstreak', extra: ['qres', 'qsos'], wi: 'real' },
  { name: 'e_spreaddiv', extra: ['elo_w', 'elo_hw', 'elo_light', 'elo_lhwmw'], wi: 'real' },
  { name: 'ALL', extra: ['ageb0', 'ageb1', 'ageb2', 'ageb3', 'ageb4', 'age_hw', 'age_w', 'age_light', 'lay18', 'retko', 'retko_quick', 'qres', 'qsos', 'elo_w', 'elo_hw', 'elo_light', 'elo_lhwmw'], wi: 'real' },
];

const acc0 = () => ({ n: 0, hit: 0, brier: 0, logl: 0, calP: Array(10).fill(0), calY: Array(10).fill(0), calN: Array(10).fill(0) });
function push(A, p, y) {
  A.n++; if ((p >= 0.5) === (y === 1)) A.hit++;
  A.brier += (p - y) ** 2;
  A.logl += -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));
  const b = Math.min(9, Math.floor(p * 10)); A.calP[b] += p; A.calY[b] += y; A.calN[b]++;
}
const calErr = (A) => { let e = 0, w = 0; for (let i = 0; i < 10; i++) { if (A.calN[i] < 30) continue; e += A.calN[i] * Math.abs(A.calP[i] / A.calN[i] - A.calY[i] / A.calN[i]); w += A.calN[i]; } return w ? e / w : null; };
const rep = (A) => A.n ? { n: A.n, acc: +(A.hit / A.n).toFixed(4), brier: +(A.brier / A.n).toFixed(5), skill: +((0.25 * A.n - A.brier) / A.n).toFixed(5), logloss: +(A.logl / A.n).toFixed(5), cal_err: calErr(A) != null ? +calErr(A).toFixed(4) : null } : null;
const calTable = (A) => Array.from({ length: 10 }, (_, i) => A.calN[i] >= 30 ? { bucket: `${i * 10}-${i * 10 + 10}`, pred: +(A.calP[i] / A.calN[i]).toFixed(3), real: +(A.calY[i] / A.calN[i]).toFixed(3), n: A.calN[i] } : null).filter(Boolean);

function pairedStats(pairs, vi, filter) {
  // pairs[j] = [brier por variante]; compara vi contra 0 (ACTUAL)
  const rows = filter ? pairs.filter((r, j) => filter(r, j)) : pairs;
  const N = rows.length; if (!N) return null;
  const d = rows.map(r => r[vi] - r[0]);
  const mean = d.reduce((s, x) => s + x, 0) / N;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, N - 1));
  const se = sd / Math.sqrt(N);
  const R = rng(20260902 + vi);
  let better = 0;
  for (let b = 0; b < NBOOT; b++) { let s = 0; for (let j = 0; j < N; j++) s += d[(R() * N) | 0]; if (s < 0) better++; }
  return { n: N, dBrier: +mean.toFixed(6), se: +se.toFixed(6), t: se > 0 ? +(mean / se).toFixed(3) : null, pBoot: +(better / NBOOT).toFixed(3) };
}

function run(org) {
  const F = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', `fights-${org}.json`), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', `fighters-${org}.json`), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const { perFight, joined } = fineJoin(fights);
  const { idx: WI, known } = weighIndex(org, fights);
  const warm = Math.floor(fights.length * WARM);
  console.log(`\n${'='.repeat(100)}\nORG ${org.toUpperCase()} — ${fights.length} peleas (${fights[0].date.slice(0, 10)} → ${fights[fights.length - 1].date.slice(0, 10)}) · fine join ${joined} · pesajes casados en ${Object.keys(WI).length} peleas · warm ${warm}`);

  const model = CE.newModel(null, {}); // Elo compartido (sin SGD interno)
  const X = { LASTKO: {}, HQ: {} };
  const W = VARIANTS.map(v => { const w = { elo: 1 }; for (const k of BASE_FEATS.concat(v.extra)) w[k] = 0; return w; });
  const A = { elo: acc0() }; VARIANTS.forEach(v => { A[v.name] = acc0(); });
  const seg = {}; const addSeg = (k, vname, p, y) => { const K = k + '|' + vname; (seg[K] = seg[K] || acc0()); push(seg[K], p, y); };
  const pairs = []; const meta = [];
  const era = (d) => (d < '2013' ? 'a2012' : d < '2020' ? '2013-19' : '2020-26');
  const get = (id) => (model.R[id] == null ? 1500 : model.R[id]);

  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const ctx0 = { sched: f.rounds_sched || 3 };
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const wi = WI[f.comp_id];
    const o1 = wi && wi.f1 ? wi.f1.over : null, o2 = wi && wi.f2 ? wi.f2.over : null;
    // featDiff base sin pesaje; el misswt se recodifica por variante
    const fdBase = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, ctx0);
    const nf = newFeats(model, X, fighters, f, pElo);
    nf.missbig = missBig(o1) - missBig(o2);
    const missBy = { none: 0, real: missReal(o1) - missReal(o2), fixed: missFixed(o1) - missFixed(o2) };
    const fds = VARIANTS.map(v => { const fd = Object.assign({}, fdBase, nf); fd.misswt = missBy[v.wi]; return fd; });
    const ps = VARIANTS.map((v, vi) => { let z = W[vi].elo * logit(pElo); for (const k of BASE_FEATS.concat(v.extra)) z += W[vi][k] * fds[vi][k]; return sigm(z); });
    const bothN3 = (model.N[f.f1.id] || 0) >= 3 && (model.N[f.f2.id] || 0) >= 3;
    if (i >= warm) {
      push(A.elo, pElo, y); VARIANTS.forEach((v, vi) => push(A[v.name], ps[vi], y));
      pairs.push(ps.map(p => (p - y) ** 2));
      const tags = { era: era(f.date), n3: bothN3, div: divGroup(f.weight), wiKnown: known.has(f.event), miss: !!(o1 || o2), lay: (nf.lay18 !== 0), retko: (nf.retko !== 0), agebin: Object.keys(nf).some(k => /^ageb/.test(k) && nf[k] !== 0) };
      meta.push(tags);
      for (const t of ['era:' + tags.era, 'n3:' + tags.n3, 'div:' + tags.div]) VARIANTS.forEach((v, vi) => addSeg(t, v.name, ps[vi], y));
    }
    VARIANTS.forEach((v, vi) => { const g = ps[vi] - y; W[vi].elo -= FEAT_LR * g * logit(pElo); for (const k of BASE_FEATS.concat(v.extra)) W[vi][k] -= FEAT_LR * g * fds[vi][k]; });
    // estado auxiliar propio (antes del update Elo: Elo del rival PRE-pelea)
    const r1 = get(f.f1.id), r2 = get(f.f2.id);
    const e1 = CE.expected(r1, r2);
    (X.HQ[f.f1.id] = X.HQ[f.f1.id] || []).push({ y, e: e1, opp: r2 }); if (X.HQ[f.f1.id].length > 3) X.HQ[f.f1.id].shift();
    (X.HQ[f.f2.id] = X.HQ[f.f2.id] || []).push({ y: 1 - y, e: 1 - e1, opp: r1 }); if (X.HQ[f.f2.id].length > 3) X.HQ[f.f2.id].shift();
    const koFin = CE.isFinish(f.method) && /ko|tko/.test(((f.method || {}).name || '').toLowerCase());
    X.LASTKO[f.f1.id] = (!y && koFin); X.LASTKO[f.f2.id] = (y && koFin);
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });

  const out = { org, n_oos: pairs.length, elo: rep(A.elo), variants: {}, paired: {}, paired_2020: {}, paired_n3: {}, paired_subset: {}, segments: {}, weights: {}, cal_actual: calTable(A.ACTUAL) };
  console.log('\nGANADOR (out-of-sample):');
  console.log('  Elo puro          ', JSON.stringify(rep(A.elo)));
  VARIANTS.forEach((v, vi) => {
    out.variants[v.name] = rep(A[v.name]);
    out.weights[v.name] = Object.fromEntries(Object.entries(W[vi]).map(([k, x]) => [k, +x.toFixed(4)]));
    console.log(`  ${v.name.padEnd(18)}`, JSON.stringify(rep(A[v.name])));
  });
  console.log('\nPAREADO vs ACTUAL (ΔBrier variante − actual; negativo = mejor; pBoot = P(variante mejor)):');
  for (let vi = 1; vi < VARIANTS.length; vi++) {
    const all = pairedStats(pairs, vi), e20 = pairedStats(pairs, vi, (_, j) => meta[j].era === '2020-26'), n3 = pairedStats(pairs, vi, (_, j) => meta[j].n3);
    // subconjunto donde la feature nueva es NO nula (donde puede actuar)
    const v = VARIANTS[vi];
    const sub = v.name.startsWith('d_') ? pairedStats(pairs, vi, (_, j) => meta[j].miss) : v.name.startsWith('b_') ? pairedStats(pairs, vi, (_, j) => meta[j].lay || meta[j].retko) : v.name.startsWith('a_') ? pairedStats(pairs, vi, (_, j) => meta[j].agebin) : null;
    out.paired[v.name] = all; out.paired_2020[v.name] = e20; out.paired_n3[v.name] = n3; out.paired_subset[v.name] = sub;
    console.log(`  ${v.name.padEnd(14)} todo ${JSON.stringify(all)}\n${''.padEnd(17)}2020-26 ${JSON.stringify(e20)}\n${''.padEnd(17)}ambos≥3 ${JSON.stringify(n3)}${sub ? `\n${''.padEnd(17)}donde actúa ${JSON.stringify(sub)}` : ''}`);
  }
  // pairs filtro por índice: pairedStats usa filter(r, j) → adaptar
  console.log('\nSEGMENTOS (ACTUAL → ALL):');
  const keys = [...new Set(Object.keys(seg).map(k => k.split('|')[0]))].sort();
  for (const k of keys) {
    const b = rep(seg[k + '|ACTUAL']), v = rep(seg[k + '|ALL']), e = rep(seg[k + '|e_spreaddiv']), a = rep(seg[k + '|a_agediv']);
    if (!b || b.n < 50) continue;
    out.segments[k] = { ACTUAL: b, ALL: v, e_spreaddiv: e, a_agediv: a };
    console.log(`  ${k.padEnd(16)} n=${String(b.n).padStart(5)}  acc ${b.acc}→${v.acc}  brier ${b.brier}→${v.brier}  (e_spreaddiv ${e.brier}, a_agediv ${a.brier})`);
  }
  console.log('\nPESOS finales ALL:', JSON.stringify(out.weights.ALL));
  console.log('PESOS finales ACTUAL:', JSON.stringify(out.weights.ACTUAL));
  return out;
}

const res = ORGS.map(run);
const outFile = path.join(__dirname, `h2_results_${ORGS.join('_')}.json`);
fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
console.log('\nescrito', outFile);
