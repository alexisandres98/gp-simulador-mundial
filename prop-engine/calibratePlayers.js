// prop-engine/calibratePlayers.js — Backtest ROLLING-ORIGIN de props de jugador sobre el Mundial.
// Para cada partido en orden temporal: se ajusta fitPlayers SOLO con los partidos ANTERIORES (sin leakage,
// como en producción) y se evalúa a los jugadores que realmente jugaron, CONDICIONADO a sus minutos reales
// (la habilidad que medimos es la TASA, no la proyección de minutos; el mercado de goleador es void si no juega).
// Familias: ANYTIME_GOAL, SHOTS O1.5, SOT O0.5. Baseline: prior de POSICIÓN puro (sin identidad del jugador)
// → skill = cuánta señal agrega conocer al jugador. Gates: mismos umbrales del goal engine.
'use strict';
const { fitPlayers, projectPlayer, POS_PRIOR } = require('./players');

const GATE = { MIN_SAMPLE: 40, MAX_BRIER: 0.25, MAX_CAL_ERR: 0.06 };
const WARMUP_MATCHES = 24; // primeras jornadas solo alimentan el fit (sin señal de jugador todavía)

function backtestPlayers(matches, opts = {}) {
  const ordered = matches.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const fams = { anytime_goal: [], shots_o15: [], sot_o05: [] };
  const base = { anytime_goal: [], shots_o15: [], sot_o05: [] };
  let evaluated = 0;
  for (let i = WARMUP_MATCHES; i < ordered.length; i++) {
    const m = ordered[i];
    const F = fitPlayers(ordered.slice(0, i), opts);
    for (const p of m.players) {
      if (!p.min || p.min < 20) continue;               // cameos: ruido puro
      const proj = projectPlayer(F, p.pid, { minutesOverride: p.min });
      if (!proj) continue;
      evaluated++;
      fams.anytime_goal.push({ p: proj.anytime_goal, hit: p.goals > 0 ? 1 : 0 });
      fams.shots_o15.push({ p: proj.shots_over_1_5, hit: p.shots > 1.5 ? 1 : 0 });
      fams.sot_o05.push({ p: proj.sot_over_0_5, hit: p.sot > 0.5 ? 1 : 0 });
      // baseline: prior de posición con los mismos minutos
      const pr = POS_PRIOR[p.pos] || POS_PRIOR.M;
      const frac = p.min / 90;
      base.anytime_goal.push({ p: 1 - Math.exp(-pr.xg90 * frac), hit: p.goals > 0 ? 1 : 0 });
      const nb = require('../goal-engine/negativeBinomial').nbPmf;
      const over = (mu, line) => { let u = 0; for (let k = 0; k <= Math.floor(line); k++) u += nb(mu, 6, k); return 1 - u; };
      base.shots_o15.push({ p: over(pr.shots90 * frac, 1.5), hit: p.shots > 1.5 ? 1 : 0 });
      base.sot_o05.push({ p: over(pr.sot90 * frac, 0.5), hit: p.sot > 0.5 ? 1 : 0 });
    }
  }
  const metric = arr => {
    const brier = arr.reduce((x, y) => x + (y.p - y.hit) * (y.p - y.hit), 0) / arr.length;
    const calErr = Math.abs(arr.reduce((x, y) => x + y.p, 0) / arr.length - arr.reduce((x, y) => x + y.hit, 0) / arr.length);
    return { n: arr.length, brier: +brier.toFixed(4), cal_err: +calErr.toFixed(4) };
  };
  const families = {};
  for (const f in fams) {
    const mm = metric(fams[f]), bb = metric(base[f]);
    const ok = mm.n >= GATE.MIN_SAMPLE && mm.brier <= GATE.MAX_BRIER && mm.cal_err <= GATE.MAX_CAL_ERR;
    families[f] = { ...mm, brier_baseline: bb.brier, skill_vs_baseline: +(bb.brier - mm.brier).toFixed(4), status: ok ? 'approved' : 'shadow' };
  }
  return { evaluated, warmup_matches: WARMUP_MATCHES, families, gate: GATE };
}

module.exports = { backtestPlayers, GATE, WARMUP_MATCHES };
