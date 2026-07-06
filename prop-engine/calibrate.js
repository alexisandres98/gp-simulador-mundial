// prop-engine/calibrate.js — Backtest LEAVE-ONE-OUT del prop-engine sobre el dataset del Mundial.
// PURO. Para cada partido FT: se ajusta el modelo SIN ese partido (sin leakage), se proyecta con el árbitro
// real, y se evalúan las familias contra el resultado real → Brier + error de calibración + GATE por familia
// (mismos umbrales que el goal engine: muestra≥40, Brier≤0.25, |calErr|≤0.06 → approved; si no, shadow).
// Baseline de referencia: modelo CONSTANTE de liga (misma media para todos) → mide si las fuerzas por
// equipo + árbitro agregan señal real o solo ruido.
'use strict';
const { fit, project, overProbNB } = require('./model');
const { settle } = require('./markets');

const GATE = { MIN_SAMPLE: 40, MAX_BRIER: 0.25, MAX_CAL_ERR: 0.06 };

// Familias evaluadas en el backtest (línea de referencia por familia, la más cercana a la media de liga).
const EVAL_MARKETS = [
  { family: 'corners_total', line: 8.5, key: p => ({ mu: p.corners.total, r: p.corners.r_total }), actual: a => a.corners_home + a.corners_away },
  { family: 'corners_total', line: 9.5, key: p => ({ mu: p.corners.total, r: p.corners.r_total }), actual: a => a.corners_home + a.corners_away },
  { family: 'corners_team', line: 4.5, scope: 'home', key: p => ({ mu: p.corners.home, r: p.corners.r_team }), actual: a => a.corners_home },
  { family: 'corners_team', line: 4.5, scope: 'away', key: p => ({ mu: p.corners.away, r: p.corners.r_team }), actual: a => a.corners_away },
  { family: 'cards_total', line: 2.5, key: p => ({ mu: p.cards.total, r: p.cards.r_total }), actual: a => a.cards_home + a.cards_away },
  { family: 'cards_total', line: 3.5, key: p => ({ mu: p.cards.total, r: p.cards.r_total }), actual: a => a.cards_home + a.cards_away },
];

function actualOf(m) {
  return {
    corners_home: m.home.corners, corners_away: m.away.corners,
    cards_home: (m.home.yellows || 0) + (m.home.reds || 0), cards_away: (m.away.yellows || 0) + (m.away.reds || 0),
  };
}

function backtest(matches, opts = {}) {
  const ft = matches.filter(m => !m.et && m.home.corners != null && m.away.corners != null);
  const byFam = {};   // family|line → { preds:[{p, hit}], baseline:[{p, hit}] }
  const fullFit = fit(ft, opts); // para el baseline de liga (constante, sin equipos → no hay leakage relevante)
  for (let i = 0; i < ft.length; i++) {
    const m = ft[i];
    const rest = ft.slice(0, i).concat(ft.slice(i + 1));
    const f = fit(rest, opts);
    const proj = project(f, { home: m.home.code, away: m.away.code, referee: m.referee });
    const act = actualOf(m);
    for (const em of EVAL_MARKETS) {
      const { mu, r } = em.key(proj);
      const pOver = overProbNB(mu, r, em.line);
      const hit = em.actual(act) > em.line ? 1 : 0;
      // baseline: media de liga (mismas r), sin fuerzas de equipo ni árbitro
      const base = (() => {
        const L = fullFit.league;
        if (em.family === 'corners_total') return overProbNB(L.totalCornersMean, L.rCornersTotal, em.line);
        if (em.family === 'corners_team') return overProbNB(L.teamCornersMean, L.rCornersTeam, em.line);
        return overProbNB(L.totalCardsMean, L.rCardsTotal, em.line);
      })();
      const k = em.family + '|' + em.line + (em.scope ? '|' + em.scope : '');
      const slot = byFam[k] || (byFam[k] = { family: em.family, line: em.line, scope: em.scope || null, preds: [], baseline: [] });
      slot.preds.push({ p: pOver, hit });
      slot.baseline.push({ p: base, hit });
    }
  }
  // métricas + gate por familia agregada (todas las líneas de la familia juntas)
  const perLine = {};
  const famAgg = {};
  for (const k in byFam) {
    const s = byFam[k];
    const brier = arr => arr.reduce((x, y) => x + (y.p - y.hit) * (y.p - y.hit), 0) / arr.length;
    const calErr = arr => Math.abs(arr.reduce((x, y) => x + y.p, 0) / arr.length - arr.reduce((x, y) => x + y.hit, 0) / arr.length);
    perLine[k] = {
      family: s.family, line: s.line, scope: s.scope, n: s.preds.length,
      brier: +brier(s.preds).toFixed(4), brier_baseline: +brier(s.baseline).toFixed(4),
      cal_err: +calErr(s.preds).toFixed(4), hit_rate_real: +(s.preds.reduce((x, y) => x + y.hit, 0) / s.preds.length).toFixed(4),
    };
    const fa = famAgg[s.family] || (famAgg[s.family] = { preds: [], baseline: [] });
    fa.preds.push(...s.preds); fa.baseline.push(...s.baseline);
  }
  const families = {};
  for (const fam in famAgg) {
    const a = famAgg[fam];
    const brier = a.preds.reduce((x, y) => x + (y.p - y.hit) * (y.p - y.hit), 0) / a.preds.length;
    const calErr = Math.abs(a.preds.reduce((x, y) => x + y.p, 0) / a.preds.length - a.preds.reduce((x, y) => x + y.hit, 0) / a.preds.length);
    const brierBase = a.baseline.reduce((x, y) => x + (y.p - y.hit) * (y.p - y.hit), 0) / a.baseline.length;
    const ok = a.preds.length >= GATE.MIN_SAMPLE && brier <= GATE.MAX_BRIER && calErr <= GATE.MAX_CAL_ERR;
    families[fam] = {
      n: a.preds.length, brier: +brier.toFixed(4), brier_baseline: +brierBase.toFixed(4),
      skill_vs_baseline: +(brierBase - brier).toFixed(4), cal_err: +calErr.toFixed(4),
      status: ok ? 'approved' : 'shadow',
    };
  }
  return { matches_evaluated: ft.length, per_line: perLine, families, gate: GATE, league: fullFit.league };
}

module.exports = { backtest, GATE, EVAL_MARKETS, actualOf };
