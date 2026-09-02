// H2g — calibración por deciles del modelo ACTUAL (walk-forward) y prueba de re-escalado de temperatura
// walk-forward: τ se estima con las últimas 1500 predicciones OOS ya liquidadas (Newton 1-D sobre logloss) y
// se aplica a la pelea siguiente. Pareado contra ACTUAL. Sirve para saber si la sobreconfianza que se ve en
// el libro (modelo 0,57 vs real 0,40 en sus picks) es del modelo en general o del sesgo de selección.
'use strict';
const fs = require('fs'); const path = require('path');
const REPO = '/home/user/gp-simulador-mundial'; const CE = require(path.join(REPO, 'combat-engine/ratings')); const DATA = path.join(REPO, 'data/combat');
const sigm = (z) => 1 / (1 + Math.exp(-z)); const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const rng = (() => { let a = 7; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const out = {};
for (const org of ['ufc', 'mma']) {
  const F = JSON.parse(fs.readFileSync(path.join(DATA, `fights-${org}.json`), 'utf8')); const fighters = JSON.parse(fs.readFileSync(path.join(DATA, `fighters-${org}.json`), 'utf8'));
  const fights = F.fights.filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const warm = Math.floor(fights.length * 0.35);
  const model = CE.newModel(null, {}); const W = { elo: 1 }; for (const k of CE.ALL_FEATS) W[k] = 0;
  const hist = []; // {z, y} OOS liquidadas para estimar τ
  const cal = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 })); const calE = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  const pairs = []; let tau = 1; let extremes = { n: 0, p: 0, y: 0 };
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0; const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, { sched: f.rounds_sched || 3 });
    let z = W.elo * logit(pElo); for (const k of CE.ALL_FEATS) z += W[k] * fd[k]; const p = sigm(z);
    if (i >= warm) {
      if (hist.length >= 300) { // Newton 1-D para τ sobre las últimas 1500
        const H = hist.slice(-1500); let t = tau;
        for (let it = 0; it < 8; it++) { let g = 0, h = 0; for (const r of H) { const q = sigm(t * r.z); g += (q - r.y) * r.z; h += q * (1 - q) * r.z * r.z; } if (h < 1e-9) break; t -= g / h; }
        tau = Math.max(0.3, Math.min(2, t));
      }
      const pT = sigm(tau * z);
      pairs.push([(p - y) ** 2, (pT - y) ** 2]);
      const b = Math.min(9, Math.floor(p * 10)); cal[b].n++; cal[b].p += p; cal[b].y += y;
      const bE = Math.min(9, Math.floor(pElo * 10)); calE[bE].n++; calE[bE].p += pElo; calE[bE].y += y;
      if (p >= 0.7 || p <= 0.3) { extremes.n++; extremes.p += (p >= 0.5 ? p : 1 - p); extremes.y += (p >= 0.5 ? y : 1 - y); }
      hist.push({ z, y });
    }
    const g = p - y; W.elo -= 0.01 * g * logit(pElo); for (const k of CE.ALL_FEATS) W[k] -= 0.01 * g * fd[k];
    CE.eloStep(model, f, null);
  });
  const N = pairs.length; let d = 0; for (const r of pairs) d += r[1] - r[0]; d /= N;
  let better = 0; const ds = []; for (let b = 0; b < 2000; b++) { let s = 0; for (let j = 0; j < N; j++) { const r = pairs[(rng() * N) | 0]; s += r[1] - r[0]; } s /= N; ds.push(s); if (s < 0) better++; } ds.sort((a, b) => a - b);
  out[org] = {
    n: N, tau_final: +tau.toFixed(3), brier_actual: +(pairs.reduce((s, r) => s + r[0], 0) / N).toFixed(5), brier_temperatura: +(pairs.reduce((s, r) => s + r[1], 0) / N).toFixed(5),
    dBrier_x1e4: +(d * 1e4).toFixed(2), ci95: [+(ds[50] * 1e4).toFixed(2), +(ds[1949] * 1e4).toFixed(2)], P_mejor: +(better / 2000).toFixed(3),
    calibracion_actual: cal.map((c, i) => c.n ? { bin: `${i * 10}-${i * 10 + 10}`, n: c.n, pred: +(c.p / c.n).toFixed(3), real: +(c.y / c.n).toFixed(3) } : null).filter(Boolean),
    calibracion_elo: calE.map((c, i) => c.n ? { bin: `${i * 10}-${i * 10 + 10}`, n: c.n, pred: +(c.p / c.n).toFixed(3), real: +(c.y / c.n).toFixed(3) } : null).filter(Boolean),
    extremos_p_ge_70: { n: extremes.n, pred: +(extremes.p / extremes.n).toFixed(3), real: +(extremes.y / extremes.n).toFixed(3) },
  };
  console.log(org, JSON.stringify(out[org]));
}
fs.writeFileSync(__dirname + '/h2g_result.json', JSON.stringify(out, null, 1));
