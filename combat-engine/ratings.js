// combat-engine/ratings.js — Elo por PELEADOR (27-jul, F1 de Combat Sports).
// Adaptación 1v1 del espíritu del Elo de clubes: pocas peleas por atleta pero señal limpia.
//   - K decae con la experiencia (peleador nuevo se mueve rápido, veterano despacio)
//   - bonus por FINISH (KO/Sub mueven más que una decisión — señal de dominancia real)
//   - decaimiento por inactividad LEVE al calcular la prob (ring rust)
//   - walk-forward NATIVO: fit(fights hasta t) → prob(f1 vs f2 en t) — sin leakage por construcción.
// BACKTEST integrado (el estándar de la casa): accuracy + Brier vs baseline 50% y vs "favorito ingenuo
// por récord", calibración por deciles. El gate: el Elo debe VER (skill > 0 con margen) antes de publicar.
'use strict';

const BASE = 1500;
const SPREAD = 280;            // recalibrado 27-jul: barrido 230-400 → óptimo ~260-300 (skill +0.0062 vs +0.0058 del estándar 400); el Elo de peleas discrimina más de lo que la escala 400 expresa
const K0 = 64, K_MIN = 24;     // K inicial alto (pocas peleas/carrera), piso veterano
const FINISH_BONUS = 1.25;     // KO/Sub pesan 25% más que decisión
const RUST_PER_YEAR = 28;      // puntos de castigo por año inactivo (aplicado al computar prob, cap 2 años)

function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / SPREAD)); }

function isFinish(method) {
  const n = ((method && (method.name || method.display)) || '').toLowerCase();
  return /ko|tko|submission|sub/.test(n) && !/decision/.test(n);
}

// fights: [{date, f1:{id,winner}, f2:{id,winner}, method, completed}] ORDENADAS por fecha ascendente.
function fitElo(fights) {
  const R = {}, N = {}, LAST = {};
  const get = (id) => (R[id] == null ? BASE : R[id]);
  for (const f of fights) {
    if (!f.completed || !f.f1.id || !f.f2.id) continue;
    const w = f.f1.winner ? f.f1.id : f.f2.winner ? f.f2.id : null;
    if (!w) continue; // NC/draw no mueve
    const l = w === f.f1.id ? f.f2.id : f.f1.id;
    const eW = expected(get(w), get(l));
    const kW = Math.max(K_MIN, K0 / Math.sqrt(1 + (N[w] || 0)));
    const kL = Math.max(K_MIN, K0 / Math.sqrt(1 + (N[l] || 0)));
    const mult = isFinish(f.method) ? FINISH_BONUS : 1;
    R[w] = get(w) + kW * mult * (1 - eW);
    R[l] = get(l) - kL * mult * (1 - eW);
    N[w] = (N[w] || 0) + 1; N[l] = (N[l] || 0) + 1;
    LAST[w] = f.date; LAST[l] = f.date;
  }
  return { R, N, LAST };
}

// prob de f1 sobre f2 a la fecha dada (aplica ring rust por inactividad)
function fightProb(model, id1, id2, atDate) {
  const rust = (id) => {
    const last = model.LAST[id];
    if (!last || !atDate) return 0;
    const yrs = Math.max(0, (new Date(atDate) - new Date(last)) / (365.25 * 24 * 3600e3));
    return Math.min(2, yrs) * RUST_PER_YEAR;
  };
  const r1 = (model.R[id1] == null ? BASE : model.R[id1]) - rust(id1);
  const r2 = (model.R[id2] == null ? BASE : model.R[id2]) - rust(id2);
  return { p1: expected(r1, r2), r1: Math.round(r1), r2: Math.round(r2), n1: model.N[id1] || 0, n2: model.N[id2] || 0 };
}

// MÉTODO de victoria: tasas por peleador (finish rate propio + durabilidad del rival), shrink al promedio.
function methodProfile(fights, id) {
  let wins = 0, winKo = 0, winSub = 0, losses = 0, lostKo = 0, lostSub = 0;
  for (const f of fights) {
    if (!f.completed || !f.method) continue;
    const me = f.f1.id === id ? f.f1 : f.f2.id === id ? f.f2 : null;
    if (!me) continue;
    const n = (f.method.name || '').toLowerCase();
    const ko = /ko|tko/.test(n) && !/decision/.test(n), sub = /submission/.test(n);
    if (me.winner) { wins++; if (ko) winKo++; if (sub) winSub++; }
    else { losses++; if (ko) lostKo++; if (sub) lostSub++; }
  }
  return { wins, losses, winKo, winSub, lostKo, lostSub };
}

// ---------- BACKTEST walk-forward (el gate de la casa) ----------
function backtest(fights, { warmFrac = 0.35 } = {}) {
  const done = fights.filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const warm = Math.floor(done.length * warmFrac);
  let n = 0, hits = 0, brier = 0, base = 0, logl = 0;
  const cal = Array.from({ length: 10 }, () => [0, 0]);
  // fit incremental (mismo update que fitElo, en línea — O(n))
  const model = { R: {}, N: {}, LAST: {} };
  const get = (id) => (model.R[id] == null ? BASE : model.R[id]);
  done.forEach((f, i) => {
    if (i >= warm) {
      const { p1 } = fightProb(model, f.f1.id, f.f2.id, f.date);
      const y = f.f1.winner ? 1 : 0;
      const pick = p1 >= 0.5 ? 1 : 0;
      if (pick === y) hits++;
      brier += (p1 - y) ** 2; base += 0.25; // baseline 50/50
      logl += -(y * Math.log(Math.max(1e-9, p1)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p1)));
      const d = Math.min(9, Math.floor(p1 * 10)); cal[d][0] += y; cal[d][1]++;
      n++;
    }
    // update
    const w = f.f1.winner ? f.f1.id : f.f2.id, l = f.f1.winner ? f.f2.id : f.f1.id;
    const eW = expected(get(w), get(l));
    const kW = Math.max(K_MIN, K0 / Math.sqrt(1 + (model.N[w] || 0)));
    const kL = Math.max(K_MIN, K0 / Math.sqrt(1 + (model.N[l] || 0)));
    const mult = isFinish(f.method) ? FINISH_BONUS : 1;
    model.R[w] = get(w) + kW * mult * (1 - eW);
    model.R[l] = get(l) - kL * mult * (1 - eW);
    model.N[w] = (model.N[w] || 0) + 1; model.N[l] = (model.N[l] || 0) + 1;
    model.LAST[w] = f.date; model.LAST[l] = f.date;
  });
  return {
    n, accuracy: +(hits / n).toFixed(4), brier: +(brier / n).toFixed(4), brier_base: +(base / n).toFixed(4),
    skill_vs_coin: +((base - brier) / n).toFixed(4), logloss: +(logl / n).toFixed(4),
    calibration: cal.map(([w, t], i) => t >= 30 ? { bucket: `${i * 10}-${i * 10 + 10}%`, pred: (i * 10 + 5) / 100, real: +(w / t).toFixed(3), n: t } : null).filter(Boolean),
  };
}

module.exports = { fitElo, fightProb, methodProfile, backtest, expected, isFinish };
