#!/usr/bin/env node
// scripts/hoops-strategy-backtest.js — ¿GANA DINERO LA ESTRATEGIA? (16-ago).
//
// LA PREGUNTA QUE CONTESTA, Y LA QUE NO. Contesta: "si hubiéramos aplicado nuestras reglas de pick durante
// toda la temporada, apostando al CIERRE, ¿cuánto habríamos ganado o perdido?". NO contesta "¿cuánto vamos
// a ganar?", porque el pasado no es una promesa y porque apostar al cierre es el peor caso posible.
//
// POR QUÉ AL CIERRE, SI ES EL PEOR CASO. Precisamente por eso. Las cuotas que guarda ESPN son las del
// cierre o muy cercanas, y el cierre es el precio más eficiente del mercado: es el que ya incorpora todo el
// dinero informado. Una estrategia que gana al cierre gana de verdad. Una que solo gana apostando temprano
// puede estar ganando por llegar antes, que es una ventaja real pero mucho más frágil.
//
// EL DISEÑO, PUNTO POR PUNTO:
//   · VENTANA MÓVIL ESTRICTA. Para cada partido, el rating se ajusta SOLO con los partidos anteriores. Se
//     reajusta cada `refit` partidos para que sea viable; entre reajustes el rating es más viejo, nunca más
//     nuevo — el sesgo va en contra nuestra, que es como debe ir.
//   · TRES ESTRATEGIAS COMPARADAS sobre exactamente los mismos partidos: el simulador base, la pila
//     completa (plantilla + contexto) y la pila mezclada con el mercado. Es la comparación que decide qué
//     debe alimentar las picks de verdad.
//   · REGLAS REALES. Los mismos umbrales por familia y las mismas compuertas que corren en producción.
//   · COSTES REALES. Hándicap y total se liquidan a −110 (1,909), que es el precio estándar; el ganador se
//     liquida a la cuota real del partido. Los empujes devuelven la apuesta.
//
// LO QUE NO SE PUEDE SIMULAR ACÁ, Y HAY QUE TENERLO PRESENTE: no hay parte de bajas histórico (el fabric
// empezó hoy), así que la capa de plantilla corre SIN ausencias — es decir, en su versión más floja. Y no
// hay varias casas por partido, así que no hay line shopping: se apuesta al único precio que hay.
'use strict';

const path = require('path');
const R = require('../basketball-engine/ratings');
const S = require('../basketball-engine/simulate');
const MD = require('../basketball-engine/model');
const PRC = require('../basketball-engine/pricing');
const GATE = require('../basketball-engine/gates');
const ST = require('../basketball-engine/store');
const ESPN = require('../data-providers/basketball/espn');

const imp = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const STD = 1.909;                       // −110, el precio estándar de hándicap y total

