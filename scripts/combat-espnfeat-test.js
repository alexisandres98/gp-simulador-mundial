#!/usr/bin/env node
/**
 * #5 — ¿APORTAN LAS STATS FINAS DE ESPN? El peaje de las features nuevas.
 *
 * El harvest trajo 34 métricas por peleador por pelea en 7,970 peleas desde 2010 — 3x lo que cubre el
 * api-sports PRO (2022+) y con dimensiones que ese no tiene:
 *   · PRECISIÓN real (intentos Y conectados) → separar volumen de puntería, que son cosas distintas
 *   · POSICIÓN (distancia / clinch / suelo) → dónde ocurre el daño
 *   · GRAPPLING de verdad (advances a media guardia/lateral/montada/espalda, reversiones)
 *   · control real en segundos
 *
 * El test es el mismo estándar de siempre: walk-forward, evaluando ANTES de aprender, midiendo el skill
 * INCREMENTAL sobre el modelo que ya tenemos. Y con los controles que aprendimos a exigir:
 * dosis-respuesta donde aplique, estabilidad temporal, y sobrevivir al confundido.
 *
 * Uso: node scripts/combat-espnfeat-test.js [--org=ufc] [--minfights=3]
 */
const fs = require('fs');
const path = require('path');
const CE = require('../combat-engine/ratings');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ORG = args.org || 'ufc';
const MINF = +args.minfights || 3;      // mínimo de peleas con stats para que un peleador cuente
const p = (n) => path.join(__dirname, '..', 'data', 'combat', n);

const F = JSON.parse(fs.readFileSync(p(`fights-${ORG}.json`), 'utf8'));
const FIGHTERS = JSON.parse(fs.readFileSync(p(`fighters-${ORG}.json`), 'utf8'));
const ES = JSON.parse(fs.readFileSync(p(`espnstats-${ORG}.json`), 'utf8')).stats || {};

const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner))
  .sort((a, b) => new Date(a.date) - new Date(b.date));
const clockMin = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const minutesOf = (f) => ((f.end_round || 3) - 1) * 5 + clockMin(f.end_clock);

const sig = (s) => ({
  att: s.sigStrikesAttempted || 0, land: s.sigStrikesLanded || 0,
  ground: (s.sigGroundHeadStrikesLanded || 0) + (s.sigGroundBodyStrikesLanded || 0) + (s.sigGroundLegStrikesLanded || 0),
  clinch: (s.sigClinchHeadStrikesLanded || 0) + (s.sigClinchBodyStrikesLanded || 0) + (s.sigClinchLegStrikesLanded || 0),
  dist: (s.sigDistanceHeadStrikesLanded || 0) + (s.sigDistanceBodyStrikesLanded || 0) + (s.sigDistanceLegStrikesLanded || 0),
  adv: s.advances || 0, rev: s.reversals || 0, kd: s.knockDowns || 0,
  tdA: s.takedownsAttempted || 0, tdL: s.takedownsLanded || 0,
  ctrl: s.timeInControl || 0,
});

// ---- acumuladores walk-forward por peleador (solo pasado) ----
const AG = {};
const bump = (id, s, mins, opp) => {
  const g = AG[id] = AG[id] || { n: 0, min: 0, att: 0, land: 0, ground: 0, clinch: 0, dist: 0, adv: 0, rev: 0, kd: 0, tdA: 0, tdL: 0, ctrl: 0, oppAtt: 0, oppLand: 0 };
  g.n++; g.min += mins;
  for (const k of ['att', 'land', 'ground', 'clinch', 'dist', 'adv', 'rev', 'kd', 'tdA', 'tdL', 'ctrl']) g[k] += s[k];
  if (opp) { g.oppAtt += opp.att; g.oppLand += opp.land; }   // precisión que le PERMITE al rival = defensa
};
const prof = (id) => {
  const g = AG[id]; if (!g || g.n < MINF || g.min < 15) return null;
  const strikes = g.land || 1;
  return {
    acc: g.att ? g.land / g.att : null,                       // precisión de golpeo significativo
    def: g.oppAtt ? 1 - (g.oppLand / g.oppAtt) : null,        // defensa: cuánto NO le conectan
    grd: strikes ? g.ground / strikes : 0,                    // % del daño hecho en el suelo
    cln: strikes ? g.clinch / strikes : 0,
    adv15: g.min ? g.adv / g.min * 15 : 0,                    // avances de posición por 15 min
    rev15: g.min ? g.rev / g.min * 15 : 0,
    kd15: g.min ? g.kd / g.min * 15 : 0,
    tdacc: g.tdA ? g.tdL / g.tdA : null,
    ctrlp: g.min ? (g.ctrl / 60) / g.min : 0,                 // fracción del tiempo en control
  };
};

