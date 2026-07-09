// pick-engine/metrics.js — Capa quant del track record (PURA, sin I/O).
// Brier, log loss, calibración por rangos (reliability), CLV y comparación modelo-vs-mercado sobre las
// picks diarias. El server resuelve la línea de cierre desde goal_value_shadow (la serie temporal que el
// value engine ya persiste cada ciclo: la última evaluación pre-kickoff ES el cierre) y este módulo
// solo calcula. Consumido por server.js (ciclo + endpoints) y tests.

// Una pick "decidida" entra a las métricas de probabilidad: liquidada con resultado binario real.
function decided(p) {
  return p && p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS');
}

function clamp01(x, eps) { return Math.min(1 - eps, Math.max(eps, x)); }

// ── Scores de probabilidad ──────────────────────────────────────────────────────────────────────────────────
// list: [{ p: probabilidad pronosticada de la selección, hit: 1|0 }]
function brier(list) {
  if (!list.length) return null;
  return +(list.reduce((a, x) => a + (x.p - x.hit) * (x.p - x.hit), 0) / list.length).toFixed(5);
}
function logLoss(list) {
  if (!list.length) return null;
  const s = list.reduce((a, x) => {
    const p = clamp01(x.p, 1e-6);
    return a - (x.hit ? Math.log(p) : Math.log(1 - p));
  }, 0);
  return +(s / list.length).toFixed(5);
}

// Calibración por rangos: cuando el modelo dice ~60%, ¿ocurre ~60%?
const DEFAULT_EDGES = [0, 0.4, 0.5, 0.6, 0.7, 0.8, 1.000001];
function reliability(list, edges = DEFAULT_EDGES) {
  const buckets = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const inb = list.filter(x => x.p >= lo && x.p < hi);
    if (!inb.length) continue;
    const predicted = inb.reduce((a, x) => a + x.p, 0) / inb.length;
    const observed = inb.reduce((a, x) => a + x.hit, 0) / inb.length;
    buckets.push({
      range: `${Math.round(lo * 100)}-${Math.round(Math.min(hi, 1) * 100)}`,
      n: inb.length,
      predicted: +(predicted * 100).toFixed(1),
      observed: +(observed * 100).toFixed(1),
      gap_pp: +((observed - predicted) * 100).toFixed(1),
    });
  }
  return buckets;
}

// ── CLV ─────────────────────────────────────────────────────────────────────────────────────────────────────
// closing: { odds: mejor cuota al cierre|null, fair_prob: prob justa de cierre (consenso no-vig) }
// clv_pct  = cuánto mejor fue tu precio vs el mejor precio de cierre (definición clásica de CLV).
// ev_close_pp = EV de tu cuota valuada a la prob justa de CIERRE (edge que retuviste cuando el mercado cerró).
function computeClv(takenOdds, closing) {
  if (!takenOdds || !closing) return null;
  const out = { clv_pct: null, ev_close_pp: null };
  const fairOk = closing.fair_prob > 0 && closing.fair_prob < 1;
  // Guard de sanidad: si la mejor cuota de cierre contradice la prob justa de cierre por >25pp
  // (un book outlier o fila sucia en la serie), el precio de cierre no es confiable → solo EV.
  const oddsSane = closing.odds > 1 && (!fairOk || Math.abs(1 / closing.odds - closing.fair_prob) <= 0.25);
  if (oddsSane) out.clv_pct = +(((takenOdds / closing.odds) - 1) * 100).toFixed(2);
  if (fairOk) out.ev_close_pp = +(((takenOdds * closing.fair_prob) - 1) * 100).toFixed(2);
  if (out.clv_pct == null && out.ev_close_pp == null) return null;
  return out;
}

// Mapea una pick a su(s) market_id de goal_value_shadow para resolver el cierre. null = no resoluble.
function lineToken(line) { return String(line).replace('.', '_'); }
function closingMarketIds(pick) {
  if (!pick || !pick.event || !pick.event.canonical_event_id) return null;
  const f = pick.family;
  if (f === 'SOLID') {
    const sel = String(pick.selection_code || '').toUpperCase();
    if (!/^(HOME|DRAW|AWAY)$/.test(sel)) return null;
    return [{ market_id: 'MATCH_WINNER_' + sel }];
  }
  if (f === 'GOALS' || f === 'CORNERS' || f === 'CARDS' || f === 'PLAYER') {
    return pick.market_id ? [{ market_id: pick.market_id }] : null;
  }
  if (f === 'COMBO') {
    const legs = pick.legs || [];
    const out = [];
    for (const leg of legs) {
      if (leg.type === '1X2') {
        const sel = String(leg.selection || '').toUpperCase();
        if (!/^(HOME|DRAW|AWAY)$/.test(sel)) return null;
        out.push({ market_id: 'MATCH_WINNER_' + sel });
      } else if (leg.type === 'GOALS') {
        if (leg.line == null || !leg.side) return null;
        out.push({ market_id: `TOTAL_GOALS_${String(leg.side).toUpperCase()}_${lineToken(leg.line)}` });
      } else return null;
    }
    return out.length ? out : null;
  }
  return null;
}