function run(league, { refit = 10, sims = 8000, minTrain = 60, verbose = true } = {}) {
  const C = ST.load(league);
  if (!C || !C.games.length) return { error: 'sin dataset' };
  const L = ESPN.LEAGUES[league] || {};
  const validTeams = Object.keys(C.teams || {});
  const all = C.games.filter((g) => g.home.pts != null && (g.odds || []).length && g.odds[0].hml != null)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (all.length < minTrain + 30) return { error: `muestra insuficiente (${all.length})` };

  const strategies = { base: [], stack: [], blended: [] };
  let fit = null, fitAt = -1;
  const blendW = (C.validation && C.validation.layers && C.validation.layers.blend && C.validation.layers.blend.w) || 0;

  for (let i = minTrain; i < all.length; i++) {
    const g = all[i];
    if (fitAt < 0 || i - fitAt >= refit) {
      // SOLO EL PASADO. Este es el punto entero del ejercicio.
      fit = R.fitRatings(all.slice(0, i), { validTeams: validTeams.length ? validTeams : null });
      fitAt = i;
    }
    if (!fit || !fit.off[g.home.id] || !fit.off[g.away.id]) continue;
    const o = g.odds[0];
    const ih = imp(o.hml), ia = imp(o.aml);
    const pMarketHome = ih / (ih + ia);

    // C temporal: el mismo estado pero con el rating de ese momento, para que la pila use lo que tocaba
    const Ct = { ...C, fit };

    const simBase = S.simulate(fit, String(g.home.id), String(g.away.id),
      { n: sims, seed: 13, neutral: !!g.neutral, regMin: L.minutes || 48, otMin: L.otMin || 5 });
    if (!simBase) continue;
    let simStack = null;
    try {
      simStack = MD.simulateGame(Ct, { id: g.id, league, date: g.date, neutral: !!g.neutral,
        home: { id: g.home.id }, away: { id: g.away.id } }, { L, sims, seed: 13, market: null });
    } catch { simStack = null; }
    const sims3 = { base: simBase, stack: simStack || simBase, blended: simStack || simBase };

    for (const [name, sim] of Object.entries(sims3)) {
      const useBlend = name === 'blended' && blendW > 0;
      // GANADOR
      let pH = sim.win.home;
      if (useBlend) pH = MD.blend(pH, pMarketHome, blendW);
      addBet(strategies[name], {
        family: 'moneyline', game: g, side: 'home', p: pH, pMarket: pMarketHome,
        odds: 1 / ih, won: g.home.pts > g.away.pts ? 1 : 0,
      });
      addBet(strategies[name], {
        family: 'moneyline', game: g, side: 'away', p: 1 - pH, pMarket: 1 - pMarketHome,
        odds: 1 / ia, won: g.away.pts > g.home.pts ? 1 : 0,
      });
      // HÁNDICAP (línea del local; el precio se asume estándar)
      if (o.sp != null) {
        const pa = PRC.pushAware(sim.margin_hist || [], o.sp, 'home', { kind: 'spread' });
        if (pa) {
          const margin = g.home.pts - g.away.pts;
          const cover = margin + o.sp;
          const res = Math.abs(cover) < 1e-9 ? 'push' : cover > 0 ? 'home' : 'away';
          // el mercado de hándicap se asume equilibrado a −110 → 50% sin vig
          for (const side of ['home', 'away']) {
            let p = side === 'home' ? pa.effective : 1 - pa.effective;
            if (useBlend) p = MD.blend(p, 0.5, blendW);
            addBet(strategies[name], { family: 'spread', game: g, side, p, pMarket: 0.5, odds: STD,
              won: res === 'push' ? null : (res === side ? 1 : 0), push: pa.push });
          }
        }
      }
      // TOTAL
      if (o.ou != null) {
        const pa = PRC.pushAware(sim.total_hist || [], o.ou, 'over', { kind: 'total' });
        if (pa) {
          const tot = g.home.pts + g.away.pts;
          const res = Math.abs(tot - o.ou) < 1e-9 ? 'push' : tot > o.ou ? 'over' : 'under';
          for (const side of ['over', 'under']) {
            let p = side === 'over' ? pa.effective : 1 - pa.effective;
            if (useBlend) p = MD.blend(p, 0.5, blendW);
            addBet(strategies[name], { family: 'total', game: g, side, p, pMarket: 0.5, odds: STD,
              won: res === 'push' ? null : (res === side ? 1 : 0), push: pa.push });
          }
        }
      }
    }
    if (verbose && (i - minTrain) % 100 === 0) process.stderr.write(`  ${i - minTrain}/${all.length - minTrain}\r`);
  }

  const out = { league, games_evaluated: all.length - minTrain, dataset_games: all.length, refit, sims, blend_w: blendW,
    assumptions: ['hándicap y total liquidados a −110 (1,909); el ganador a la cuota real del partido',
      'una sola casa por partido: no hay line shopping',
      'sin parte de bajas histórico: la capa de plantilla corre sin ausencias, en su versión más floja',
      'las cuotas de ESPN son de cierre o muy cercanas: es el precio más difícil de batir'],
    strategies: {} };
  for (const [name, bets] of Object.entries(strategies)) out.strategies[name] = summarize(bets);
  return out;
}

// Un candidato se guarda SIEMPRE; el filtro de si es pick se aplica al resumir, para poder barrer umbrales
// sin re-simular nada.
function addBet(arr, b) {
  const price = PRC.priceRow({ p: b.p, pushProb: b.push || 0, odds: b.odds, targetEv: 0.02 });
  if (!price) return;
  arr.push({ ...b, edge_pp: price.edge_pp, ev_pct: price.ev_pct, min_playable: price.min_playable,
    date: b.game.date, gid: b.game.id });
}

function settle(b) {
  if (b.won === null) return 0;                        // empuje: se devuelve la apuesta
  return b.won ? (b.odds - 1) : -1;
}

