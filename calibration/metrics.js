// calibration/metrics.js — Fase M.3/G.6. Métricas de calibración sobre los registros del replay point-in-time.
// PURO. V1 1X2: Brier multiclase, log loss, ECE, buckets de calibración, segmentos. Goles: calibración O/U por
// línea, BTTS, RPS sobre el total, frecuencia de marcador modal, media/varianza predicha vs observada.
// Además: ajuste de una calibración versionada (búsqueda 1-D de λ que minimiza log loss sobre el 1X2 crudo).
'use strict';

const O = ['home', 'draw', 'away'];
function calibLambda(raw, L) { return { home: (1 - L) * raw.home + L / 3, draw: (1 - L) * raw.draw + L / 3, away: (1 - L) * raw.away + L / 3 }; }
function brierMulti(p, outcome) { return O.reduce((s, o) => s + Math.pow((p[o] || 0) - (o === outcome ? 1 : 0), 2), 0); }
function logLoss(p, outcome) { return -Math.log(Math.max(1e-12, p[outcome] || 0)); }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// ECE multiclase por reliability: cada partido aporta 3 puntos (uno por clase) {p_pred, hit}. Buckets de 0.1.
function ece(records, vecKey = 'probs') {
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
  let total = 0;
  for (const r of records) for (const o of O) {
    const p = r[vecKey][o] || 0; const hit = r.outcome === o ? 1 : 0;
    const bi = Math.min(9, Math.floor(p * 10)); buckets[bi].n++; buckets[bi].conf += p; buckets[bi].acc += hit; total++;
  }
  let e = 0; const table = buckets.map((b, i) => { const conf = b.n ? b.conf / b.n : 0, acc = b.n ? b.acc / b.n : 0; if (b.n) e += (b.n / total) * Math.abs(conf - acc); return { bucket: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`, n: b.n, avg_pred: +conf.toFixed(4), observed: +acc.toFixed(4) }; });
  return { ece: +e.toFixed(4), buckets: table.filter(t => t.n) };
}

function v1Metrics(records, vecKey = 'probs') {
  const n = records.length;
  const brier = mean(records.map(r => brierMulti(r[vecKey], r.outcome)));
  const ll = mean(records.map(r => logLoss(r[vecKey], r.outcome)));
  const { ece: e, buckets } = ece(records, vecKey);
  // tasas base observadas vs predichas
  const obs = { home: records.filter(r => r.outcome === 'home').length / n, draw: records.filter(r => r.outcome === 'draw').length / n, away: records.filter(r => r.outcome === 'away').length / n };
  const pred = { home: mean(records.map(r => r[vecKey].home)), draw: mean(records.map(r => r[vecKey].draw)), away: mean(records.map(r => r[vecKey].away)) };
  // favorito (clase de mayor prob) hit-rate
  const favHit = mean(records.map(r => { const fav = O.reduce((a, b) => r[vecKey][a] >= r[vecKey][b] ? a : b); return r.outcome === fav ? 1 : 0; }));
  // segmento por |elo_diff|
  const seg = (lo, hi) => { const s = records.filter(r => Math.abs(r.elo_diff) >= lo && Math.abs(r.elo_diff) < hi); return s.length ? { n: s.length, brier: +mean(s.map(r => brierMulti(r[vecKey], r.outcome))).toFixed(4), favHit: +mean(s.map(r => { const f = O.reduce((a, b) => r[vecKey][a] >= r[vecKey][b] ? a : b); return r.outcome === f ? 1 : 0; })).toFixed(3) } : { n: 0 }; };
  return {
    sample: n, brier: +brier.toFixed(4), log_loss: +ll.toFixed(4), ece: e,
    observed_base_rates: { home: +obs.home.toFixed(3), draw: +obs.draw.toFixed(3), away: +obs.away.toFixed(3) },
    predicted_avg: { home: +pred.home.toFixed(3), draw: +pred.draw.toFixed(3), away: +pred.away.toFixed(3) },
    draw_bias: +(pred.draw - obs.draw).toFixed(3), favorite_hit_rate: +favHit.toFixed(3),
    calibration_buckets: buckets,
    by_elo_diff: { even_0_60: seg(0, 60), mid_60_150: seg(60, 150), large_150_plus: seg(150, 1e9) },
  };
}

// ---------- GOLES ----------
const lineTag = l => String(l).replace('.', '_');
function goalMetrics(records, lines = [0.5, 1.5, 2.5, 3.5, 4.5]) {
  const n = records.length;
  // O/U por línea: Brier + calibración (pred avg vs frecuencia real de Over)
  const ou = {};
  for (const L of lines) {
    const preds = records.map(r => r.goal.over_under.find(x => x.line === L).over);
    const actual = records.map(r => (r.total > L ? 1 : 0));
    const brier = mean(records.map((r, i) => Math.pow(preds[i] - actual[i], 2)));
    const ll = mean(records.map((r, i) => -(actual[i] * Math.log(Math.max(1e-12, preds[i])) + (1 - actual[i]) * Math.log(Math.max(1e-12, 1 - preds[i])))));
    ou[`over_${lineTag(L)}`] = { line: L, predicted_over: +mean(preds).toFixed(3), actual_over: +mean(actual).toFixed(3), brier: +brier.toFixed(4), log_loss: +ll.toFixed(4) };
  }
  // BTTS
  const bttsPred = records.map(r => r.goal.btts.yes);
  const bttsAct = records.map(r => (r.hg >= 1 && r.ag >= 1 ? 1 : 0));
  const btts = { predicted_yes: +mean(bttsPred).toFixed(3), actual_yes: +mean(bttsAct).toFixed(3), brier: +mean(records.map((r, i) => Math.pow(bttsPred[i] - bttsAct[i], 2))).toFixed(4) };
  // RPS sobre la distribución de total de goles (CRPS discreto)
  const maxT = Math.max(...records.map(r => r.total), 8);
  const rps = mean(records.map(r => {
    let cum = 0, s = 0; for (let k = 0; k <= maxT; k++) { cum += (r.goal.total_goals_distribution[k] || 0); const obs = r.total <= k ? 1 : 0; s += Math.pow(cum - obs, 2); } return s / maxT;
  }));
  // total esperado predicho vs real; varianza PREDICHA = media de Var(total) de cada distribución (no varianza de
  // los puntos-estimados), comparable con la varianza observada de los totales reales.
  const predTot = records.map(r => r.goal.expected_total_goals), realTot = records.map(r => r.total);
  const variance = a => { const m = mean(a); return mean(a.map(x => Math.pow(x - m, 2))); };
  const distVariance = r => { const d = r.goal.total_goals_distribution; let e = 0, e2 = 0; for (const [k, p] of Object.entries(d)) { e += Number(k) * p; e2 += Number(k) * Number(k) * p; } return e2 - e * e; };
  const predVarDist = mean(records.map(distVariance));
  // marcador modal: frecuencia de cada modal + hit-rate exacto + top3
  const modalCounts = {};
  let exactHit = 0, top3Hit = 0;
  for (const r of records) {
    const modal = r.goal.top_scorelines[0].score; modalCounts[modal] = (modalCounts[modal] || 0) + 1;
    const real = `${r.hg}-${r.ag}`;
    if (modal === real) exactHit++;
    if (r.goal.top_scorelines.slice(0, 3).some(s => s.score === real)) top3Hit++;
  }
  return {
    sample: n, over_under: ou, btts, rps: +rps.toFixed(4),
    expected_total_predicted: +mean(predTot).toFixed(3), expected_total_actual: +mean(realTot).toFixed(3),
    variance_predicted_distribution: +predVarDist.toFixed(3), variance_actual: +variance(realTot).toFixed(3),
    modal_distribution: modalCounts, exact_score_hit_rate: +(exactHit / n).toFixed(3), top3_score_hit_rate: +(top3Hit / n).toFixed(3),
    avg_top1_concentration: +mean(records.map(r => r.goal.uncertainty.top1_concentration)).toFixed(3),
  };
}

// Ajuste de calibración: busca λ en [0, 0.5] que minimiza log loss sobre el 1X2 CRUDO (sin la calib actual).
function fitCalibration(records, { grid = 51 } = {}) {
  let best = { lambda: 0, log_loss: Infinity, brier: Infinity };
  for (let i = 0; i < grid; i++) {
    const L = i * (0.5 / (grid - 1));
    const recsC = records.map(r => ({ ...r, _c: calibLambda(r.raw_1x2, L) }));
    const ll = mean(recsC.map(r => logLoss(r._c, r.outcome)));
    const br = mean(recsC.map(r => brierMulti(r._c, r.outcome)));
    if (ll < best.log_loss) best = { lambda: +L.toFixed(4), log_loss: +ll.toFixed(4), brier: +br.toFixed(4) };
  }
  return best;
}

module.exports = { calibLambda, brierMulti, logLoss, ece, v1Metrics, goalMetrics, fitCalibration };