function clvStats(picks) {
  const withClv = picks.filter(p => p && p.clv != null && p.result_code !== 'SUPERSEDED');
  if (!withClv.length) return { n: 0 };
  const vals = withClv.map(p => Number(p.clv)).sort((a, b) => a - b);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const median = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const pos = vals.filter(v => v > 0).length;
  const ev = withClv.filter(p => p.clv_ev_pp != null).map(p => Number(p.clv_ev_pp));
  return {
    n: vals.length,
    avg_pct: +avg.toFixed(2),
    median_pct: +median.toFixed(2),
    positive_rate: +(pos / vals.length).toFixed(4),
    ev_close_avg_pp: ev.length ? +(ev.reduce((a, b) => a + b, 0) / ev.length).toFixed(2) : null,
  };
}

// ── Ensamble ────────────────────────────────────────────────────────────────────────────────────────────────
// experimentFams: familias fuera del headline (mismas reglas que dailyPicksTrackRecord).
function quantMetrics(picks, { experimentFams = [] } = {}) {
  const official = picks.filter(p => p && experimentFams.indexOf(p.family) < 0 && p.result_code !== 'SUPERSEDED');
  const dec = official.filter(decided);
  const model = dec.filter(p => p.model_prob != null).map(p => ({ p: Number(p.model_prob), hit: p.result_code === 'WIN' ? 1 : 0 }));
  // Mismo set de picks valuado con la prob del MERCADO al publicar → baseline honesto para medir skill.
  const paired = dec.filter(p => p.model_prob != null && p.market_prob != null);
  const modelPaired = paired.map(p => ({ p: Number(p.model_prob), hit: p.result_code === 'WIN' ? 1 : 0 }));
  const marketPaired = paired.map(p => ({ p: Number(p.market_prob), hit: p.result_code === 'WIN' ? 1 : 0 }));
  const bModel = brier(modelPaired), bMarket = brier(marketPaired);

  const byFamily = {};
  const fams = [...new Set(official.map(p => p.family))];
  for (const f of fams) {
    const fp = official.filter(p => p.family === f);
    const fdec = fp.filter(decided).filter(p => p.model_prob != null)
      .map(p => ({ p: Number(p.model_prob), hit: p.result_code === 'WIN' ? 1 : 0 }));
    const fclv = clvStats(fp);
    if (!fdec.length && !fclv.n) continue;
    byFamily[f] = {
      n: fdec.length,
      brier: brier(fdec),
      clv_n: fclv.n || 0,
      clv_avg_pct: fclv.avg_pct != null ? fclv.avg_pct : null,
      clv_positive_rate: fclv.positive_rate != null ? fclv.positive_rate : null,
    };
  }

  return {
    sample: {
      settled: official.filter(p => p.status === 'SETTLED').length,
      decided: dec.length,
      with_model_prob: model.length,
      model_vs_market_pairs: paired.length,
      with_clv: official.filter(p => p.clv != null).length,
    },
    model: { brier: brier(model), log_loss: logLoss(model), n: model.length },
    model_vs_market: {
      n: paired.length,
      brier_model: bModel,
      brier_market: bMarket,
      log_loss_model: logLoss(modelPaired),
      log_loss_market: logLoss(marketPaired),
      // >0 = el modelo pronostica MEJOR que el consenso del mercado sobre las mismas picks.
      skill: (bModel != null && bMarket != null) ? +(bMarket - bModel).toFixed(5) : null,
    },
    calibration: reliability(model),
    clv: clvStats(official),
    by_family: byFamily,
    experiment: experimentFams.length ? quantExperiment(picks, experimentFams) : undefined,
  };
}

function quantExperiment(picks, experimentFams) {
  const exp = picks.filter(p => p && experimentFams.indexOf(p.family) >= 0 && p.result_code !== 'SUPERSEDED');
  if (!exp.length) return undefined;
  const dec = exp.filter(decided).filter(p => p.model_prob != null)
    .map(p => ({ p: Number(p.model_prob), hit: p.result_code === 'WIN' ? 1 : 0 }));
  return { n: dec.length, brier: brier(dec), clv: clvStats(exp) };
}

module.exports = { brier, logLoss, reliability, computeClv, closingMarketIds, clvStats, quantMetrics, decided };