function summarize(bets) {
  const byFam = {};
  const out = { candidates: bets.length, families: {}, overall: null, by_edge: [], by_edge_band: [], by_month: [] };
  const picks = bets.filter((b) => {
    const F = GATE.familyOf(b.family);
    return Math.abs(b.edge_pp) >= F.min_edge_pp && b.ev_pct / 100 >= F.min_ev && b.edge_pp > 0;
  });
  const agg = (list) => {
    if (!list.length) return { n: 0 };
    const units = list.reduce((s, b) => s + settle(b), 0);
    const settled = list.filter((b) => b.won !== null);
    const w = settled.filter((b) => b.won).length;
    // ERROR ESTÁNDAR DEL ROI: sin esto, un +4% sobre 60 apuestas parece una estrategia y es una moneda.
    const rets = list.map(settle);
    const mu = rets.reduce((s, x) => s + x, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, rets.length - 1));
    const se = sd / Math.sqrt(rets.length);
    return { n: list.length, settled: settled.length, wins: w,
      win_pct: settled.length ? r2(100 * w / settled.length) : null,
      units: r2(units), roi_pct: r2(100 * units / list.length),
      roi_se_pp: r2(100 * se), t: se > 0 ? r2(mu / se) : null,
      avg_edge_pp: r2(list.reduce((s, b) => s + b.edge_pp, 0) / list.length) };
  };
  for (const b of picks) (byFam[b.family] = byFam[b.family] || []).push(b);
  for (const [f, list] of Object.entries(byFam)) out.families[f] = agg(list);
  out.overall = agg(picks);
  // barrido de umbral: ¿existe algún listón donde la cosa gane?
  for (const th of [2, 3, 4, 5, 6, 8, 10]) {
    const sel = bets.filter((b) => b.edge_pp >= th);
    if (sel.length >= 20) out.by_edge.push({ min_edge_pp: th, ...agg(sel) });
  }
  // ¿LA VENTAJA GRANDE ES MEJOR O PEOR? La lógica actual asume que más ventaja = mejor pick. Contra un
  // cierre maduro puede ser justo al revés: una diferencia de 12 puntos con el mercado casi nunca es que el
  // mercado se equivoque, es que nosotros nos equivocamos. Por eso se mide por BANDAS y no solo por umbral
  // mínimo: un umbral mínimo mezcla las ventajas sanas con las delirantes.
  const BANDS = [[2, 4], [4, 6], [6, 8], [8, 12], [12, 100]];
  out.by_edge_band = BANDS.map(([lo, hi]) => {
    const sel = bets.filter((b) => b.edge_pp >= lo && b.edge_pp < hi && b.ev_pct > 0);
    return sel.length >= 25 ? { band: `${lo}-${hi === 100 ? '+' : hi} pp`, ...agg(sel) } : null;
  }).filter(Boolean);

  // ESTABILIDAD EN EL TIEMPO (módulo 225). Una estrategia que pierde todos los meses es mala; una que gana
  // ocho y pierde uno enorme es peor, porque parece buena hasta que te arruina. Sin el desglose no se
  // distinguen.
  const byMonth = {};
  for (const b of picks) { const m = String(b.date || '').slice(0, 7); (byMonth[m] = byMonth[m] || []).push(b); }
  out.by_month = Object.entries(byMonth).sort().map(([m, list]) => ({ month: m, ...agg(list) }));

  // RECORRIDO DEL BANKROLL: la caída máxima y las rachas. Es lo que decide si una estrategia es ejecutable
  // por una persona real, no solo si su media es positiva.
  const chrono = picks.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let bank = 0, peak = 0, maxDD = 0, run = 0, worstRun = 0, bestRun = 0;
  const curve = [];
  for (const b of chrono) {
    const u = settle(b);
    bank += u; peak = Math.max(peak, bank); maxDD = Math.max(maxDD, peak - bank);
    if (u > 0) { run = run > 0 ? run + 1 : 1; bestRun = Math.max(bestRun, run); }
    else if (u < 0) { run = run < 0 ? run - 1 : -1; worstRun = Math.min(worstRun, run); }
    curve.push(+bank.toFixed(2));
  }
  out.risk = { final_units: r2(bank), peak_units: r2(peak), max_drawdown_units: r2(maxDD),
    max_drawdown_pct_of_turnover: picks.length ? r2(100 * maxDD / picks.length) : null,
    best_streak: bestRun, worst_streak: worstRun,
    curve: curve.filter((_, i) => i % Math.max(1, Math.ceil(curve.length / 40)) === 0) };

  // ¿ESTÁN BIEN PUESTAS LAS PROBABILIDADES DE LAS PICKS? Una estrategia puede perder por dos motivos muy
  // distintos: elegir mal (mala calibración) o elegir bien y pagar demasiado vig. Esto los separa.
  try {
    const M = require('../basketball-engine/metrics');
    const rows = picks.filter((b) => b.won !== null).map((b) => ({ p: b.p, y: b.won }));
    if (rows.length >= 50) {
      const cal = M.calibration(rows, { bins: 6, minN: 15 });
      out.calibration = { n: rows.length, ece_pp: cal.ece_pp, brier: M.brier(rows),
        miscalibrated_bins: cal.bins.filter((x) => !x.ok).length, bins: cal.bins,
        avg_p: r2(100 * rows.reduce((s, r) => s + r.p, 0) / rows.length),
        actual_pct: r2(100 * rows.reduce((s, r) => s + r.y, 0) / rows.length) };
    }
  } catch { /* métricas opcionales */ }
  return out;
}

if (require.main === module) {
  const lg = process.argv[2] || 'wnba';
  const res = run(lg, { refit: Number(process.argv[3]) || 10 });
  console.log(JSON.stringify(res, null, 1));
}
module.exports = { run };
