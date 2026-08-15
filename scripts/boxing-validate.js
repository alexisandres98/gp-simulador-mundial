#!/usr/bin/env node
// scripts/boxing-validate.js — ¿SIRVE EL MOTOR DE BOXEO? (16-ago).
//
// MISMA DISCIPLINA QUE `combat-validate.js`, y por el mismo motivo: un motor que no se ha medido fuera de
// muestra es una opinión con formato de número. Ventana móvil ESTRICTA por bloques — para cada bloque de
// peleas, los perfiles se construyen SOLO con peleas anteriores a ese bloque. Entre reconstrucciones el
// estado es más VIEJO, nunca más nuevo: el sesgo va en nuestra contra, que es como tiene que ir.
//
// LO QUE SE MIDE, EN ORDEN DE IMPORTANCIA PARA EL NEGOCIO (y es el inverso del orden intuitivo):
//   1. ¿SE ROMPE LA PELEA? — el mercado de asaltos/método, que es donde las dos mediciones del sistema
//      dicen que hay señal. Discriminación (AUC + Brier) y calibración por decil.
//   2. ¿CUÁNDO SE ROMPE? — asalto medio predicho contra real, y la calibración de "termina antes del k".
//      Es la base literal de los totales de asaltos.
//   3. ¿CÓMO TERMINA? — el reparto KO / TKO / retirada / decisión, y los tipos de decisión.
//   4. ¿QUIÉN GANA? — el último, a propósito. Se mide SIN ancla para saber cuánto sabe este motor por sí
//      solo; en producción el ganador va anclado al Elo. Si aquí sale peor que una moneda, el anclaje
//      está justificado y no es una excusa.
//
// LO QUE NO SE PUEDE MEDIR: ROI. No hay histórico de cuotas de boxeo. Ninguna línea de este archivo
// pretende decir si esto gana dinero.
'use strict';

const fs = require('fs');
const path = require('path');
const BX = require('../combat-engine/boxing');
const M = require('../basketball-engine/metrics');       // las métricas son agnósticas del deporte

const DIR = path.join(__dirname, '..', 'data', 'combat');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// AUC por suma de rangos. Es la medida honesta de "distingue" cuando la tasa base no es 50%.
function auc(rows, pk = 'p', yk = 'y') {
  const s = rows.map((r) => ({ p: r[pk], y: r[yk] })).sort((a, b) => a.p - b.p);
  const pos = s.filter((x) => x.y).length, neg = s.length - pos;
  if (!pos || !neg) return null;
  let sum = 0;
  for (let i = 0; i < s.length; i++) if (s[i].y) sum += i + 1;
  return r3((sum - pos * (pos + 1) / 2) / (pos * neg));
}
function deciles(rows, pk = 'p', yk = 'y', k = 10) {
  const s = rows.slice().sort((a, b) => a[pk] - b[pk]);
  const sz = Math.floor(s.length / k);
  const out = [];
  for (let i = 0; i < k; i++) {
    const sl = s.slice(i * sz, i === k - 1 ? s.length : (i + 1) * sz);
    if (!sl.length) continue;
    out.push({ decil: i + 1, n: sl.length,
      predicho_pct: r3(100 * sl.reduce((a, x) => a + x[pk], 0) / sl.length),
      real_pct: r3(100 * sl.filter((x) => x[yk]).length / sl.length) });
  }
  return out;
}
// ¿la calibración es monótona? Si el decil 7 tiene menos eventos reales que el 3, el orden no significa nada.
function monotone(d, key = 'real_pct') {
  let breaks = 0;
  for (let i = 1; i < d.length; i++) if (d[i][key] < d[i - 1][key]) breaks++;
  return { breaks, ok: breaks <= 2 };
}

