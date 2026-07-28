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

// ---------- F1b→R2 (27/28-jul): features sobre el Elo ----------
// z = w.elo·logit(pElo) + Σ w_i·Δfeat_i  (antisimétrico, SIN intercepto — inmune al sesgo de orden f1/f2
// de ESPN, que lista primero al favorito 57% de las veces). Pesos fiteados ONLINE durante fitElo (se
// predice antes de actualizar = walk-forward nativo, cero leakage).
// R2 28-jul, set completo backtesteado (bootstrap P=1.000, estable por era, mejora MAYOR en era moderna):
//   UFC: skill 0.0109→0.0166, acc 58.5%→61.0% (2020-26: 61.9%) · MMA: 0.0226→0.0289, acc 64.8%.
//   Pesos típicos: age −0.62 (LA feature — coincide con toda la literatura de modelos MMA), years −0.30
//   (desgaste de carrera), chin −0.17 (KOs recibidos), streak +0.15, mileage +0.37 (minutos de jaula:
//   condicional a edad/años = calidad superviviente), reach +0.22.
//   divmove (cambio de división) NO es señal sistemática agregada → vive en la capa de INTEL, no en el λ.
const FEAT_LR = 0.01;
const FEATS = ['reach', 'exp', 'years', 'age', 'chin', 'streak', 'mileage'];
const inches = (s) => { // "75\"" → 75 ; "5' 11\"" → 71
  if (!s) return null;
  const m = String(s).match(/(\d+)'\s*(\d+)?/);
  if (m) return (+m[1]) * 12 + (+(m[2] || 0));
  const n = String(s).match(/([\d.]+)/);
  return n ? +n[1] : null;
};
const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const clockMin = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const newW = () => { const w = { elo: 1 }; for (const k of FEATS) w[k] = 0; return w; };

function featDiff(model, fighters, id1, id2, atDate) {
  const a = (fighters && fighters[id1]) || {}, b = (fighters && fighters[id2]) || {};
  const r1 = inches(a.reach_in), r2 = inches(b.reach_in);
  const yrs = (id) => {
    const first = model.FIRST && model.FIRST[id];
    return first ? Math.min(20, (new Date(atDate) - new Date(first)) / (365.25 * 24 * 3600e3)) : 0;
  };
  const ageOf = (p) => p.dob ? (new Date(atDate) - new Date(p.dob)) / (365.25 * 24 * 3600e3) : null;
  const a1 = ageOf(a), a2 = ageOf(b);
  const s3 = (id) => { const r = (model.R3 || {})[id] || []; return r.length ? r.reduce((s, x) => s + x, 0) / r.length - 0.5 : 0; };
  return {
    reach: (r1 != null && r2 != null) ? (r1 - r2) / 10 : 0,
    exp: Math.log(1 + (model.N[id1] || 0)) - Math.log(1 + (model.N[id2] || 0)),
    years: (yrs(id1) - yrs(id2)) / 5,
    age: (a1 != null && a2 != null) ? (a1 - a2) / 8 : 0,
    chin: Math.log(1 + ((model.KOL || {})[id1] || 0)) - Math.log(1 + ((model.KOL || {})[id2] || 0)),
    streak: s3(id1) - s3(id2),
    mileage: (Math.log(1 + ((model.MIN || {})[id1] || 0)) - Math.log(1 + ((model.MIN || {})[id2] || 0))) / 3,
  };
}

// fights: [{date, f1:{id,winner}, f2:{id,winner}, method, completed}] ORDENADAS por fecha ascendente.
// fighters (opcional, dict por id): activa la capa de features físicas — el modelo aprende los pesos
// online en la misma pasada y fightProb los aplica. Sin fighters → Elo puro byte-idéntico al de antes.
function fitElo(fights, fighters, { history = false } = {}) {
  const R = {}, N = {}, LAST = {}, FIRST = {}, KOL = {}, MIN = {}, R3 = {};
  const HIST = history ? {} : null; // serie de Elo por peleador (perfil/evolución): [{d,r}] tras cada pelea
  const model = { R, N, LAST, FIRST, KOL, MIN, R3, HIST, PF: fighters || null, w: fighters ? newW() : null };
  const get = (id) => (R[id] == null ? BASE : R[id]);
  for (const f of fights) {
    if (!f.completed || !f.f1.id || !f.f2.id) continue;
    const w = f.f1.winner ? f.f1.id : f.f2.winner ? f.f2.id : null;
    if (!w) continue; // NC/draw no mueve
    const l = w === f.f1.id ? f.f2.id : f.f1.id;
    if (fighters) { // SGD online de los pesos de features (predicción ANTES del update — sin leakage)
      const rust = (id) => {
        const last = LAST[id]; if (!last) return 0;
        return Math.min(2, Math.max(0, (new Date(f.date) - new Date(last)) / (365.25 * 24 * 3600e3))) * RUST_PER_YEAR;
      };
      const pElo = expected(get(f.f1.id) - rust(f.f1.id), get(f.f2.id) - rust(f.f2.id));
      const fd = featDiff(model, fighters, f.f1.id, f.f2.id, f.date);
      let z = model.w.elo * logit(pElo);
      for (const k of FEATS) z += model.w[k] * fd[k];
      const g = sigm(z) - (f.f1.winner ? 1 : 0);
      model.w.elo -= FEAT_LR * g * logit(pElo);
      for (const k of FEATS) model.w[k] -= FEAT_LR * g * fd[k];
    }
    const eW = expected(get(w), get(l));
    const kW = Math.max(K_MIN, K0 / Math.sqrt(1 + (N[w] || 0)));
    const kL = Math.max(K_MIN, K0 / Math.sqrt(1 + (N[l] || 0)));
    const mult = isFinish(f.method) ? FINISH_BONUS : 1;
    R[w] = get(w) + kW * mult * (1 - eW);
    R[l] = get(l) - kL * mult * (1 - eW);
    N[w] = (N[w] || 0) + 1; N[l] = (N[l] || 0) + 1;
    LAST[w] = f.date; LAST[l] = f.date;
    if (!FIRST[w]) FIRST[w] = f.date;
    if (!FIRST[l]) FIRST[l] = f.date;
    // auxiliares de features: KOs recibidos (chin), minutos de jaula (mileage), últimos 3 (streak)
    const mn = ((f.end_round || 3) - 1) * 5 + clockMin(f.end_clock);
    MIN[w] = (MIN[w] || 0) + mn; MIN[l] = (MIN[l] || 0) + mn;
    if (isFinish(f.method) && /ko|tko/.test(((f.method || {}).name || '').toLowerCase())) KOL[l] = (KOL[l] || 0) + 1;
    (R3[w] = R3[w] || []).push(1); if (R3[w].length > 3) R3[w].shift();
    (R3[l] = R3[l] || []).push(0); if (R3[l].length > 3) R3[l].shift();
    if (HIST) {
      (HIST[w] = HIST[w] || []).push({ d: f.date, r: Math.round(R[w]) });
      (HIST[l] = HIST[l] || []).push({ d: f.date, r: Math.round(R[l]) });
    }
  }
  return model;
}

// prob de f1 sobre f2 a la fecha dada (aplica ring rust por inactividad; si el modelo tiene
// features fiteadas — fitElo con fighters — las aplica encima del Elo)
function fightProb(model, id1, id2, atDate) {
  const rust = (id) => {
    const last = model.LAST[id];
    if (!last || !atDate) return 0;
    const yrs = Math.max(0, (new Date(atDate) - new Date(last)) / (365.25 * 24 * 3600e3));
    return Math.min(2, yrs) * RUST_PER_YEAR;
  };
  const r1 = (model.R[id1] == null ? BASE : model.R[id1]) - rust(id1);
  const r2 = (model.R[id2] == null ? BASE : model.R[id2]) - rust(id2);
  let p1 = expected(r1, r2);
  if (model.w && model.PF) {
    const fd = featDiff(model, model.PF, id1, id2, atDate || new Date().toISOString());
    let z = model.w.elo * logit(p1);
    for (const k of FEATS) z += model.w[k] * fd[k];
    p1 = sigm(z);
  }
  return { p1, r1: Math.round(r1), r2: Math.round(r2), n1: model.N[id1] || 0, n2: model.N[id2] || 0 };
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

// ---------- F1b (27-jul): MODELO DE MÉTODO (KO/Sub/Dec) + ROUNDS ----------
// P(m|pelea) = p1·P(m|gana f1) + (1−p1)·P(m|gana f2); P(m|gana x sobre y) ∝ off_x[m]·(def_y[m]/base[m])^γ
// con off/def del peleador shrunk Dirichlet (tau) a la base de su DIVISIÓN (la división manda: heavyweight
// no termina como flyweight). Rounds: P(end≤r) = P(finish)·F(r|finish,sched) con inclinación por la
// tendencia de la pareja a terminar temprano.
// Backtest walk-forward 27-jul (n=5,817): skill multiclase +0.0199 vs base de división (+0.0344 vs global),
// estable por era (2013-19 +0.017 / 2020-26 +0.021), calibración monótona. Rounds: U2.5 3R +0.0086,
// U2.5 5R +0.0144, finish +0.0081 — todo sobre la base de división. Grilla tau×γ: plateau 5-8×1 (no borde).
const METHOD_TAU = 8, METHOD_GAMMA = 1, TIMING_TAU = 10;
const M_CLASSES = ['ko', 'sub', 'dec'];
const methodClass = (m) => {
  const n = ((m && (m.name || m.display)) || '').toLowerCase();
  if (/decision/.test(n)) return 'dec';
  if (/submission|sub/.test(n)) return 'sub';
  if (/ko|tko/.test(n)) return 'ko';
  return null; // draw/NC/DQ/overturned — fuera del modelo de método
};

function methodModel(fights) {
  const W = {};            // base por división {ko,sub,dec} (prior 1)
  const OFF = {}, DEF = {}; // por peleador: victorias/derrotas por método
  const FIN = {};          // F(r|finish, rounds_sched): conteo del round de cierre (prior 1/round)
  const FT = {};           // timing por peleador: finishes en round 1 / finishes totales (como ganador)
  for (const f of fights) {
    if (!f.completed || !f.f1.id || !f.f2.id || !(f.f1.winner || f.f2.winner)) continue;
    const c = methodClass(f.method);
    if (!c) continue;
    const wk = f.weight || '?';
    W[wk] = W[wk] || { ko: 1, sub: 1, dec: 1 };
    W[wk][c]++;
    const win = f.f1.winner ? f.f1.id : f.f2.id, los = f.f1.winner ? f.f2.id : f.f1.id;
    OFF[win] = OFF[win] || {}; OFF[win][c] = (OFF[win][c] || 0) + 1;
    DEF[los] = DEF[los] || {}; DEF[los][c] = (DEF[los][c] || 0) + 1;
    const sched = f.rounds_sched >= 3 ? f.rounds_sched : 3;
    if (c !== 'dec' && f.end_round) {
      FIN[sched] = FIN[sched] || Array.from({ length: sched + 1 }, () => 1);
      FIN[sched][Math.min(sched, f.end_round)]++;
      FT[win] = FT[win] || { e: 0, n: 0 };
      FT[win].n++; if (f.end_round <= 1) FT[win].e++;
    }
  }
  return { W, OFF, DEF, FIN, FT };
}

// probs de método + rounds para una pelea próxima. p1 = prob de f1 (del Elo+features).
function methodProbs(mm, p1, id1, id2, weight, sched) {
  const base0 = mm.W[weight || '?'];
  // división sin historia → base global (suma de todas)
  let base = base0;
  if (!base) {
    base = { ko: 1, sub: 1, dec: 1 };
    for (const w of Object.values(mm.W)) for (const c of M_CLASSES) base[c] += w[c];
  }
  const tot = M_CLASSES.reduce((s, c) => s + base[c], 0);
  const b = {}; for (const c of M_CLASSES) b[c] = base[c] / tot;
  const dist = (counts) => {
    const t = M_CLASSES.reduce((s, c) => s + ((counts || {})[c] || 0), 0);
    const out = {}; for (const c of M_CLASSES) out[c] = (((counts || {})[c] || 0) + METHOD_TAU * b[c]) / (t + METHOD_TAU);
    return out;
  };
  const norm = (o) => { const s = M_CLASSES.reduce((a, c) => a + o[c], 0); for (const c of M_CLASSES) o[c] /= s; return o; };
  const mWin = (x, y) => {
    const off = dist(mm.OFF[x]), de = dist(mm.DEF[y]);
    const o = {}; for (const c of M_CLASSES) o[c] = off[c] * Math.pow(de[c] / b[c], METHOD_GAMMA);
    return norm(o);
  };
  const m1 = mWin(id1, id2), m2 = mWin(id2, id1);
  const pm = {}; for (const c of M_CLASSES) pm[c] = p1 * m1[c] + (1 - p1) * m2[c];
  const finish = pm.ko + pm.sub;
  // rounds: F(r|finish) de la base por sched + inclinación de la pareja a cerrar en el 1º
  const sc = sched >= 3 ? sched : 3;
  const fin = mm.FIN[sc] || Array.from({ length: sc + 1 }, () => 1);
  const ftot = fin.slice(1).reduce((a, x) => a + x, 0);
  const cum = []; let acc = 0;
  for (let r = 1; r <= sc; r++) { acc += fin[r] / ftot; cum[r] = acc; }
  const early = (id) => { const x = mm.FT[id] || { e: 0, n: 0 }; return (x.e + TIMING_TAU * cum[1]) / (x.n + TIMING_TAU); };
  const shift = (p1 * early(id1) + (1 - p1) * early(id2)) / cum[1];
  const rle = {}; let expR = 0, prev = 0;
  for (let r = 1; r <= sc; r++) {
    rle[r] = r === sc ? finish : finish * Math.min(0.97, cum[r] * shift); // acumulado al último = todo el finish
    expR += (rle[r] - prev) * r; prev = rle[r];
  }
  expR += (1 - finish) * sc; // decisiones consumen todos los rounds
  return {
    ko: +pm.ko.toFixed(3), sub: +pm.sub.toFixed(3), dec: +pm.dec.toFixed(3),
    finish: +finish.toFixed(3),
    r_le: Object.fromEntries(Object.entries(rle).map(([r, v]) => [r, +v.toFixed(3)])), // P(termina en round ≤ r)
    exp_rounds: +expR.toFixed(2),
    // R2c: probs ABSOLUTAS por ganador+método — el shape del mercado mma.winning_method de Cloudbet
    by_winner: {
      f1: { ko: +(p1 * m1.ko).toFixed(4), sub: +(p1 * m1.sub).toFixed(4), dec: +(p1 * m1.dec).toFixed(4) },
      f2: { ko: +((1 - p1) * m2.ko).toFixed(4), sub: +((1 - p1) * m2.sub).toFixed(4), dec: +((1 - p1) * m2.dec).toFixed(4) },
    },
  };
}

// ---------- BACKTEST walk-forward (el gate de la casa) ----------
// Con fighters: corre Elo puro y Elo+features EN LA MISMA pasada (mismas peleas out-of-sample) y reporta ambos.
function backtest(fights, { warmFrac = 0.35, fighters = null } = {}) {
  const done = fights.filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const warm = Math.floor(done.length * warmFrac);
  let n = 0, hits = 0, brier = 0, base = 0, logl = 0;
  let hitsX = 0, brierX = 0;
  const cal = Array.from({ length: 10 }, () => [0, 0]);
  // fit incremental (mismo update que fitElo, en línea — O(n))
  const model = { R: {}, N: {}, LAST: {}, FIRST: {}, KOL: {}, MIN: {}, R3: {} };
  const w = newW();
  const get = (id) => (model.R[id] == null ? BASE : model.R[id]);
  done.forEach((f, i) => {
    const rust = (id) => {
      const last = model.LAST[id]; if (!last) return 0;
      return Math.min(2, Math.max(0, (new Date(f.date) - new Date(last)) / (365.25 * 24 * 3600e3))) * RUST_PER_YEAR;
    };
    const pElo = expected(get(f.f1.id) - rust(f.f1.id), get(f.f2.id) - rust(f.f2.id));
    const fd = fighters ? featDiff(model, fighters, f.f1.id, f.f2.id, f.date) : null;
    let p1x = pElo;
    if (fighters) { let z = w.elo * logit(pElo); for (const k of FEATS) z += w[k] * fd[k]; p1x = sigm(z); }
    const y = f.f1.winner ? 1 : 0;
    if (i >= warm) {
      if ((pElo >= 0.5 ? 1 : 0) === y) hits++;
      brier += (pElo - y) ** 2; base += 0.25; // baseline 50/50
      logl += -(y * Math.log(Math.max(1e-9, pElo)) + (1 - y) * Math.log(Math.max(1e-9, 1 - pElo)));
      if ((p1x >= 0.5 ? 1 : 0) === y) hitsX++;
      brierX += (p1x - y) ** 2;
      const d = Math.min(9, Math.floor((fighters ? p1x : pElo) * 10)); cal[d][0] += y; cal[d][1]++;
      n++;
    }
    if (fighters) { // SGD de features (tras evaluar)
      const g = p1x - y;
      w.elo -= FEAT_LR * g * logit(pElo);
      for (const k of FEATS) w[k] -= FEAT_LR * g * fd[k];
    }
    // update Elo + auxiliares (mismos que fitElo)
    const win = f.f1.winner ? f.f1.id : f.f2.id, l = f.f1.winner ? f.f2.id : f.f1.id;
    const eW = expected(get(win), get(l));
    const kW = Math.max(K_MIN, K0 / Math.sqrt(1 + (model.N[win] || 0)));
    const kL = Math.max(K_MIN, K0 / Math.sqrt(1 + (model.N[l] || 0)));
    const mult = isFinish(f.method) ? FINISH_BONUS : 1;
    model.R[win] = get(win) + kW * mult * (1 - eW);
    model.R[l] = get(l) - kL * mult * (1 - eW);
    model.N[win] = (model.N[win] || 0) + 1; model.N[l] = (model.N[l] || 0) + 1;
    model.LAST[win] = f.date; model.LAST[l] = f.date;
    if (!model.FIRST[win]) model.FIRST[win] = f.date;
    if (!model.FIRST[l]) model.FIRST[l] = f.date;
    const mn = ((f.end_round || 3) - 1) * 5 + clockMin(f.end_clock);
    model.MIN[win] = (model.MIN[win] || 0) + mn; model.MIN[l] = (model.MIN[l] || 0) + mn;
    if (isFinish(f.method) && /ko|tko/.test(((f.method || {}).name || '').toLowerCase())) model.KOL[l] = (model.KOL[l] || 0) + 1;
    (model.R3[win] = model.R3[win] || []).push(1); if (model.R3[win].length > 3) model.R3[win].shift();
    (model.R3[l] = model.R3[l] || []).push(0); if (model.R3[l].length > 3) model.R3[l].shift();
  });
  const out = {
    n, accuracy: +(hits / n).toFixed(4), brier: +(brier / n).toFixed(4), brier_base: +(base / n).toFixed(4),
    skill_vs_coin: +((base - brier) / n).toFixed(4), logloss: +(logl / n).toFixed(4),
    calibration: cal.map(([cw, t], i) => t >= 30 ? { bucket: `${i * 10}-${i * 10 + 10}%`, pred: (i * 10 + 5) / 100, real: +(cw / t).toFixed(3), n: t } : null).filter(Boolean),
  };
  if (fighters) {
    out.features = {
      accuracy: +(hitsX / n).toFixed(4), brier: +(brierX / n).toFixed(4),
      skill_vs_coin: +((base - brierX) / n).toFixed(4), w: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(4)])),
    };
  }
  return out;
}

