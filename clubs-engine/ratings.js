// clubs-engine/ratings.js — RATINGS ELO POR COMPETICIÓN (fase clubes, post-Mundial). PURO, sin I/O.
// El motor del Mundial corre sobre Elo de selecciones (db.elos); los clubes no tienen rating → este módulo
// lo construye desde el historial backfilleado (data/history/*.json de multi-comp-backfill). La conversión
// rating→probabilidades REUSA engine.matchProbs (misma matemática Elo→Poisson→Dixon-Coles→calibración λ)
// para que la fase de clubes herede el núcleo probado del Mundial; la calibración POR LIGA llega después
// con walk-forward + gates (NUNCA publicar picks de una liga sin gate — regla de la casa).
//
// Diseño del fit:
//  · Elo clásico secuencial (orden cronológico), base 1500.
//  · K adaptativo: ×2 durante los primeros 6 partidos de cada equipo (converge rápido desde el prior plano).
//  · Ventaja de local (hfa) AJUSTADA A LA LIGA: se resuelve iterativamente para que la media de resultado
//    esperado del local iguale a la observada (cada liga tiene su localía: MLS viaja, Sudamérica pesa).
//  · Empates cuentan 0.5 (el 1X2 fino lo pone matchProbs, no el fit).
'use strict';

const BASE_ELO = 1500;

function expectedHome(rh, ra, hfa) { return 1 / (1 + Math.pow(10, -((rh + hfa - ra) / 400))); }

// matches: [{utc, home:{id,name,goals}, away:{id,name,goals}}] — se ignoran filas sin marcador numérico.
// opts: { k (default 28), warmupGames (6), hfa0 (60), hfaIters (4) }
function fit(matches, opts = {}) {
  const K = opts.k != null ? opts.k : 28;
  const WARM = opts.warmupGames != null ? opts.warmupGames : 6;
  const rows = (matches || [])
    .filter(m => m && m.home && m.away && Number.isFinite(Number(m.home.goals)) && Number.isFinite(Number(m.away.goals)))
    .slice()
    .sort((a, b) => new Date(a.utc || 0) - new Date(b.utc || 0));

  function runPass(hfa) {
    const R = {}, games = {}, names = {};
    let expSum = 0, obsSum = 0;
    for (const m of rows) {
      const h = String(m.home.id), a = String(m.away.id);
      if (R[h] == null) { R[h] = BASE_ELO; games[h] = 0; }
      if (R[a] == null) { R[a] = BASE_ELO; games[a] = 0; }
      names[h] = m.home.name; names[a] = m.away.name;
      const exp = expectedHome(R[h], R[a], hfa);
      const hg = Number(m.home.goals), ag = Number(m.away.goals);
      const obs = hg > ag ? 1 : hg === ag ? 0.5 : 0;
      const kh = games[h] < WARM ? K * 2 : K;
      const ka = games[a] < WARM ? K * 2 : K;
      R[h] += kh * (obs - exp);
      R[a] += ka * ((1 - obs) - (1 - exp));
      games[h]++; games[a]++;
      expSum += exp; obsSum += obs;
    }
    return { R, games, names, expAvg: rows.length ? expSum / rows.length : 0.5, obsAvg: rows.length ? obsSum / rows.length : 0.5 };
  }

  // hfa iterativo: mover la ventaja de local hasta que lo esperado promedio iguale lo observado.
  let hfa = opts.hfa0 != null ? opts.hfa0 : 60;
  let pass = runPass(hfa);
  const iters = opts.hfaIters != null ? opts.hfaIters : 4;
  for (let i = 0; i < iters; i++) {
    const gap = pass.obsAvg - pass.expAvg;              // >0: la localía real pesa más de lo asumido
    if (Math.abs(gap) < 0.002) break;
    hfa = Math.max(0, Math.min(160, hfa + gap * 700));  // paso proporcional, acotado a un rango sano
    pass = runPass(hfa);
  }

  const ratings = {};
  for (const id of Object.keys(pass.R)) {
    ratings[id] = { elo: Math.round(pass.R[id]), name: pass.names[id], games: pass.games[id] };
  }
  return {
    ratings, hfa: Math.round(hfa), n_matches: rows.length,
    home_score_avg: +pass.obsAvg.toFixed(3), expected_home_avg: +pass.expAvg.toFixed(3),
  };
}

module.exports = { fit, expectedHome, BASE_ELO };
