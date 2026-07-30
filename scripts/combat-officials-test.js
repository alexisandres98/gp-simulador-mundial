#!/usr/bin/env node
/**
 * #4 — ¿EL ÁRBITRO MUEVE EL RESULTADO? El peaje de la capa de oficiales.
 *
 * La hipótesis del deporte: unos árbitros dejan seguir y otros paran temprano. Si es cierto y es
 * medible, toca directo a METHOD y ROUNDS, que son familias que SÍ publicamos.
 *
 * El test no es "¿bajo el árbitro X hay más finishes?" (los árbitros de élite trabajan estelares, con
 * peleadores distintos — eso el modelo ya lo sabe). Es: **¿hay MÁS finishes de los que el modelo ya
 * predecía para esas peleas concretas?**
 *
 * Estándar de la casa, el mismo que separó al pesaje (cableado) del descanso y el campamento (rechazados):
 *   1. significancia,
 *   2. DOSIS-RESPUESTA (los árbitros "de gatillo rápido" arriba y los "que dejan seguir" abajo, en orden),
 *   3. estabilidad temporal,
 *   4. sobrevivir al control del confundido (aquí: rounds pactados y posición en cartelera).
 *
 * Uso: node scripts/combat-officials-test.js [--org=ufc] [--min=30]
 */
const fs = require('fs');
const path = require('path');
const CE = require('../combat-engine/ratings');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ORG = args.org || 'ufc';
const MIN_REF = +args.min || 30;
const p = (n) => path.join(__dirname, '..', 'data', 'combat', n);
const F = JSON.parse(fs.readFileSync(p(`fights-${ORG}.json`), 'utf8'));
const FIGHTERS = JSON.parse(fs.readFileSync(p(`fighters-${ORG}.json`), 'utf8'));
const OFF = (JSON.parse(fs.readFileSync(p(`officials-${ORG}.json`), 'utf8')).officials) || {};

const pval = (z) => { const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - y)); };
const stat = (arr) => { // arr de {p, y}
  const n = arr.length; if (!n) return null;
  const e = arr.reduce((s, r) => s + r.p, 0), o = arr.reduce((s, r) => s + r.y, 0);
  const v = arr.reduce((s, r) => s + r.p * (1 - r.p), 0);
  return { n, real: o / n, esp: e / n, dif: (o - e) / n, z: v > 0 ? (o - e) / Math.sqrt(v) : 0 };
};
const line = (lbl, s) => s && console.log(`  ${lbl.padEnd(26)} n=${String(s.n).padStart(5)}  real ${(100 * s.real).toFixed(1)}%  esperado ${(100 * s.esp).toFixed(1)}%  dif ${(s.dif * 100 >= 0 ? '+' : '') + (s.dif * 100).toFixed(1)}pp  z=${s.z.toFixed(2)}  p=${pval(s.z).toFixed(4)}`);

const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner) && CE.methodClass(f.method))
  .sort((a, b) => new Date(a.date) - new Date(b.date));
console.log(`${fights.length} peleas con método conocido · ${Object.keys(OFF).length} con oficiales resueltos`);

const model = CE.newModel(FIGHTERS, {});
let mm = CE.methodModel([]);
const seen = [];
const warm = Math.floor(fights.length * 0.35);
const REF = {};                 // árbitro → { n, s } sobre-finish acumulado (solo pasado)
const rows = [];
let refitAt = 0;

for (let i = 0; i < fights.length; i++) {
  const f = fights[i];
  const o = OFF[f.comp_id];
  const ref = o && o.ref ? o.ref : null;
  const sched = f.rounds_sched >= 3 ? f.rounds_sched : 3;
  const isFin = CE.methodClass(f.method) !== 'dec' ? 1 : 0;
  let expFin = null;
  if (i >= warm) {
    const pr = CE.fightProb(model, f.f1.id, f.f2.id, f.date);
    expFin = CE.methodProbs(mm, pr.p1, f.f1.id, f.f2.id, f.weight, sched).finish;
    const r = ref ? REF[ref] : null;
    if (ref && r && r.n >= MIN_REF) {
      rows.push({ p: expFin, y: isFin, tend: r.s / r.n, ref, sched, main: !!f.main, date: f.date });
    }
  }
  // aprender DESPUÉS de evaluar (sin leakage)
  if (ref && expFin != null) { const r = REF[ref] = REF[ref] || { n: 0, s: 0 }; r.n++; r.s += (isFin - expFin); }
  else if (ref) { const r = REF[ref] = REF[ref] || { n: 0, s: 0 }; r.n++; } // sin expectativa aún: solo cuenta
  seen.push(f);
  CE.eloStep(model, f, null);
  if (seen.length - refitAt >= 25) { mm = CE.methodModel(seen); refitAt = seen.length; }
}

