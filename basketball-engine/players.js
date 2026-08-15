// basketball-engine/players.js — IMPACTO DE JUGADOR (RAPM) SOBRE TRAMOS (16-ago).
//
// QUÉ RESUELVE. Un rating de equipo es una media de lo que pasó con QUIENES jugaron. Si mañana falta el que
// juega 37 minutos, esa media miente y el modelo llega tarde al partido. RAPM (Regularized Adjusted
// Plus-Minus) separa el mérito: con miles de tramos de 10 jugadores, estima cuánto suma cada uno por 100
// posesiones ATAQUE y DEFENSA por separado, ajustado por compañeros y rivales.
//
// POR QUÉ REGULARIZADO. El plus-minus crudo confunde al jugador con su quinteto: el suplente que solo juega
// con titulares parece bueno. La regresión lo desenreda, pero sin castigo explota (jugadores con 40 minutos
// en toda la temporada saldrían con impactos absurdos). La cresta (ridge) encoge todo hacia cero y solo deja
// separarse a quien tiene minutos que lo sustenten. λ NO se inventa: se elige por validación cruzada.
//
// CÓMO SE RESUELVE. Gradiente conjugado SIN FORMAR X'X: cada tramo aporta 10 no-ceros, así que multiplicar
// por la matriz es recorrer tramos. Con 1.200 incógnitas y 40.000 tramos eso son milisegundos, mientras que
// montar y factorizar una matriz densa de 1.200×1.200 serían cientos de MB y segundos. Es la diferencia
// entre un modelo que se reajusta en cada partido y uno que no.
//
// PURO: entra la lista de partidos derivados, sale el rating. No toca red, disco ni db.
'use strict';

// ---- SISTEMA LINEAL ------------------------------------------------------------------------------------
// Resuelve (XᵀWX + λI)β = XᵀWy por gradiente conjugado, con X representada como lista de filas dispersas.
// rows: [{ idx:[i...], val:[v...], y, w }]
function ridgeCG(rows, n, lambda, { iters = 400, tol = 1e-8 } = {}) {
  const mul = (v) => {                                  // (XᵀWX + λI)·v
    const out = new Float64Array(n);
    for (const r of rows) {
      let dot = 0;
      for (let k = 0; k < r.idx.length; k++) dot += r.val[k] * v[r.idx[k]];
      const s = r.w * dot;
      for (let k = 0; k < r.idx.length; k++) out[r.idx[k]] += r.val[k] * s;
    }
    for (let i = 0; i < n; i++) out[i] += lambda * v[i];
    return out;
  };
  const b = new Float64Array(n);                        // XᵀWy
  for (const r of rows) {
    const s = r.w * r.y;
    for (let k = 0; k < r.idx.length; k++) b[r.idx[k]] += r.val[k] * s;
  }
  const x = new Float64Array(n);
  let rr = new Float64Array(b), p = new Float64Array(b);
  let rs = 0; for (let i = 0; i < n; i++) rs += rr[i] * rr[i];
  const rs0 = rs;
  for (let it = 0; it < iters && rs > tol * rs0; it++) {
    const ap = mul(p);
    let pap = 0; for (let i = 0; i < n; i++) pap += p[i] * ap[i];
    if (!(pap > 0)) break;
    const alpha = rs / pap;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; rr[i] -= alpha * ap[i]; }
    let rs2 = 0; for (let i = 0; i < n; i++) rs2 += rr[i] * rr[i];
    const beta = rs2 / rs; rs = rs2;
    for (let i = 0; i < n; i++) p[i] = rr[i] + beta * p[i];
  }
  return x;
}

// ---- CONSTRUCCIÓN DEL PROBLEMA ------------------------------------------------------------------------
// Cada tramo da DOS observaciones (una por ataque):
//   puntos_local/100 = media_liga + Σ off(locales) + Σ def(visitantes) + ventaja_cancha/2
//   puntos_visit/100 = media_liga + Σ off(visitantes) + Σ def(locales) − ventaja_cancha/2
// Las incógnitas son 2N: off en [0,N) y def en [N,2N). Un `def` POSITIVO significa que concede más, o sea
// que defiende peor — se invierte el signo al publicar para que "más alto = mejor" en las dos columnas.
function buildRows(games, { minPoss = 1, dropGarbage = true, halfLifeDays = 240, now = Date.now() } = {}) {
  const pid = new Map(), pinfo = [];
  const id2i = (id, meta) => {
    if (!pid.has(id)) { pid.set(id, pinfo.length); pinfo.push({ id, ...(meta || {}) }); }
    return pid.get(id);
  };
  const rows = [];
  let lgPts = 0, lgPoss = 0, nStints = 0;
  for (const g of games) {
    if (!g.stints || !g.stints.length || !g.roster) continue;
    const t = Date.parse(g.date || 0);
    const age = Number.isFinite(t) ? Math.max(0, (now - t) / 864e5) : 0;
    const w0 = Math.pow(0.5, age / halfLifeDays);        // los partidos viejos pesan menos
    const ros = g.roster.map((r) => id2i(r.id, { team: r.t }));
    for (const st of g.stints) {
      if (dropGarbage && st.g) continue;                  // la basura no describe a nadie
      const poss = st.p || 0;
      if (poss < minPoss || st.h.length !== 5 || st.a.length !== 5) continue;
      const H = st.h.map((i) => ros[i]), A = st.a.map((i) => ros[i]);
      if (H.some((x) => x == null) || A.some((x) => x == null)) continue;
      lgPts += st.ph + st.pa; lgPoss += 2 * poss; nStints++;
      const w = w0 * poss;                                // ponderar por posesiones: un tramo largo dice más
      rows.push({ _h: H, _a: A, _y: (100 * st.ph) / poss, w, home: 1 });
      rows.push({ _h: A, _a: H, _y: (100 * st.pa) / poss, w, home: -1 });
    }
  }
  const N = pinfo.length;
  const lgAvg = lgPoss > 0 ? (100 * lgPts) / lgPoss : 100;
  // materializar índices: off del equipo atacante, def del defensor, y la ventaja de cancha como columna 2N
  for (const r of rows) {
    r.idx = []; r.val = [];
    for (const i of r._h) { r.idx.push(i); r.val.push(1); }
    for (const i of r._a) { r.idx.push(N + i); r.val.push(1); }
    r.idx.push(2 * N); r.val.push(r.home * 0.5);
    r.y = r._y - lgAvg;                                   // se modela la desviación sobre la media de liga
    delete r._h; delete r._a; delete r._y;
  }
  return { rows, pinfo, N, lgAvg, nStints };
}

