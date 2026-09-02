#!/usr/bin/env node
'use strict';
// Smoke del monitor de combate (combat-engine/monitor.js): etiquetas de preregistro, drift/degradación T−24 h
// y agregado del track. Sin red, sin server, sin db. Uso: node scripts/smoke/combate-smoke.js
const assert = require('assert');
const M = require('../../combat-engine/monitor');

let pasos = 0;
const ok = (msg) => { pasos++; console.log('  ok ', msg); };
const NOW = Date.parse('2026-09-05T12:00:00Z');

// ── 1. etiquetas al crear ────────────────────────────────────────────────────────────────────────────
{
  const flags = [
    { side: 'f1', code: 'layoff', severity: 'high' }, { side: 'f2', code: 'news_INJURY', severity: 'high' },
    { side: 'f1', code: 'layoff' }, // duplicado: no se repite
  ];
  const t = M.pickTags({ k: 0.46, side: 'f1', org: 'ufc', wctx: { over1: 2, over2: 0, sched: 3 }, flags, evDate: '2026-09-06T12:00:00Z', now: NOW });
  assert.strictEqual(t.market_fair_at_create, 0.46);
  assert.strictEqual(t.prereg_fav45, true, 'k=0,46 → prereg_fav45 true');
  assert.strictEqual(t.fav_market, false, 'k=0,46 → fav_market false');
  assert.strictEqual(t.espn_order_home, true, 'lado f1 en UFC = listado primero por ESPN');
  assert.deepStrictEqual(t.weigh_signal, { over1: 2, over2: 0, sched: 3 });
  assert.deepStrictEqual(t.press_signals, ['f1:layoff', 'f2:news_INJURY']);
  assert.strictEqual(t.hours_to_event, 24);
  ok('k=0,46: prereg_fav45=true, fav_market=false, prensa dedup, 24 h de antelación');

  const t2 = M.pickTags({ k: 0.55, side: 'f2', org: 'boxing', wctx: null, flags: [], evDate: '2026-09-20T02:00:00Z', now: NOW });
  assert.strictEqual(t2.fav_market, true); assert.strictEqual(t2.prereg_fav45, true);
  assert.strictEqual(t2.espn_order_home, null, 'boxeo: sin orden ESPN');
  assert.strictEqual(t2.weigh_signal, null); assert.deepStrictEqual(t2.press_signals, []);
  ok('k=0,55 boxeo: favorito, espn_order_home=null, sin pesaje');

  const t3 = M.pickTags({ k: 0.40, side: 'f2', org: 'mma', wctx: { over1: 0, over2: 0, sched: 5 }, flags: null, evDate: 'x', now: NOW });
  assert.strictEqual(t3.prereg_fav45, false); assert.strictEqual(t3.espn_order_home, false); assert.strictEqual(t3.hours_to_event, null);
  ok('k=0,40 perro: prereg_fav45=false; fecha inválida → hours_to_event null');
}

// ── 2. re-evaluación T−24 h ──────────────────────────────────────────────────────────────────────────
{
  const mk = (h, extra) => ({ status: 'ACTIVE', family: 'FIGHT', best_odds: 2.0, model_prob: 0.60, market_prob: 0.50,
    event: { kickoff_at: new Date(NOW + h * 3600e3).toISOString() }, ...extra });
  // fuera de ventana (30 h) → null
  assert.strictEqual(M.t24Eval(mk(30), { oddsNow: 2.2, fairNow: 0.45, now: NOW }), null);
  // ya pasó el campanazo → null
  assert.strictEqual(M.t24Eval(mk(-1), { oddsNow: 2.2, fairNow: 0.45, now: NOW }), null);
  ok('fuera de la ventana (26 h → 0 h) no se evalúa');

  // dentro, sin deriva y con ventaja intacta → evaluada, no degradada
  const a = M.t24Eval(mk(20), { oddsNow: 2.0, fairNow: 0.50, now: NOW });
  assert.strictEqual(a.degraded_monitor, false); assert.strictEqual(a.drift_t24_pct, 0); assert.strictEqual(a.edge_blend_t24_pp, 5);
  assert.strictEqual(a.t24_hours_to_event, 20); assert.strictEqual(a.degraded_reason, null);
  ok('T−20 h sin deriva: evaluada, degraded_monitor=false, ventaja 5 pp');

  // deriva > 5 %: 2,0 → 2,2 = +10 %
  const b = M.t24Eval(mk(10), { oddsNow: 2.2, fairNow: 0.50, now: NOW });
  assert.strictEqual(b.degraded_monitor, true); assert.strictEqual(b.drift_t24_pct, 10); assert.match(b.degraded_reason, /alargada/);
  ok('deriva +10 % → degradada por cuota');

  // deriva ≤ 5 % pero el fair sube y la ventaja post-blend cae bajo 2 pp: m=0,60, fair=0,57 → 0,5·0,03 = 1,5 pp
  const c = M.t24Eval(mk(3), { oddsNow: 2.02, fairNow: 0.57, now: NOW });
  assert.strictEqual(c.degraded_monitor, true); assert.strictEqual(c.edge_blend_t24_pp, 1.5); assert.match(c.degraded_reason, /ventaja post-blend/);
  assert.ok(!/alargada/.test(c.degraded_reason));
  ok('fair 0,57 → ventaja 1,5 pp < 2 → degradada por ventaja (no por cuota)');

  // exactamente 5 % NO degrada (la regla es > 5 %)
  const d = M.t24Eval(mk(5), { oddsNow: 2.1, fairNow: 0.50, now: NOW });
  assert.strictEqual(d.degraded_monitor, false); assert.strictEqual(d.drift_t24_pct, 5);
  ok('deriva exacta 5 % no degrada (umbral estricto)');

  // idempotencia: con la foto tomada, una segunda pasada devuelve null aunque la cuota cambie
  const p = mk(20); Object.assign(p, M.t24Eval(p, { oddsNow: 2.0, fairNow: 0.50, now: NOW }));
  assert.strictEqual(M.t24Eval(p, { oddsNow: 2.5, fairNow: 0.40, now: NOW + 3600e3 }), null);
  assert.strictEqual(p.degraded_monitor, false);
  ok('idempotente: la segunda pasada no reescribe la foto');

  // no toca ROUNDS/METHOD ni picks liquidadas
  assert.strictEqual(M.t24Eval(mk(20, { family: 'ROUNDS' }), { oddsNow: 2.5, fairNow: 0.4, now: NOW }), null);
  assert.strictEqual(M.t24Eval(mk(20, { status: 'SETTLED' }), { oddsNow: 2.5, fairNow: 0.4, now: NOW }), null);
  ok('solo FIGHT ACTIVE');
}

