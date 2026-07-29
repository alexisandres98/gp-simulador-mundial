#!/usr/bin/env node
/**
 * #1 — ¿EL CORTE DE PESO PREDICE? El peaje de la feature de pesaje.
 *
 * Une los pesajes de Wikipedia (weighins-<org>.json) con nuestras peleas y mide, WALK-FORWARD y sin
 * leakage, si fallar el peso mueve el resultado MÁS ALLÁ de lo que el modelo ya sabe.
 *
 * Test central: en las peleas donde UNO de los dos falló el peso, comparamos lo que el modelo predecía
 * para él con lo que realmente pasó. Si fallar el peso es informativo, el que falla debe ganar MENOS de
 * lo que el modelo esperaba. Es la prueba honesta: no basta con "el que falla pierde" (podría ser que los
 * que fallan sean peores peleadores — eso el Elo ya lo sabe); tiene que perder MÁS de lo previsto.
 *
 * Uso: node scripts/combat-weighin-test.js [--org=ufc]
 */
const fs = require('fs');
const path = require('path');
const CE = require('../combat-engine/ratings');

const ORG = (process.argv.find(a => a.startsWith('--org=')) || '--org=ufc').split('=')[1];
const p = (n) => path.join(__dirname, '..', 'data', 'combat', n);
const F = JSON.parse(fs.readFileSync(p(`fights-${ORG}.json`), 'utf8'));
const FIGHTERS = JSON.parse(fs.readFileSync(p(`fighters-${ORG}.json`), 'utf8'));
const W = JSON.parse(fs.readFileSync(p(`weighins-${ORG}.json`), 'utf8'));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- JOIN: cada registro de pesaje contra los peleadores de ESA cartelera ----
// Regla de la casa: se puntúa y ante empate se devuelve null (jamás "el primero").
const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner))
  .sort((a, b) => new Date(a.date) - new Date(b.date));
const byEvent = {};
for (const f of fights) (byEvent[f.event] = byEvent[f.event] || []).push(f);

const missOf = {};   // comp_id → { f1: {over}, f2: {over} }
let matched = 0, ambiguous = 0, unmatched = 0;
for (const [evName, rec] of Object.entries(W.events || {})) {
  if (rec.status !== 'miss' || !rec.rows) continue;
  const evFights = byEvent[evName] || [];
  if (!evFights.length) continue;
  // candidatos: todos los peleadores de la cartelera
  const cands = [];
  for (const f of evFights) for (const side of ['f1', 'f2']) cands.push({ comp_id: f.comp_id, side, name: f[side].name });
  for (const row of rec.rows) {
    const q = new Set(norm(row.name).split(' ').filter(Boolean));
    if (!q.size) continue;
    let best = null, bestSc = 0, tie = false;
    for (const c of cands) {
      const t = new Set(norm(c.name).split(' '));
      let ov = 0; for (const x of q) if (t.has(x)) ov++;
      if (!ov) continue;
      const sc = ov * 10 + ov / Math.max(1, t.size + q.size - ov);
      if (sc > bestSc) { best = c; bestSc = sc; tie = false; }
      else if (sc === bestSc && best && best.comp_id + best.side !== c.comp_id + c.side) tie = true;
    }
    if (!best) { unmatched++; continue; }
    if (tie) { ambiguous++; continue; }          // empate → se descarta (no inventamos)
    matched++;
    const slot = missOf[best.comp_id] = missOf[best.comp_id] || {};
    // el mismo peleador puede aparecer 2 veces (frase de nombres + frase con detalle): nos quedamos con el detalle
    const prev = slot[best.side];
    slot[best.side] = { over: row.over != null ? row.over : (prev ? prev.over : null), lbs: row.lbs != null ? row.lbs : (prev ? prev.lbs : null) };
  }
}
console.log(`JOIN: ${matched} pesajes casados · ${ambiguous} descartados por empate · ${unmatched} sin candidato`);
const fightsWithMiss = Object.keys(missOf).length;
console.log(`peleas con al menos un peleador que falló el peso: ${fightsWithMiss}`);