// Backtest del modelo de MÉTODO + ROUNDS (multiclase vs base de división, + O/U rounds).
function backtestMethod(fights, { warmFrac = 0.35 } = {}) {
  const usable = fights.filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner) && methodClass(f.method))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const warm = Math.floor(usable.length * warmFrac);
  const mm = { W: {}, OFF: {}, DEF: {}, FIN: {}, FT: {} };
  const model = { R: {}, N: {} };
  const get = (id) => (model.R[id] == null ? BASE : model.R[id]);
  let n = 0, briM = 0, briB = 0;
  let n25 = 0, bri25 = 0, brib25 = 0; // O/U 2.5 rounds (peleas a 3)
  usable.forEach((f, i) => {
    const c = methodClass(f.method);
    const wk = f.weight || '?';
    const sched = f.rounds_sched >= 3 ? f.rounds_sched : 3;
    if (i >= warm) {
      const p1 = expected(get(f.f1.id), get(f.f2.id));
      const pm = methodProbs(mm, p1, f.f1.id, f.f2.id, wk, sched);
      const y = { ko: 0, sub: 0, dec: 0 }; y[c] = 1;
      const bw = mm.W[wk] || { ko: 1, sub: 1, dec: 1 };
      const bt = M_CLASSES.reduce((s, x) => s + bw[x], 0);
      for (const x of M_CLASSES) { briM += (pm[x] - y[x]) ** 2; briB += (bw[x] / bt - y[x]) ** 2; }
      n++;
      if (sched === 3 && f.end_round) {
        const yU = (c !== 'dec' && f.end_round <= 2) ? 1 : 0;
        bri25 += ((pm.r_le[2] || 0) - yU) ** 2;
        // base: P(finish base división)·F(≤2|finish base)
        const fin = mm.FIN[3] || [1, 1, 1, 1];
        const ft = fin.slice(1).reduce((a, x) => a + x, 0);
        brib25 += ((1 - bw.dec / bt) * ((fin[1] + fin[2]) / ft) - yU) ** 2;
        n25++;
      }
    }
    // updates (mismos que methodModel + Elo)
    mm.W[wk] = mm.W[wk] || { ko: 1, sub: 1, dec: 1 }; mm.W[wk][c]++;
    const win = f.f1.winner ? f.f1.id : f.f2.id, los = f.f1.winner ? f.f2.id : f.f1.id;
    mm.OFF[win] = mm.OFF[win] || {}; mm.OFF[win][c] = (mm.OFF[win][c] || 0) + 1;
    mm.DEF[los] = mm.DEF[los] || {}; mm.DEF[los][c] = (mm.DEF[los][c] || 0) + 1;
    if (c !== 'dec' && f.end_round) {
      mm.FIN[sched] = mm.FIN[sched] || Array.from({ length: sched + 1 }, () => 1);
      mm.FIN[sched][Math.min(sched, f.end_round)]++;
      mm.FT[win] = mm.FT[win] || { e: 0, n: 0 }; mm.FT[win].n++; if (f.end_round <= 1) mm.FT[win].e++;
    }
    const eW = expected(get(win), get(los));
    const kW = Math.max(K_MIN, K0 / Math.sqrt(1 + (model.N[win] || 0)));
    const kL = Math.max(K_MIN, K0 / Math.sqrt(1 + (model.N[los] || 0)));
    const mult = c !== 'dec' ? FINISH_BONUS : 1;
    model.R[win] = get(win) + kW * mult * (1 - eW);
    model.R[los] = get(los) - kL * mult * (1 - eW);
    model.N[win] = (model.N[win] || 0) + 1; model.N[los] = (model.N[los] || 0) + 1;
  });
  return {
    n, brier: +(briM / n).toFixed(4), brier_division: +(briB / n).toFixed(4),
    skill_vs_division: +((briB - briM) / n).toFixed(4),
    rounds_u25_3r: { n: n25, brier: +(bri25 / n25).toFixed(4), brier_base: +(brib25 / n25).toFixed(4), skill: +((brib25 - bri25) / n25).toFixed(4) },
  };
}

module.exports = { fitElo, fightProb, methodProfile, methodModel, methodProbs, methodClass, backtest, backtestMethod, expected, isFinish };