// ── 3. fecha placeholder ─────────────────────────────────────────────────────────────────────────────
{
  assert.strictEqual(M.isPlaceholderDate('2026-12-31T23:00Z', NOW), true);
  assert.strictEqual(M.isPlaceholderDate('2026-12-31T22:59Z', NOW), true);
  assert.strictEqual(M.isPlaceholderDate(new Date(NOW + 121 * 864e5).toISOString(), NOW), true);
  assert.strictEqual(M.isPlaceholderDate(new Date(NOW + 30 * 864e5).toISOString(), NOW), false);
  assert.strictEqual(M.isPlaceholderDate('2026-12-31T12:00Z', NOW), false, '31-dic a mediodía a <120 días es una fecha real');
  ok('placeholder: 31-dic 22/23h o >120 días; el resto no');
}

// ── 4. agregado del track ────────────────────────────────────────────────────────────────────────────
{
  const rows = [
    { family: 'FIGHT', result_code: 'WIN', units: 0.8, clv_pct: 4, prereg_fav45: true, fav_market: true, degraded_monitor: false },
    { family: 'FIGHT', result_code: 'LOSS', units: -1, clv_pct: 2, prereg_fav45: true, fav_market: false, degraded_monitor: false },
    { family: 'FIGHT', result_code: 'LOSS', units: -1, clv_pct: -6, prereg_fav45: false, fav_market: false, degraded_monitor: true },
    { family: 'FIGHT', result_code: 'WIN', units: 1.5, clv_pct: -2, market_prob: 0.30 }, // pick vieja sin etiquetas: se deriva de market_prob
    { family: 'ROUNDS', result_code: 'WIN', units: 0.9, clv_pct: 9, prereg_fav45: true }, // no entra al desglose FIGHT
  ];
  const t = M.trackBreakdown(rows);
  const si = t.prereg_fav45.si;
  assert.strictEqual(si.n, 2); assert.strictEqual(si.w, 1); assert.strictEqual(si.hit, 50); assert.strictEqual(si.units, -0.2); assert.strictEqual(si.roi_pct, -10);
  assert.strictEqual(si.clv_avg, 3); assert.strictEqual(si.clv_sd, 1.41); assert.strictEqual(si.clv_se, 1); assert.strictEqual(si.clv_t, 3);
  ok('prereg_fav45=sí: n=2, CLV medio 3 ± 1 (sd 1,41/√2), ROI −10 %');
  const no = t.prereg_fav45.no;
  assert.strictEqual(no.n, 2); assert.strictEqual(no.clv_avg, -4); assert.strictEqual(no.clv_se, 2);
  ok('prereg_fav45=no: la pick vieja (k=0,30) cae aquí por market_prob; CLV −4 ± 2');
  assert.strictEqual(t.degraded_monitor.si.n, 1); assert.strictEqual(t.degraded_monitor.no.n, 2); assert.strictEqual(t.degraded_monitor.sin_t24.n, 1);
  ok('degradación: 1 sí, 2 no, 1 sin foto T−24');
  assert.strictEqual(t.clv_by_side.favorito.n, 1); assert.strictEqual(t.clv_by_side.perro.n, 3); assert.strictEqual(t.clv_by_side.perro.clv_avg, -2);
  ok('CLV por lado: 1 favorito, 3 perros (CLV −2)');
  const solo = M.aggClv([{ result_code: 'WIN', units: 1, clv_pct: 3 }]);
  assert.strictEqual(solo.clv_avg, 3); assert.strictEqual(solo.clv_sd, null); assert.strictEqual(solo.clv_se, null);
  const vacio = M.aggClv([]);
  assert.strictEqual(vacio.n, 0); assert.strictEqual(vacio.hit, null); assert.strictEqual(vacio.clv_avg, null);
  ok('n=1 sin sd/se; n=0 todo null (sin división por cero)');
}

console.log(`\ncombate-smoke: ${pasos} comprobaciones OK`);