if (rows.length < 200) { console.log('muestra insuficiente:', rows.length); process.exit(0); }
console.log(`\n── ¿EL ÁRBITRO AÑADE FINISHES QUE EL MODELO NO PREDECÍA? (n=${rows.length}) ──`);
line('TODOS', stat(rows));

// 2. DOSIS-RESPUESTA: tercios por tendencia medida del árbitro
const sorted = rows.slice().sort((a, b) => a.tend - b.tend);
const t3 = Math.floor(sorted.length / 3);
console.log('\n  dosis-respuesta (tercios por tendencia medida del árbitro):');
line('deja seguir (tercio bajo)', stat(sorted.slice(0, t3)));
line('medio', stat(sorted.slice(t3, 2 * t3)));
line('gatillo rápido (tercio alto)', stat(sorted.slice(2 * t3)));

// 3. estabilidad temporal
const mid = Math.floor(rows.length / 2);
console.log('\n  estabilidad temporal (tercio alto vs bajo, por mitad):');
for (const [lbl, arr] of [['1ª mitad', rows.slice(0, mid)], ['2ª mitad', rows.slice(mid)]]) {
  const s2 = arr.slice().sort((a, b) => a.tend - b.tend); const k = Math.floor(s2.length / 3);
  const lo = stat(s2.slice(0, k)), hi = stat(s2.slice(2 * k));
  if (lo && hi) console.log(`  ${lbl}: bajo ${(lo.dif * 100).toFixed(1)}pp (n=${lo.n}) · alto ${(hi.dif * 100 >= 0 ? '+' : '') + (hi.dif * 100).toFixed(1)}pp (n=${hi.n})`);
}

// 4. CONTROL DEL CONFUNDIDO: los árbitros de élite trabajan estelares (5 rounds) → separar
console.log('\n  control del confundido (los mejores árbitros trabajan estelares):');
for (const [lbl, filt] of [['solo 3 rounds', r => r.sched === 3], ['solo 5 rounds', r => r.sched === 5], ['solo NO estelares', r => !r.main]]) {
  const sub = rows.filter(filt); if (sub.length < 150) { console.log(`  ${lbl}: n=${sub.length} (insuficiente)`); continue; }
  const s2 = sub.slice().sort((a, b) => a.tend - b.tend); const k = Math.floor(s2.length / 3);
  const lo = stat(s2.slice(0, k)), hi = stat(s2.slice(2 * k));
  console.log(`  ${lbl}: bajo ${(lo.dif * 100).toFixed(1)}pp · alto ${(hi.dif * 100 >= 0 ? '+' : '') + (hi.dif * 100).toFixed(1)}pp · brecha ${((hi.dif - lo.dif) * 100).toFixed(1)}pp (n=${sub.length})`);
}

// ranking informativo (mín 60 peleas) — display, no para cablear a mano
const rank = Object.entries(REF).filter(([, r]) => r.n >= 60).map(([k, r]) => [k, r.s / r.n, r.n]).sort((a, b) => b[1] - a[1]);
console.log('\n  árbitros con más finishes de lo esperado (mín 60 peleas):');
for (const [k, v, n] of rank.slice(0, 5)) console.log(`    ${k.padEnd(22)} ${(v * 100 >= 0 ? '+' : '') + (v * 100).toFixed(1)}pp  (n=${n})`);
console.log('  árbitros que dejan seguir:');
for (const [k, v, n] of rank.slice(-5)) console.log(`    ${k.padEnd(22)} ${(v * 100 >= 0 ? '+' : '') + (v * 100).toFixed(1)}pp  (n=${n})`);
