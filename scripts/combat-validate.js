#!/usr/bin/env node
// scripts/combat-validate.js — ¿SIRVE EL MOTOR NUEVO DE COMBATE? (16-ago).
//
// LO QUE SE PUEDE MEDIR Y LO QUE NO. No tenemos histórico de cuotas de combate, así que NO se puede
// calcular un ROI retrospectivo como en baloncesto. Lo que sí se puede medir —y es lo primero que hay que
// saber— es si el modelo distingue: ¿acierta más que una moneda?, ¿están bien puestos sus números?, ¿su
// vector de método coincide con cómo terminan las peleas de verdad?
//
// VENTANA MÓVIL ESTRICTA. Para cada pelea, los perfiles se construyen SOLO con peleas anteriores. Como
// reconstruir 1.500 perfiles por pelea sería inviable, se avanza por bloques: se congela el estado con todo
// lo anterior al bloque y se predicen las peleas del bloque. Entre reconstrucciones el estado es más VIEJO,
// nunca más nuevo — el sesgo va en nuestra contra, que es como tiene que ir.
//
// LAS TRES PREGUNTAS, EN ORDEN DE IMPORTANCIA:
//   1. DISCRIMINACIÓN — ¿separa ganadores de perdedores? (Brier, log loss, acierto)
//   2. CALIBRACIÓN — cuando dice 70%, ¿gana el 70%? (con intervalo de Wilson)
//   3. MÉTODO Y DISTANCIA — ¿su reparto KO/sumisión/decisión se parece al real?
'use strict';

const fs = require('fs');
const path = require('path');
const PH = require('../combat-engine/phases');
const SY = require('../combat-engine/style');
const FS = require('../combat-engine/fightsim');
const M = require('../basketball-engine/metrics');       // las métricas son agnósticas del deporte

const DIR = path.join(__dirname, '..', 'data', 'combat');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);

function run(org = 'ufc', { block = 120, minPrior = 1500, sims = 4000, verbose = true } = {}) {
  const raw = rd(`fights-${org}.json`);
  const fights = Array.isArray(raw) ? raw : (raw && raw.fights) || [];
  const stats = (rd(`espnstats-${org}.json`) || {}).stats || {};
  const done = fights.filter((f) => f && f.completed && f.f1 && f.f2 && stats[String(f.comp_id)])
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (done.length < minPrior + block) return { error: `muestra insuficiente (${done.length})` };

  const rows = [], methodRows = [];
  let built = 0;
  for (let start = minPrior; start < done.length; start += block) {
    const prior = done.slice(0, start);
    // el estado se construye con TODO lo anterior y nada más
    const B = PH.buildProfiles(prior, stats, { now: Date.parse(done[start].date) });
    const V = SY.styleVectors(B.profiles);
    built++;
    for (const f of done.slice(start, start + block)) {
      const a = String(f.f1.id), b = String(f.f2.id);
      const pa = B.profiles.get(a), pb = B.profiles.get(b);
      if (!pa || !pb || !pa.striking || !pb.striking) continue;
      if (pa.striking.sample.fights < 3 || pb.striking.sample.fights < 3) continue;
      const rounds = Number(f.rounds_sched) || 3;
      let S = null;
      try { S = FS.simulate(pa, pb, { rounds, n: sims, sa: V.get(a), sb: V.get(b) }); } catch { S = null; }
      if (!S) continue;
      const won = f.f1.winner ? 1 : (f.f2.winner ? 0 : null);
      if (won == null) continue;
      rows.push({ p: S.win.a, y: won, date: f.date, rounds });
      const meth = String((f.method || {}).name || '').toLowerCase();
      const real = /ko|tko/.test(meth) ? 'ko' : /sub/.test(meth) ? 'sub' : /dec/.test(meth) ? 'dec' : 'otro';
      if (real !== 'otro') {
        methodRows.push({
          real, went_distance: real === 'dec' ? 1 : 0,
          p_ko: S.method.a_ko + S.method.b_ko, p_sub: S.method.a_sub + S.method.b_sub, p_dec: S.method.a_dec + S.method.b_dec,
          p_dist: S.distance.prob, end_round: f.end_round || null, p_r1: S.round_of_finish[0] ? S.round_of_finish[0].any : null,
        });
      }
    }
    if (verbose) process.stderr.write(`  bloque ${built} · ${rows.length} peleas evaluadas\r`);
  }
  if (rows.length < 50) return { error: `pocas peleas evaluables (${rows.length})` };

  const cal = M.calibration(rows, { bins: 8, minN: 20 });
  const acc = rows.filter((r) => (r.p >= 0.5) === !!r.y).length / rows.length;
  // línea base: predecir siempre al favorito del propio modelo no vale; la base honesta es 50%
  const base = rows.map((r) => ({ p: 0.5, y: r.y }));

  // ¿ACIERTA EL REPARTO DE MÉTODO? Se compara la probabilidad media que dio el modelo contra la frecuencia
  // real. Un modelo que dice "30% KO" y acierta el 30% de KO está bien calibrado en método.
  const mAgg = (key, real) => {
    const n = methodRows.length;
    if (!n) return null;
    const pred = methodRows.reduce((s, r) => s + r[key], 0) / n;
    const obs = methodRows.filter((r) => r.real === real).length / n;
    return { predicted_pct: r3(100 * pred), actual_pct: r3(100 * obs), n, gap_pp: r3(100 * (pred - obs)) };
  };
  const distAgg = (() => {
    const n = methodRows.length; if (!n) return null;
    const pred = methodRows.reduce((s, r) => s + r.p_dist, 0) / n;
    const obs = methodRows.filter((r) => r.went_distance).length / n;
    return { predicted_pct: r3(100 * pred), actual_pct: r3(100 * obs), n, gap_pp: r3(100 * (pred - obs)) };
  })();

  return {
    org, method: 'ventana móvil por bloques: los perfiles de cada pelea se construyen solo con peleas anteriores',
    blocks: built, block_size: block, sims,
    n: rows.length, dataset: done.length,
    discrimination: {
      brier: M.brier(rows), brier_baseline_50: M.brier(base),
      skill_vs_coin: r3((M.brier(base) - M.brier(rows))),
      log_loss: M.logLoss(rows), accuracy_pct: r3(100 * acc),
      sharpness: M.sharpness(rows),
    },
    calibration: { ece_pp: cal.ece_pp, miscalibrated_bins: cal.bins.filter((b) => !b.ok).length, bins: cal.bins },
    method_check: { ko: mAgg('p_ko', 'ko'), submission: mAgg('p_sub', 'sub'), decision: mAgg('p_dec', 'dec'), distance: distAgg },
    murphy: M.murphy(rows),
    caveat: 'sin histórico de cuotas de combate no se puede medir ROI ni ventaja contra el mercado: esto solo dice si el modelo distingue y si sus números están bien puestos',
  };
}

if (require.main === module) {
  const org = process.argv[2] || 'ufc';
  console.log(JSON.stringify(run(org, { block: Number(process.argv[3]) || 120 }), null, 1));
}
module.exports = { run };
