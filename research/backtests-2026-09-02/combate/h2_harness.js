#!/usr/bin/env node
/**
 * H2 — harness walk-forward de mejoras al modelo de combate (copia del esquema de scripts/combat-backtest-v2.js).
 * MISMO Elo compartido (CE.newModel(null) + CE.eloStep), mismas peleas OOS (warm 35%), SGD online por variante
 * (predice ANTES de aprender = walk-forward nativo). Cada variante = ACTUAL (8 feats + 5 finas) + un bloque nuevo.
 * Métrica: Brier OOS; bootstrap PAREADO (2000 remuestreos, RNG con semilla) de ΔBrier vs ACTUAL + IC 95 % + P(mejor).
 * Uso: node h2_harness.js [--org=ufc|mma|both] [--warm=0.35] [--boots=2000] [--lr=0.01]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const CE = require(path.join(REPO, 'combat-engine/ratings'));
const DATA = path.join(REPO, 'data', 'combat');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const ORGS = args.org && args.org !== 'both' ? [args.org] : ['ufc', 'mma'];
const WARM = Number(args.warm || 0.35);
const BOOTS = Number(args.boots || 2000);
const FEAT_LR = Number(args.lr || 0.01);
const OUT = path.join(__dirname, `h2_result_${ORGS.join('_')}.json`);

const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const cm = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const MONTH = 30.44 * 864e5, YEAR = 365.25 * 864e5;
const isKO = (m) => /ko|tko/.test(((m || {}).name || '').toLowerCase()) && !/decision/.test(((m || {}).name || '').toLowerCase());

// RNG con semilla (mulberry32) para bootstrap reproducible
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- fine join (port literal del harness v2) ----
function fineJoin(fights) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(DATA, 'afstats-mma.json'), 'utf8')); } catch { return { perFight: {}, joined: 0 }; }
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

// ---- pesajes reales (port de combatWeighIndex del server): comp_id → { f1:{over,miss}, f2:{over,miss} } ----
function weighIndex(org, fights) {
  let W; try { W = JSON.parse(fs.readFileSync(path.join(DATA, `weighins-${org}.json`), 'utf8')); } catch { return { idx: {}, ok: 0, known: 0 }; }
  const nm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byEvent = {};
  for (const f of fights) if (f.event) (byEvent[f.event] = byEvent[f.event] || []).push(f);
  const idx = {}; let ok = 0, known = 0;
  for (const [ev, rec] of Object.entries(W.events || {})) {
    if (rec.status !== 'miss' || !rec.rows) continue;
    const cands = [];
    for (const f of (byEvent[ev] || [])) for (const side of ['f1', 'f2']) cands.push({ c: f.comp_id, s: side, n: f[side].name });
    for (const row of rec.rows) {
      const q = new Set(nm(row.name).split(' ').filter(Boolean)); if (!q.size) continue;
      let best = null, bs = 0, tie = false;
      for (const c of cands) {
        const t = new Set(nm(c.n).split(' '));
        let ov = 0; for (const x of q) if (t.has(x)) ov++;
        if (!ov) continue;
        const sc = ov * 10 + ov / Math.max(1, t.size + q.size - ov);
        if (sc > bs) { best = c; bs = sc; tie = false; } else if (sc === bs && best && best.c + best.s !== c.c + c.s) tie = true;
      }
      if (!best || tie) continue;
      const sl = idx[best.c] = idx[best.c] || {};
      sl[best.s] = { over: row.over != null ? row.over : null, miss: 1 };
      ok++; if (row.over != null) known++;
    }
  }
  return { idx, ok, known };
}

// ---- grupos de división ----
const divGroup = (w) => {
  const s = String(w || '');
  if (/^W /.test(s)) return 'women';
  if (/Heavyweight/.test(s)) return 'heavy';       // HW + LHW
  if (/Flyweight|Bantamweight/.test(s)) return 'small';
  return 'mid';                                     // FW, LW, WW, MW, catch
};

// ---- acumuladores ----
const acc0 = () => ({ n: 0, hit: 0, brier: 0, logl: 0, calP: Array(10).fill(0), calY: Array(10).fill(0), calN: Array(10).fill(0) });
function push(A, p, y) {
  A.n++; if ((p >= 0.5) === (y === 1)) A.hit++;
  A.brier += (p - y) ** 2;
  A.logl += -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));
  const b = Math.min(9, Math.floor(p * 10)); A.calP[b] += p; A.calY[b] += y; A.calN[b]++;
}
const calErr = (A) => { let e = 0, w = 0; for (let i = 0; i < 10; i++) { if (A.calN[i] < 30) continue; e += A.calN[i] * Math.abs(A.calP[i] / A.calN[i] - A.calY[i] / A.calN[i]); w += A.calN[i]; } return w ? e / w : null; };
const rep = (A) => A.n ? { n: A.n, acc: +(A.hit / A.n).toFixed(4), brier: +(A.brier / A.n).toFixed(5), skill: +((0.25 * A.n - A.brier) / A.n).toFixed(5), logloss: +(A.logl / A.n).toFixed(4), cal_err: calErr(A) != null ? +calErr(A).toFixed(4) : null } : null;

// ---- features nuevas (todas antisimétricas: g(A,B) = −g(B,A)) ----
const AGE_BINS = [[0, 25], [25, 30], [30, 34], [34, 37], [37, 99]]; // <25, 25-29, 30-33, 34-36, >36
const NEW = {
  a: ['ageb0', 'ageb1', 'ageb2', 'ageb3', 'ageb4', 'ageXheavy', 'ageXsmall', 'ageXwomen'],
  b: ['lay18', 'laylog', 'postko', 'postko6'],
  c: ['qform', 'oppq'],
  d1: ['misswt'],            // magnitud real (feature ya existente, hoy inerte en el backtest y fija 2 lb en prod)
  d2: ['missflag'],          // indicador binario "no dio el peso" (lo que ve prod en vivo)
  d3: ['misswt', 'missflag'],
  e: ['eloXwomen', 'eloXheavy', 'eloXsmall', 'eloX5R'],
  f: ['southpaw', 'height'],   // H4: zurdo vs ortodoxo (cruce antisimétrico) + altura (ambos ya en fighters-*.json)
};
const BASE = CE.ALL_FEATS.slice(); // COMBAT_X_FEATURES no está puesto → 8 + 5 finas = ACTUAL

function newFeats(model, aux, fighters, f, fd, pElo, wi) {
  const id1 = f.f1.id, id2 = f.f2.id, t = Date.parse(f.date);
  const a = fighters[id1] || {}, b = fighters[id2] || {};
  const age = (p) => p.dob ? (t - Date.parse(p.dob)) / YEAR : null;
  const a1 = age(a), a2 = age(b);
  const grp = divGroup(f.weight);
  const out = {};
  // (a) edad por tramos + interacción con división
  for (let i = 0; i < AGE_BINS.length; i++) {
    const [lo, hi] = AGE_BINS[i];
    const I = (x) => (x != null && x >= lo && x < hi ? 1 : 0);
    out['ageb' + i] = (a1 != null && a2 != null) ? I(a1) - I(a2) : 0;
  }
  out.ageXheavy = grp === 'heavy' ? fd.age : 0;
  out.ageXsmall = grp === 'small' ? fd.age : 0;
  out.ageXwomen = grp === 'women' ? fd.age : 0;
  // (b) inactividad no lineal + vuelve tras KO
  const gapM = (id) => { const l = model.LAST[id]; return l ? (t - Date.parse(l)) / MONTH : null; };
  const g1 = gapM(id1), g2 = gapM(id2);
  const I18 = (g) => (g != null && g > 18 ? 1 : 0);
  out.lay18 = I18(g1) - I18(g2);
  out.laylog = (g1 != null && g2 != null) ? (Math.log1p(g1) - Math.log1p(g2)) / 2 : 0;
  const pk = (id) => (aux.LASTKO[id] ? 1 : 0);
  out.postko = pk(id1) - pk(id2);
  const pk6 = (id, g) => (aux.LASTKO[id] && g != null && g < 6 ? 1 : 0);
  out.postko6 = pk6(id1, g1) - pk6(id2, g2);
  // (c) forma reciente ponderada por rival: residuo vs expectativa Elo en las últimas 3 + calidad media del rival
  const q = (id) => { const h = aux.HQ[id] || []; if (!h.length) return { res: 0, opp: null }; let r = 0, o = 0; for (const x of h) { r += x.y - x.e; o += x.opp; } return { res: r / h.length, opp: o / h.length }; };
  const q1 = q(id1), q2 = q(id2);
  out.qform = q1.res - q2.res;
  out.oppq = (q1.opp != null && q2.opp != null) ? (q1.opp - q2.opp) / 280 : 0;
  // (d) pesaje real
  const w1 = (wi || {}).f1 || {}, w2 = (wi || {}).f2 || {};
  const missW = (over) => Math.min(+over || 0, 5) / 2;
  out.misswt = missW(w1.over) - missW(w2.over);
  out.missflag = (w1.miss ? 1 : 0) - (w2.miss ? 1 : 0);
  // (e) SPREAD por división = escala del logit(Elo) por grupo (aprendida)
  const L = logit(pElo);
  out.eloXwomen = grp === 'women' ? L : 0;
  out.eloXheavy = grp === 'heavy' ? L : 0;
  out.eloXsmall = grp === 'small' ? L : 0;
  out.eloX5R = (f.rounds_sched || 3) >= 5 ? L : 0;
  // (f) zurdos y altura
  const st = (p) => String(p.stance || '').toLowerCase();
  const S = (p) => (/southpaw/.test(st(p)) ? 1 : 0), O = (p) => (/orthodox/.test(st(p)) ? 1 : 0);
  out.southpaw = S(a) * O(b) - S(b) * O(a);            // +1 = zurdo contra ortodoxo (la ventaja clásica del zurdo)
  const inch = (x) => { if (!x) return null; const m = String(x).match(/(\d+)\s*'\s*(\d+)?/); if (m) return +m[1] * 12 + (+(m[2] || 0)); const n = String(x).match(/([\d.]+)/); return n ? +n[1] : null; };
  const h1 = inch(a.height_in), h2 = inch(b.height_in);
  out.height = (h1 != null && h2 != null) ? (h1 - h2) / 4 : 0;
  return out;
}

function run(org) {
  const F = JSON.parse(fs.readFileSync(path.join(DATA, `fights-${org}.json`), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(path.join(DATA, `fighters-${org}.json`), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const { perFight, joined } = fineJoin(fights);
  const WI = weighIndex(org, fights);
  const warm = Math.floor(fights.length * WARM);
  console.log(`\n${'='.repeat(100)}\nORG ${org.toUpperCase()} — ${fights.length} peleas (${fights[0].date.slice(0, 10)} → ${fights[fights.length - 1].date.slice(0, 10)}) · fine join ${joined} · pesajes casados ${WI.ok} (lbs conocidas ${WI.known}) · warm ${warm}`);

  const VARIANTS = [{ name: 'ACTUAL', feats: BASE }];
  for (const [k, fl] of Object.entries(NEW)) VARIANTS.push({ name: '+' + k, feats: BASE.concat(fl) });
  VARIANTS.push({ name: '+a+b+c', feats: BASE.concat(NEW.a, NEW.b, NEW.c) });
  VARIANTS.push({ name: '+b+c', feats: BASE.concat(NEW.b, NEW.c) });
  VARIANTS.push({ name: 'ALL', feats: BASE.concat(NEW.a, NEW.b, NEW.c, NEW.d3, NEW.e, NEW.f) });
  VARIANTS.push({ name: '+c+d2', feats: BASE.concat(NEW.c, NEW.d2) });
  VARIANTS.push({ name: '+c+e', feats: BASE.concat(NEW.c, NEW.e) });

  const model = CE.newModel(null, {});
  const aux = { LASTKO: {}, HQ: {} };
  const W = VARIANTS.map(v => { const w = { elo: 1 }; for (const k of v.feats) w[k] = 0; return w; });
  const A = { elo: acc0() }; VARIANTS.forEach(v => { A[v.name] = acc0(); });
  const seg = {}; const addSeg = (k, vn, p, y) => { const K = k + '|' + vn; (seg[K] = seg[K] || acc0()); push(seg[K], p, y); };
  const pairs = []; const meta = []; const ROWS = []; // ROWS: vector de features walk-forward de CADA pelea (para el refit por lotes)
  const era = (d) => (d < '2013' ? 'a2012' : d < '2020' ? '2013-19' : '2020-26');
  const stats = { postko_n: 0, lay18_n: 0, miss_n: 0, women_n: 0 };

  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const ctx = { sched: f.rounds_sched || 3 };
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const fd0 = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, ctx); // misswt = 0 aquí (sin ctx.over)
    const wi = WI.idx[f.comp_id] || null;
    const nf = newFeats(model, aux, fighters, f, fd0, pElo, wi);
    const fd = Object.assign({}, fd0, nf); // misswt lo sobreescribe nf con el pesaje real
    const L = logit(pElo);
    const ps = VARIANTS.map((v, vi) => { let z = W[vi].elo * L; for (const k of v.feats) z += W[vi][k] * fd[k]; return sigm(z); });
    ROWS.push({ i, year: +f.date.slice(0, 4), y, L, fd, oos: i >= warm });
    if (i >= warm) {
      push(A.elo, pElo, y); VARIANTS.forEach((v, vi) => push(A[v.name], ps[vi], y));
      pairs.push(ps.map(p => (p - y) ** 2));
      meta.push({ era: era(f.date), grp: divGroup(f.weight), sched: ctx.sched >= 5 ? '5R' : '3R', postko: nf.postko !== 0, lay18: nf.lay18 !== 0, miss: nf.missflag !== 0 });
      if (nf.postko !== 0) stats.postko_n++; if (nf.lay18 !== 0) stats.lay18_n++; if (nf.missflag !== 0) stats.miss_n++; if (divGroup(f.weight) === 'women') stats.women_n++;
      const tags = [`era:${era(f.date)}`, `div:${divGroup(f.weight)}`, `sched:${ctx.sched >= 5 ? '5R' : '3R'}`];
      if (nf.postko !== 0) tags.push('postko:sí'); if (nf.lay18 !== 0) tags.push('lay18:sí'); if (nf.missflag !== 0) tags.push('miss:sí');
      for (const t of tags) VARIANTS.forEach((v, vi) => addSeg(t, v.name, ps[vi], y));
    }
    // SGD online (tras evaluar)
    VARIANTS.forEach((v, vi) => { const g = ps[vi] - y; W[vi].elo -= FEAT_LR * g * L; for (const k of v.feats) W[vi][k] -= FEAT_LR * g * fd[k]; });
    // auxiliares propios (ANTES del eloStep para capturar el Elo pre-pelea del rival)
    const r1 = model.R[f.f1.id] == null ? 1500 : model.R[f.f1.id], r2 = model.R[f.f2.id] == null ? 1500 : model.R[f.f2.id];
    const e1 = CE.expected(r1, r2);
    const pushHQ = (id, yy, e, opp) => { (aux.HQ[id] = aux.HQ[id] || []).push({ y: yy, e, opp }); if (aux.HQ[id].length > 3) aux.HQ[id].shift(); };
    pushHQ(f.f1.id, y, e1, r2); pushHQ(f.f2.id, 1 - y, 1 - e1, r1);
    const loser = y ? f.f2.id : f.f1.id, winner = y ? f.f1.id : f.f2.id;
    aux.LASTKO[loser] = isKO(f.method) ? 1 : 0; aux.LASTKO[winner] = 0;
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });

  console.log(`\nGANADOR (OOS) · postko ${stats.postko_n} · lay18 ${stats.lay18_n} · miss ${stats.miss_n} · women ${stats.women_n}`);
  console.log('  Elo puro        ', JSON.stringify(rep(A.elo)));
  VARIANTS.forEach(v => console.log(`  ${v.name.padEnd(16)}`, JSON.stringify(rep(A[v.name]))));

  // bootstrap PAREADO vs ACTUAL (índice 0)
  const N = pairs.length; const R = rng(20260902);
  const boot = {};
  const idxAll = pairs.map((_, j) => j);
  const bootFor = (label, idxs) => {
    const n = idxs.length; if (!n) return;
    for (let vi = 1; vi < VARIANTS.length; vi++) {
      let better = 0; const ds = [];
      let dObs = 0; for (const j of idxs) dObs += pairs[j][vi] - pairs[j][0]; dObs /= n;
      for (let b = 0; b < BOOTS; b++) {
        let d = 0;
        for (let j = 0; j < n; j++) { const r = pairs[idxs[(R() * n) | 0]]; d += r[vi] - r[0]; }
        d /= n; ds.push(d); if (d < 0) better++;
      }
      ds.sort((x, y) => x - y);
      boot[label + '|' + VARIANTS[vi].name] = { n, dBrier_x1e4: +(dObs * 1e4).toFixed(2), ci95_x1e4: [+(ds[Math.floor(0.025 * BOOTS)] * 1e4).toFixed(2), +(ds[Math.floor(0.975 * BOOTS)] * 1e4).toFixed(2)], P_mejor: +(better / BOOTS).toFixed(3) };
    }
  };
  bootFor('all', idxAll);
  bootFor('era:2020-26', idxAll.filter(j => meta[j].era === '2020-26'));
  bootFor('div:women', idxAll.filter(j => meta[j].grp === 'women'));
  bootFor('postko:sí', idxAll.filter(j => meta[j].postko));
  bootFor('lay18:sí', idxAll.filter(j => meta[j].lay18));
  bootFor('miss:sí', idxAll.filter(j => meta[j].miss));
  console.log('\nBOOTSTRAP PAREADO ΔBrier (variante − ACTUAL; negativo = mejor) ×1e4:');
  for (const [k, v] of Object.entries(boot)) console.log(`  ${k.padEnd(28)} n=${String(v.n).padStart(5)}  Δ=${String(v.dBrier_x1e4).padStart(7)}  IC95 [${v.ci95_x1e4[0]}, ${v.ci95_x1e4[1]}]  P(mejor)=${v.P_mejor}`);

  console.log('\nSEGMENTOS (Brier ACTUAL → mejor variante del segmento):');
  const segKeys = [...new Set(Object.keys(seg).map(k => k.split('|')[0]))].sort();
  const segOut = {};
  for (const k of segKeys) {
    const b = rep(seg[k + '|ACTUAL']); if (!b || b.n < 40) continue;
    const row = { n: b.n, ACTUAL: b.brier };
    for (const v of VARIANTS.slice(1)) { const r = rep(seg[k + '|' + v.name]); row[v.name] = r.brier; }
    segOut[k] = row;
    const best = Object.entries(row).filter(([kk]) => kk !== 'n').sort((x, y) => x[1] - y[1])[0];
    console.log(`  ${k.padEnd(14)} n=${String(b.n).padStart(5)}  ACTUAL ${b.brier}  +a ${row['+a']}  +b ${row['+b']}  +c ${row['+c']}  +d3 ${row['+d3']}  +e ${row['+e']}  ALL ${row.ALL}   mejor: ${best[0]} ${best[1]}`);
  }
  // ---- H2f: REFIT POR LOTES anual (regresión logística sin intercepto, ridge λ=1, Newton) — walk-forward por año:
  // las peleas del año Y se predicen con pesos ajustados SOLO con peleas de años < Y. Las features de cada pelea
  // son las mismas que vio el SGD (estado al momento de la pelea) → cero leakage. Compara método de ajuste.
  const batchSets = { 'ACTUAL': BASE, '+a': BASE.concat(NEW.a), '+b': BASE.concat(NEW.b), '+c': BASE.concat(NEW.c), '+d2': BASE.concat(NEW.d2), '+e': BASE.concat(NEW.e), '+f': BASE.concat(NEW.f), '+c+e': BASE.concat(NEW.c, NEW.e), 'ALL': BASE.concat(NEW.a, NEW.b, NEW.c, NEW.d3, NEW.e, NEW.f) };
  const solve = (H, g) => { const n = g.length; const M = H.map((r, i) => r.concat([g[i]])); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c] || 1e-9; for (let r = 0; r < n; r++) { if (r === c) continue; const fct = M[r][c] / d; if (!fct) continue; for (let k = c; k <= n; k++) M[r][k] -= fct * M[c][k]; } } return M.map((r, i) => r[n] / (r[i] || 1e-9)); };
  const fitLogit = (rows, keys, lambda = 1) => {
    const d = keys.length + 1; let w = Array(d).fill(0); w[0] = 1;
    const x = (r) => [r.L].concat(keys.map(k => r.fd[k] || 0));
    for (let it = 0; it < 12; it++) {
      const g = Array(d).fill(0), H = Array.from({ length: d }, () => Array(d).fill(0));
      for (const r of rows) { const xv = x(r); let z = 0; for (let j = 0; j < d; j++) z += w[j] * xv[j]; const p = sigm(z); const e = p - r.y, s2 = p * (1 - p); for (let j = 0; j < d; j++) { g[j] += e * xv[j]; for (let k = 0; k < d; k++) H[j][k] += s2 * xv[j] * xv[k]; } }
      for (let j = 0; j < d; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; }
      const step = solve(H, g); let mx = 0; for (let j = 0; j < d; j++) { w[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
      if (mx < 1e-6) break;
    }
    return { w, x };
  };
  const years = [...new Set(ROWS.filter(r => r.oos).map(r => r.year))].sort();
  const batchPred = {}; for (const k of Object.keys(batchSets)) batchPred[k] = new Array(ROWS.length).fill(null);
  for (const Y of years) {
    const train = ROWS.filter(r => r.year < Y); const test = ROWS.filter(r => r.year === Y && r.oos);
    if (!train.length) continue;
    for (const [k, keys] of Object.entries(batchSets)) { const { w, x } = fitLogit(train, keys); for (const r of test) { const xv = x(r); let z = 0; for (let j = 0; j < w.length; j++) z += w[j] * xv[j]; batchPred[k][r.i] = sigm(z); } }
  }
  const oosRows = ROWS.filter(r => r.oos && batchPred.ACTUAL[r.i] != null);
  const bAcc = {}; const bPairs = []; // [sgdACTUAL, batchACTUAL, batch+a, ...]
  const bKeys = Object.keys(batchSets);
  for (const k of bKeys) bAcc[k] = acc0();
  for (const r of oosRows) for (const k of bKeys) push(bAcc[k], batchPred[k][r.i], r.y);
  for (const r of oosRows) bPairs.push([pairs[r.i - warm][0]].concat(bKeys.map(k => (batchPred[k][r.i] - r.y) ** 2)));
  console.log(`\nH2f REFIT POR LOTES ANUAL (mismas ${oosRows.length} peleas OOS; años ${years[0]}-${years[years.length - 1]}):`);
  let sgdB = 0; for (const r of bPairs) sgdB += r[0]; console.log(`  SGD ACTUAL (prod)   brier ${(sgdB / bPairs.length).toFixed(5)}`);
  for (const k of bKeys) console.log(`  lotes ${k.padEnd(12)}`, JSON.stringify(rep(bAcc[k])));
  const bootB = {}; const Nb = bPairs.length;
  for (let vi = 1; vi <= bKeys.length; vi++) {
    for (const [refName, refIdx] of [['vs SGD ACTUAL', 0], ['vs lotes ACTUAL', 1]]) {
      if (refIdx === vi) continue;
      let better = 0; const ds = []; let dObs = 0; for (const r of bPairs) dObs += r[vi] - r[refIdx]; dObs /= Nb;
      for (let b = 0; b < BOOTS; b++) { let d = 0; for (let j = 0; j < Nb; j++) { const r = bPairs[(R() * Nb) | 0]; d += r[vi] - r[refIdx]; } d /= Nb; ds.push(d); if (d < 0) better++; }
      ds.sort((x, y) => x - y);
      bootB[`lotes ${bKeys[vi - 1]} ${refName}`] = { n: Nb, dBrier_x1e4: +(dObs * 1e4).toFixed(2), ci95_x1e4: [+(ds[Math.floor(0.025 * BOOTS)] * 1e4).toFixed(2), +(ds[Math.floor(0.975 * BOOTS)] * 1e4).toFixed(2)], P_mejor: +(better / BOOTS).toFixed(3) };
    }
  }
  for (const [k, v] of Object.entries(bootB)) console.log(`  ${k.padEnd(34)} Δ=${String(v.dBrier_x1e4).padStart(7)}  IC95 [${v.ci95_x1e4[0]}, ${v.ci95_x1e4[1]}]  P(mejor)=${v.P_mejor}`);
  const lastFit = Object.fromEntries(Object.entries(batchSets).map(([k, keys]) => { const { w } = fitLogit(ROWS, keys); return [k, Object.fromEntries([['elo', +w[0].toFixed(4)]].concat(keys.map((kk, j) => [kk, +w[j + 1].toFixed(4)])))]; }));
  console.log('\nPESOS LOTES (ajuste final con TODO, solo descriptivo) ALL:', JSON.stringify(lastFit.ALL));
  const weights = Object.fromEntries(VARIANTS.map((v, vi) => [v.name, Object.fromEntries(Object.entries(W[vi]).map(([k, x]) => [k, +x.toFixed(4)]))]));
  console.log('\nPESOS ALL:', JSON.stringify(weights.ALL));
  return { org, n_oos: N, joined, weighins: { matched: WI.ok, known_lbs: WI.known }, stats, elo: rep(A.elo), variants: Object.fromEntries(VARIANTS.map(v => [v.name, rep(A[v.name])])), boot, segments: segOut, weights, batch: { n: Nb, years: [years[0], years[years.length - 1]], sgd_actual_brier: +(sgdB / Nb).toFixed(5), variants: Object.fromEntries(bKeys.map(k => [k, rep(bAcc[k])])), boot: bootB, weights_final: lastFit } };
}

const out = ORGS.map(run);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('\nescrito', OUT);