// ---- logística online incremental, antisimétrica y sin intercepto (igual que el engine) ----
const NEW = ['acc', 'def', 'grd', 'adv15', 'rev15', 'kd15', 'tdacc', 'ctrlp'];
const LR = 0.02;
const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (q) => { const x = Math.min(0.999, Math.max(0.001, q)); return Math.log(x / (1 - x)); };
const diffs = (a, b) => {
  if (!a || !b) return null;
  const d = {};
  d.acc = (a.acc != null && b.acc != null) ? (a.acc - b.acc) * 3 : 0;
  d.def = (a.def != null && b.def != null) ? (a.def - b.def) * 3 : 0;
  d.grd = (a.grd - b.grd) * 2;
  d.adv15 = (a.adv15 - b.adv15) / 2;
  d.rev15 = (a.rev15 - b.rev15);
  d.kd15 = (a.kd15 - b.kd15) / 0.5;
  d.tdacc = (a.tdacc != null && b.tdacc != null) ? (a.tdacc - b.tdacc) * 2 : 0;
  d.ctrlp = (a.ctrlp - b.ctrlp) * 2;
  return d;
};

const model = CE.newModel(FIGHTERS, {});
const w = { base: 1 }; for (const k of NEW) w[k] = 0;
const warm = Math.floor(fights.length * 0.35);
const rows = [];

for (let i = 0; i < fights.length; i++) {
  const f = fights[i];
  const y = f.f1.winner ? 1 : 0;
  const pr = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;   // el modelo ACTUAL, tal cual está en prod
  const A = prof(f.f1.id), B = prof(f.f2.id);
  const d = diffs(A, B);

  if (i >= warm && d) {
    let z = w.base * logit(pr);
    for (const k of NEW) z += w[k] * d[k];
    const pNew = sigm(z);
    rows.push({ base: pr, neu: pNew, y, date: f.date, n1: (AG[f.f1.id] || {}).n || 0, n2: (AG[f.f2.id] || {}).n || 0 });
    // aprender después de evaluar
    const g = pNew - y;
    w.base -= LR * g * logit(pr);
    for (const k of NEW) w[k] -= LR * g * d[k];
  } else if (d) {
    let z = w.base * logit(pr);
    for (const k of NEW) z += w[k] * d[k];
    const g = sigm(z) - y;
    w.base -= LR * g * logit(pr);
    for (const k of NEW) w[k] -= LR * g * d[k];
  }

  // acumular las stats de ESTA pelea (después de evaluar → sin leakage)
  const st = ES[f.comp_id];
  if (st) {
    const mins = minutesOf(f);
    const a = st[f.f1.id] ? sig(st[f.f1.id]) : null;
    const b = st[f.f2.id] ? sig(st[f.f2.id]) : null;
    if (a) bump(f.f1.id, a, mins, b);
    if (b) bump(f.f2.id, b, mins, a);
  }
  CE.eloStep(model, f, null);
}

const brier = (arr, key) => arr.reduce((s, r) => s + (r[key] - r.y) ** 2, 0) / arr.length;
const accy = (arr, key) => arr.filter(r => (r[key] >= 0.5) === (r.y === 1)).length / arr.length;
const rep = (arr, lbl) => {
  if (arr.length < 100) { console.log(`  ${lbl}: n=${arr.length} (insuficiente)`); return null; }
  const bB = brier(arr, 'base'), bN = brier(arr, 'neu');
  console.log(`  ${lbl.padEnd(28)} n=${String(arr.length).padStart(5)}  base brier=${bB.toFixed(4)} acc=${(100 * accy(arr, 'base')).toFixed(1)}%  |  +ESPN brier=${bN.toFixed(4)} acc=${(100 * accy(arr, 'neu')).toFixed(1)}%  |  skill=${(bB - bN >= 0 ? '+' : '') + (bB - bN).toFixed(4)}`);
  return bB - bN;
};

console.log(`\n#5 — STATS FINAS DE ESPN (${ORG.toUpperCase()}, ${Object.keys(ES).length} peleas con stats, mín ${MINF} peleas por peleador)`);
console.log(`\n── SKILL INCREMENTAL SOBRE EL MODELO ACTUAL ──`);
rep(rows, 'TODAS');

// estabilidad temporal
const mid = Math.floor(rows.length / 2);
console.log('\n── estabilidad temporal ──');
rep(rows.slice(0, mid), '1ª mitad');
rep(rows.slice(mid), '2ª mitad');

// dosis-respuesta por cantidad de data fina disponible
console.log('\n── dosis-respuesta (más peleas con stats = más señal, si es real) ──');
rep(rows.filter(r => Math.min(r.n1, r.n2) >= 3 && Math.min(r.n1, r.n2) < 6), 'ambos 3-5 peleas');
rep(rows.filter(r => Math.min(r.n1, r.n2) >= 6 && Math.min(r.n1, r.n2) < 12), 'ambos 6-11 peleas');
rep(rows.filter(r => Math.min(r.n1, r.n2) >= 12), 'ambos 12+ peleas');

// bootstrap pareado
const B = 2000, dif = rows.map(r => (r.base - r.y) ** 2 - (r.neu - r.y) ** 2);
let win = 0;
for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < dif.length; i++) s += dif[(Math.random() * dif.length) | 0]; if (s > 0) win++; }
console.log(`\n── bootstrap pareado (2000 remuestreos) ──`);
console.log(`  P(las features de ESPN mejoran) = ${(win / B).toFixed(3)}`);

console.log(`\n── pesos aprendidos ──`);
console.log('  base(elo+features actuales) =', w.base.toFixed(3));
for (const k of NEW) console.log(`  ${k.padEnd(8)} = ${w[k] >= 0 ? '+' : ''}${w[k].toFixed(4)}`);