// eventos con estado CONOCIDO (miss o clean) → universo evaluable; no_page = desconocido, fuera
const known = new Set(Object.entries(W.events || {}).filter(([, v]) => v.status === 'miss' || v.status === 'clean').map(([k]) => k));

// ---- WALK-FORWARD: evaluar ANTES de aprender (mismo patrón del engine) ----
const model = CE.newModel(FIGHTERS, {});
const warm = Math.floor(fights.length * 0.35);
const rows = [];
for (let i = 0; i < fights.length; i++) {
  const f = fights[i];
  if (i >= warm && known.has(f.event)) {
    const m = missOf[f.comp_id];
    if (m && (m.f1 || m.f2) && !(m.f1 && m.f2)) {   // exactamente UNO falló (el caso limpio)
      const side = m.f1 ? 'f1' : 'f2';
      const pr = CE.fightProb(model, f.f1.id, f.f2.id, f.date);
      const pMiss = side === 'f1' ? pr.p1 : 1 - pr.p1;
      const won = (side === 'f1' ? f.f1.winner : f.f2.winner) ? 1 : 0;
      rows.push({ p: pMiss, won, over: (m[side] || {}).over || null, date: f.date });
    }
  }
  CE.eloStep(model, f, null);
}

if (!rows.length) { console.log('sin muestra evaluable'); process.exit(0); }
const n = rows.length;
const exp = rows.reduce((s, r) => s + r.p, 0);
const obs = rows.reduce((s, r) => s + r.won, 0);
const varr = rows.reduce((s, r) => s + r.p * (1 - r.p), 0);
const z = (obs - exp) / Math.sqrt(varr);
const pval = (zz) => { const x = Math.abs(zz) / Math.SQRT2; const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - y)); };

console.log(`\n── ¿FALLAR EL PESO PREDICE? (out-of-sample, n=${n}) ──`);
console.log(`  el que falló el peso ganó ${obs} de ${n} = ${(100 * obs / n).toFixed(1)}%`);
console.log(`  el modelo esperaba      ${exp.toFixed(1)} de ${n} = ${(100 * exp / n).toFixed(1)}%`);
console.log(`  diferencia = ${((obs - exp) / n * 100).toFixed(1)}pp · z=${z.toFixed(2)} · p=${pval(z).toFixed(4)}`);
console.log(`  → ${pval(z) < 0.05 ? (obs < exp ? 'SEÑAL: fallar el peso PENALIZA más de lo que el modelo ya sabe' : 'SEÑAL en dirección CONTRARIA (ojo)') : 'sin significancia: el modelo ya lo tiene incorporado'}`);

// por magnitud del fallo
const big = rows.filter(r => r.over != null && r.over >= 2);
const small = rows.filter(r => r.over != null && r.over < 2);
for (const [lbl, arr] of [['≥2 lbs por encima', big], ['<2 lbs por encima', small]]) {
  if (arr.length < 12) { console.log(`  ${lbl}: n=${arr.length} (muestra insuficiente)`); continue; }
  const e2 = arr.reduce((s, r) => s + r.p, 0), o2 = arr.reduce((s, r) => s + r.won, 0);
  const v2 = arr.reduce((s, r) => s + r.p * (1 - r.p), 0);
  const z2 = (o2 - e2) / Math.sqrt(v2);
  console.log(`  ${lbl}: n=${arr.length} · real ${(100 * o2 / arr.length).toFixed(1)}% vs esperado ${(100 * e2 / arr.length).toFixed(1)}% · z=${z2.toFixed(2)} · p=${pval(z2).toFixed(4)}`);
}
// mitades temporales (¿es estable o es una racha?)
const mid = Math.floor(n / 2);
for (const [lbl, arr] of [['1ª mitad', rows.slice(0, mid)], ['2ª mitad', rows.slice(mid)]]) {
  const e2 = arr.reduce((s, r) => s + r.p, 0), o2 = arr.reduce((s, r) => s + r.won, 0);
  console.log(`  ${lbl}: n=${arr.length} · real ${(100 * o2 / arr.length).toFixed(1)}% vs esperado ${(100 * e2 / arr.length).toFixed(1)}%`);
}
