#!/usr/bin/env node
'use strict';
// Smoke del modelo consciente del mercado (combat-engine/market-aware.js) y del corte nuevo del track
// (combat-engine/monitor.js → fight_breakdown.mkt_aware_edge). Sin red, sin server, sin db.
// Uso: node scripts/smoke/combat-mkt-smoke.js
const assert = require('assert');
const path = require('path');
const MA = require('../../combat-engine/market-aware');
const M = require('../../combat-engine/monitor');

let pasos = 0;
const ok = (msg) => { pasos++; console.log('  ok ', msg); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// ── 1. con coeficientes 0 la función devuelve p_cierre (exacto, sin pasar por logit) ──────────────────────
{
  const z = MA.zeroCoefs();
  assert.strictEqual(z.close, 1);
  assert.ok(MA.FEATURE_KEYS.every(k => z.feats[k] === 0) && MA.FEATURE_KEYS.length === 14);
  const feats = MA.featuresFor({ fd: { age: 0.5, reach: -0.3, slpm: 0.2 }, pElo: 0.7, pClose: 0.6 });
  for (const k of [0.05, 0.3, 0.5, 0.6, 0.789, 0.95]) assert.strictEqual(MA.marketAwareProb({ pClose: k, features: feats, coefs: z }), k);
  assert.strictEqual(MA.marketAwareProb({ pClose: 0.6, features: feats, coefs: null }), 0.6, 'sin coefs = ceros');
  assert.strictEqual(MA.marketAwareProb({ pClose: 0.6, features: null, coefs: z }), 0.6, 'sin rasgos');
  ok('coeficientes 0 → p_cierre exacto (0,05 … 0,95), con o sin rasgos, con coefs null');
  assert.strictEqual(MA.marketAwareProb({ pClose: 0, features: feats, coefs: z }), null);
  assert.strictEqual(MA.marketAwareProb({ pClose: 1, features: feats, coefs: z }), null);
  assert.strictEqual(MA.marketAwareProb({ pClose: NaN, features: feats, coefs: z }), null);
  assert.strictEqual(MA.marketAwareProb({ pClose: 'x', features: feats, coefs: z }), null);
  ok('p_cierre inválido (0, 1, NaN, texto) → null');
}

// ── 2. un coeficiente positivo mueve en la dirección correcta (y el negativo al revés) ────────────────────
{
  const c = MA.zeroCoefs(); c.feats.age = 0.4;
  const up = MA.marketAwareProb({ pClose: 0.6, features: { age: 0.5 }, coefs: c });
  const dn = MA.marketAwareProb({ pClose: 0.6, features: { age: -0.5 }, coefs: c });
  assert.ok(up > 0.6 && dn < 0.6, `age +0,5 → ${up} > 0,6 > ${dn}`);
  near(up, 1 / (1 + Math.exp(-(Math.log(0.6 / 0.4) + 0.2))), 1e-12, 'up = sigm(logit(0,6) + 0,4·0,5)');
  // antisimetría: invertir los lados invierte la probabilidad
  near(MA.marketAwareProb({ pClose: 0.4, features: { age: -0.5 }, coefs: c }), 1 - up, 1e-12, 'antisimétrico');
  // rasgo a 0 → no mueve aunque el coeficiente exista
  assert.strictEqual(MA.marketAwareProb({ pClose: 0.6, features: { age: 0 }, coefs: c }), 0.6);
  // coeficiente negativo con rasgo positivo → baja
  const cn = MA.zeroCoefs(); cn.feats.age = -0.15;
  assert.ok(MA.marketAwareProb({ pClose: 0.6, features: { age: 1 }, coefs: cn }) < 0.6);
  ok('coeficiente +0,4 · age +0,5 sube (valor exacto), −0,5 baja, antisimétrico, rasgo 0 no mueve, coef negativo baja');
  // `close` ≠ 1 recalibra: a = 1,1 aleja del 50 %
  const cr = MA.zeroCoefs(); cr.close = 1.1;
  assert.ok(MA.marketAwareProb({ pClose: 0.7, features: {}, coefs: cr }) > 0.7);
  assert.ok(MA.marketAwareProb({ pClose: 0.3, features: {}, coefs: cr }) < 0.3);
  near(MA.marketAwareProb({ pClose: 0.5, features: {}, coefs: cr }), 0.5, 1e-12, 'a no mueve el 50 %');
  ok('close = 1,1 aleja del 50 % en ambos lados y deja el 50 % quieto');
  // rasgos con basura no rompen
  assert.strictEqual(MA.marketAwareProb({ pClose: 0.6, features: { age: NaN, reach: 'x', delo: Infinity }, coefs: c }), 0.6);
  ok('rasgos NaN/texto/Infinity se ignoran');
}

// ── 3. featuresFor y edgePP ──────────────────────────────────────────────────────────────────────────────
{
  const f = MA.featuresFor({ fd: { age: 0.25, reach: -0.1, kdr: 'x' }, pElo: 0.7, pClose: 0.6 });
  assert.strictEqual(f.age, 0.25); assert.strictEqual(f.reach, -0.1); assert.strictEqual(f.kdr, 0); assert.strictEqual(f.slpm, 0);
  near(f.delo, Math.log(0.7 / 0.3) - Math.log(0.6 / 0.4), 1e-12, 'delo = logit(p_elo) − logit(p_cierre)');
  assert.strictEqual(MA.featuresFor({ fd: null, pElo: 0.7, pClose: null }).delo, 0, 'sin cierre → delo 0');
  assert.strictEqual(MA.edgePP(0.55, 0.5), 5); assert.strictEqual(MA.edgePP(0.4812, 0.5), -1.88); assert.strictEqual(MA.edgePP(null, 0.5), null);
  ok('featuresFor: 14 claves, basura → 0, delo exacto; edgePP en pp con 2 decimales');
}

// ── 4. loadPriors: el archivo real del repo y uno inexistente ────────────────────────────────────────────
{
  const real = MA.loadPriors();
  assert.strictEqual(real.meta.ok, true, 'data/combat/market-aware-priors.json existe y parsea');
  assert.ok(isFinite(real.coefs.close) && MA.FEATURE_KEYS.every(k => isFinite(real.coefs.feats[k])));
  assert.ok(typeof real.meta.veredicto === 'string' && real.meta.generado);
  const nada = MA.loadPriors(path.join(__dirname, 'no-existe.json'));
  assert.strictEqual(nada.meta.ok, false); assert.strictEqual(nada.coefs.close, 1);
  assert.strictEqual(MA.marketAwareProb({ pClose: 0.62, features: { age: 1 }, coefs: nada.coefs }), 0.62);
  ok(`loadPriors: archivo real ok (variante ${real.meta.variante}); inexistente → ceros y p_cierre`);
}

// ── 5. el track agrega sin dividir por cero ──────────────────────────────────────────────────────────────
{
  const rows = [
    { family: 'FIGHT', result_code: 'WIN', units: 0.8, clv_pct: 4, edge_mkt_aware_pp: 3.1 },
    { family: 'FIGHT', result_code: 'LOSS', units: -1, clv_pct: -2, edge_mkt_aware_pp: 2 },     // ≥ 2 exacto
    { family: 'FIGHT', result_code: 'LOSS', units: -1, clv_pct: 1, edge_mkt_aware_pp: 0 },      // coeficientes 0 → 0 pp
    { family: 'FIGHT', result_code: 'WIN', units: 1.2, clv_pct: null, edge_mkt_aware_pp: -1.5 },
    { family: 'FIGHT', result_code: 'WIN', units: 0.5, clv_pct: 2, market_prob: 0.4 },          // pick vieja: sin campo
    { family: 'ROUNDS', result_code: 'WIN', units: 0.9, clv_pct: 9, edge_mkt_aware_pp: 5 },     // no entra
  ];
  const t = M.trackBreakdown(rows).mkt_aware_edge;
  assert.strictEqual(t.ge2.n, 2); assert.strictEqual(t.ge2.w, 1); assert.strictEqual(t.ge2.clv_avg, 1); assert.strictEqual(t.ge2.roi_pct, -10);
  assert.strictEqual(t.lt2.n, 2); assert.strictEqual(t.lt2.clv_n, 1, 'CLV null no cuenta'); assert.strictEqual(t.lt2.clv_sd, null);
  assert.strictEqual(t.sin_dato.n, 1);
  ok('mkt_aware_edge: ge2 n=2 (el 2,0 exacto entra), lt2 n=2 con un CLV null, sin_dato n=1; ROUNDS fuera');
  const v = M.trackBreakdown([]).mkt_aware_edge;
  for (const k of ['ge2', 'lt2', 'sin_dato']) { assert.strictEqual(v[k].n, 0); assert.strictEqual(v[k].hit, null); assert.strictEqual(v[k].roi_pct, null); assert.strictEqual(v[k].clv_avg, null); assert.strictEqual(v[k].clv_t, null); }
  const solo = M.trackBreakdown([{ family: 'FIGHT', result_code: 'LOSS', units: -1, clv_pct: -3, edge_mkt_aware_pp: 0 }]).mkt_aware_edge;
  assert.strictEqual(solo.lt2.n, 1); assert.strictEqual(solo.lt2.clv_avg, -3); assert.strictEqual(solo.lt2.clv_se, null); assert.strictEqual(solo.lt2.clv_t, null);
  assert.strictEqual(M.MKT_AWARE_EDGE_PP, 2);
  // los cortes anteriores siguen intactos
  const full = M.trackBreakdown(rows);
  assert.ok(full.prereg_fav45 && full.degraded_monitor && full.clv_by_side);
  ok('vacío → todo null (sin división por cero); n=1 sin se/t; cortes previos intactos');
}

console.log(`\ncombat-mkt-smoke: ${pasos} comprobaciones OK`);