// ---- VALIDACIÓN CRUZADA DE λ ---------------------------------------------------------------------------
// λ manda sobre todo: pequeño = sobreajuste (cada suplente con impacto de estrella), grande = todos a cero.
// Se elige por bloques temporales: se ajusta con lo anterior y se mide en lo siguiente, que es como se va a
// usar. Elegirlo "a ojo" es lo que separa un RAPM útil de una tabla bonita.
function pickLambda(rows, n, candidates = [200, 500, 1000, 2000, 4000, 8000, 16000]) {
  const cut = Math.floor(rows.length * 0.75);
  const tr = rows.slice(0, cut), te = rows.slice(cut);
  if (!te.length) return { lambda: candidates[Math.floor(candidates.length / 2)], curve: [] };
  const curve = [];
  let best = null;
  for (const lam of candidates) {
    const beta = ridgeCG(tr, n, lam, { iters: 250 });
    let se = 0, sw = 0;
    for (const r of te) {
      let pred = 0;
      for (let k = 0; k < r.idx.length; k++) pred += r.val[k] * beta[r.idx[k]];
      se += r.w * (r.y - pred) ** 2; sw += r.w;
    }
    const rmse = Math.sqrt(se / (sw || 1));
    curve.push({ lambda: lam, rmse: +rmse.toFixed(4) });
    if (!best || rmse < best.rmse) best = { lambda: lam, rmse };
  }
  return { lambda: best.lambda, rmse: +best.rmse.toFixed(4), curve };
}

// ---- API ------------------------------------------------------------------------------------------------
function fitRAPM(games, opts = {}) {
  const built = buildRows(games, opts);
  if (!built.rows.length || built.N < 10) return null;
  const n = 2 * built.N + 1;
  const cv = opts.lambda ? { lambda: opts.lambda, curve: [] } : pickLambda(built.rows, n);
  const beta = ridgeCG(built.rows, n, cv.lambda, { iters: 600 });
  const players = {};
  // minutos y posesiones por jugador, para saber a quién creerle
  const mins = new Map(), poss = new Map();
  for (const g of games) {
    if (!g.stints || !g.roster) continue;
    for (const st of g.stints) {
      const d = (st.e - st.s) / 60, p = st.p || 0;
      for (const i of st.h.concat(st.a)) {
        const id = (g.roster[i] || {}).id; if (!id) continue;
        mins.set(id, (mins.get(id) || 0) + d); poss.set(id, (poss.get(id) || 0) + p);
      }
    }
  }
  built.pinfo.forEach((p, i) => {
    const off = beta[i], def = beta[built.N + i];
    players[p.id] = {
      id: p.id, team: p.team,
      off: +off.toFixed(3),
      def: +(-def).toFixed(3),                  // signo invertido: más alto = defiende mejor
      net: +(off - def).toFixed(3),
      min: +(mins.get(p.id) || 0).toFixed(1),
      poss: +(poss.get(p.id) || 0).toFixed(1),
    };
  });
  return {
    players, lgAvg: +built.lgAvg.toFixed(3), hca: +beta[2 * built.N].toFixed(3),
    lambda: cv.lambda, cv, n_players: built.N, n_stints: built.nStints, n_rows: built.rows.length,
    at: new Date().toISOString(),
  };
}

// ---- RATING DE EQUIPO A PARTIR DE LOS JUGADORES DISPONIBLES --------------------------------------------
// Ésta es la razón de ser del módulo: dado un reparto de minutos, el equipo es la suma ponderada de sus
// partes. Si falta el que juega 37 minutos, su impacto sale y lo reemplaza quien herede esos minutos.
// Devuelve desviaciones por 100 posesiones sobre la media de liga — la misma unidad que usa el simulador.
function teamFromMinutes(rapm, minutesMap, { replacement = -2.5 } = {}) {
  if (!rapm || !minutesMap) return null;
  let off = 0, def = 0, tot = 0, known = 0;
  for (const [pidx, mins] of Object.entries(minutesMap)) {
    const share = mins / 240;                    // 5 jugadores × 48 minutos = 240 minutos-jugador
    const p = rapm.players[pidx];
    tot += share;
    if (p) { off += share * 5 * p.off; def += share * 5 * p.def; known += share; }
    else { off += share * 5 * replacement / 2; def += share * 5 * replacement / 2; }   // desconocido = nivel de reemplazo
  }
  if (tot <= 0) return null;
  return { off: +(off / Math.max(tot, 1e-9)).toFixed(3), def: +(def / Math.max(tot, 1e-9)).toFixed(3),
    coverage: +(known / Math.max(tot, 1e-9)).toFixed(3) };
}

module.exports = { fitRAPM, teamFromMinutes, ridgeCG, buildRows, pickLambda };