function run({ block = 300, minPrior = 12000, sims = 3000, since = '2005', testFrom = '2016', minFights = 6, verbose = true } = {}) {
  const raw = rd('fights-boxing.json');
  const all = (raw && raw.fights) || [];
  const done = all
    .filter((f) => f && f.completed && f.f1 && f.f2 && Number(f.rounds_sched) >= 4 && BX.methodOf(f) && BX.methodOf(f) !== 'nc')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const index = rd('fighters-boxing.json') || {};
  if (done.length < minPrior + block) return { error: `muestra insuficiente (${done.length})` };
  const startIdx = Math.max(minPrior, done.findIndex((f) => String(f.date) >= testFrom));

  const win = [], stop = [], when = [], meth = [], dec = [];
  let built = 0, skippedNoProfile = 0, skippedShort = 0;

  for (let start = startIdx; start < done.length; start += block) {
    const prior = done.slice(0, start);
    const B = BX.buildProfiles(prior, { now: Date.parse(done[start].date), minDate: since, index });
    const V = BX.styleVectors(B.profiles);
    built++;
    for (const f of done.slice(start, start + block)) {
      const a = String(f.f1.id), b = String(f.f2.id);
      const pa = B.profiles.get(a), pb = B.profiles.get(b);
      if (!pa || !pb) { skippedNoProfile++; continue; }
      if (pa.sample.fights < minFights || pb.sample.fights < minFights) { skippedShort++; continue; }
      const rounds = Number(f.rounds_sched);
      let S = null;
      try {
        S = BX.simulate(pa, pb, { rounds, n: sims, va: V.get(a), vb: V.get(b), hazardShape: B.hazardShape, league: B.league });
      } catch { S = null; }
      if (!S) continue;

      const m = BX.methodOf(f);
      const isStop = m === 'ko' || m === 'tko' || m === 'rtd';
      const endR = Math.min(Number(f.end_round) || rounds, rounds);

      // 1) ¿se rompe la pelea?
      stop.push({ p: S.method.stoppage, y: isStop ? 1 : 0, rounds });
      // 2) ¿cuándo? — solo en las que efectivamente se rompieron
      if (isStop) {
        const cum = [];
        let acc = 0;
        for (const r of S.round_of_finish) { acc += r.any; cum.push(acc); }
        when.push({ real_round: endR, rounds,
          pred_round: S.round_of_finish.reduce((s, r, i) => s + r.any * (i + 1), 0) / Math.max(1e-9, S.method.stoppage),
          p_early3: (cum[2] != null ? cum[2] : acc) / Math.max(1e-9, S.method.stoppage),
          y_early3: endR <= 3 ? 1 : 0 });
      }
      // 3) ¿cómo termina?
      meth.push({ real: m === 'ko' ? 'ko' : m === 'tko' ? 'tko' : m === 'rtd' ? 'rtd' : 'dec',
        p_ko: S.method.a_ko + S.method.b_ko, p_tko: S.method.a_tko + S.method.b_tko,
        p_rtd: S.method.a_rtd + S.method.b_rtd, p_dec: S.method.a_dec + S.method.b_dec,
        p_draw: S.method.draw, is_draw: (!f.f1.winner && !f.f2.winner) ? 1 : 0 });
      if (!isStop && (m === 'ud' || m === 'sd' || m === 'md')) {
        dec.push({ real: m === 'ud' ? 'ud' : 'close',
          p_close: S.decision.split_or_majority / Math.max(1e-9, S.distance.prob) });
      }
      // 4) ¿quién gana? — SIN ancla, a propósito
      const y = f.f1.winner ? 1 : (f.f2.winner ? 0 : null);
      if (y != null) win.push({ p: S.win.a, y, date: f.date });
    }
    if (verbose) process.stderr.write(`  bloque ${built} · ${stop.length} peleas evaluadas\r`);
  }
  if (verbose) process.stderr.write('\n');
  if (stop.length < 100) return { error: `pocas peleas evaluables (${stop.length})` };

  // ---- 1) ¿SE ROMPE? -------------------------------------------------------------------------------------
  const stopD = deciles(stop);
  const stopBlock = {
    n: stop.length,
    auc: auc(stop),
    brier: M.brier(stop),
    brier_baseline: M.brier(stop.map((r) => ({ p: stop.filter((x) => x.y).length / stop.length, y: r.y }))),
    predicho_pct: r3(100 * stop.reduce((s, r) => s + r.p, 0) / stop.length),
    real_pct: r3(100 * stop.filter((r) => r.y).length / stop.length),
    deciles: stopD, monotonia: monotone(stopD),
  };
  stopBlock.gap_pp = r3(stopBlock.predicho_pct - stopBlock.real_pct);
  stopBlock.skill_vs_base = r3(stopBlock.brier_baseline - stopBlock.brier);

  // ---- 2) ¿CUÁNDO? ---------------------------------------------------------------------------------------
  const whenBlock = when.length ? (function () {
    const mp = when.reduce((s, r) => s + r.pred_round, 0) / when.length;
    const mr = when.reduce((s, r) => s + r.real_round, 0) / when.length;
    const xs = when.map((r) => r.pred_round), ys = when.map((r) => r.real_round);
    const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    const e3 = when.map((r) => ({ p: r.p_early3, y: r.y_early3 }));
    return {
      n: when.length,
      asalto_medio_predicho: r2(mp), asalto_medio_real: r2(mr), gap: r2(mp - mr),
      correlacion: r3(num / Math.sqrt(dx * dy)),
      antes_del_4: { predicho_pct: r3(100 * e3.reduce((s, r) => s + r.p, 0) / e3.length),
        real_pct: r3(100 * e3.filter((r) => r.y).length / e3.length), auc: auc(e3) },
    };
  })() : null;

  // ---- 3) ¿CÓMO? -----------------------------------------------------------------------------------------
  const agg = (key, real) => {
    const n = meth.length;
    const pred = meth.reduce((s, r) => s + r[key], 0) / n;
    const obs = meth.filter((r) => r.real === real).length / n;
    return { predicho_pct: r3(100 * pred), real_pct: r3(100 * obs), gap_pp: r3(100 * (pred - obs)) };
  };
  const methBlock = {
    n: meth.length,
    ko: agg('p_ko', 'ko'), tko: agg('p_tko', 'tko'), rtd: agg('p_rtd', 'rtd'), decision: agg('p_dec', 'dec'),
    empate: { predicho_pct: r3(100 * meth.reduce((s, r) => s + r.p_draw, 0) / meth.length),
      real_pct: r3(100 * meth.filter((r) => r.is_draw).length / meth.length) },
    tipo_de_decision: dec.length ? {
      n: dec.length,
      dividida_o_mayoritaria_predicha_pct: r3(100 * dec.reduce((s, r) => s + r.p_close, 0) / dec.length),
      dividida_o_mayoritaria_real_pct: r3(100 * dec.filter((r) => r.real === 'close').length / dec.length),
    } : null,
  };

  // ---- 4) ¿QUIÉN GANA? — sin ancla, a propósito ----------------------------------------------------------
  const cal = M.calibration(win, { bins: 8, minN: 20 });
  const winBlock = {
    n: win.length,
    brier: M.brier(win), brier_moneda: M.brier(win.map((r) => ({ p: 0.5, y: r.y }))),
    skill_vs_moneda: r3(M.brier(win.map((r) => ({ p: 0.5, y: r.y }))) - M.brier(win)),
    acierto_pct: r3(100 * win.filter((r) => (r.p >= 0.5) === !!r.y).length / win.length),
    ece_pp: cal.ece_pp, tramos_descalibrados: cal.bins.filter((b) => !b.ok).length, tramos: cal.bins.length,
    nota: 'medido SIN ancla a propósito. En producción el ganador lo fija el modelo de habilidad (Elo) y este motor solo manda en asalto, vía y tarjetas.',
  };

  return {
    deporte: 'boxeo',
    metodo: 'ventana móvil por bloques: los perfiles de cada bloque se construyen solo con peleas anteriores',
    bloques: built, tam_bloque: block, sims, desde: testFrom, min_peleas_previas: minFights,
    dataset: done.length, descartadas: { sin_perfil: skippedNoProfile, muestra_corta: skippedShort },
    '1_se_rompe_la_pelea': stopBlock,
    '2_cuando_se_rompe': whenBlock,
    '3_como_termina': methBlock,
    '4_quien_gana_sin_ancla': winBlock,
    aviso: 'sin histórico de cuotas de boxeo NO se puede medir ROI ni ventaja contra el mercado: esto solo dice si el modelo distingue y si sus números están bien puestos',
  };
}

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  console.log(JSON.stringify(run({
    block: Number(arg('block', 300)), sims: Number(arg('sims', 3000)),
    testFrom: arg('desde', '2016'), minFights: Number(arg('min', 6)),
  }), null, 1));
}
module.exports = { run };
