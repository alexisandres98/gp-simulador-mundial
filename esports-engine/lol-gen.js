// esports-engine/lol-gen.js — KILLS DE LoL COMO PROCESO GENERATIVO MEDIDO EN LA BASE PROPIA (9-sep)
//
// Qué es. El modelo de kills que publica la casa (`lol.js: killsModel`) tiene la cadena correcta —fuerza →
// ritmo → duración → kills— pero sus constantes son de PERFIL: un kpm por circuito escrito a mano (LCK 0,62
// cuando la base mide 0,90), una dispersión uniforme inventada (0,86-1,16) y un reparto lineal con pMap. La
// autopsia del 2-sep lo midió: 20-30 pp de sobreconfianza y peso del modelo c = −0,65. Y prescribió esto:
// "una distribución de kills calibrada en la base propia: media y varianza por LIGA y PARCHE, no por equipo".
//
// Qué hace este módulo. Con las 97.588 partidas propias (kills por lado y duración en TODAS) ajusta por celda
// liga × parche mayor, con encogimiento hacia la liga y hacia el circuito:
//   · el reparto de kills del ganador (media y sd) → de ahí sale el desequilibrio d = |reparto − ½|
//   · log-duración y log-ritmo (kills/min) como función lineal de d (una paliza es más corta y más rápida:
//     ese ACOPLE es lo que separa esto de un promedio plano) con residuos correlados
//   · kills = Poisson(ritmo × duración) → total, por equipo, margen. Histogramas para cualquier línea.
// Es DISPLAY/SOMBRA: nada de esto toca `lol.js` ni la familia congelada `lol_kills_hcp_v1`. Vive en su sombra
// (`lol-gen-shadow.js`) con incertidumbre de nacimiento por tamaño de celda, igual que tenis de mesa.
'use strict';

const C = require('./core');

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);

const majorPatch = (p) => { const m = String(p == null ? '' : p).match(/^(\d+)\.(\d+)/); return m ? m[1] + '.' + m[2] : null; };
const leagueKey = (page) => String(page || '').split('/')[0].trim();
const dayMs = 864e5;
const parseAt = (s) => Date.parse(String(s || '').replace(' ', 'T') + (String(s || '').includes('Z') || String(s || '').includes('T') ? '' : 'Z'));

// Constantes congeladas del ajuste (scripts/lol-gen-fit.js las valida; cambiarlas sin re-validar es mentir)
const CONST = {
  version: 'lol-gen-1',
  window_days: 365,        // ventana de la celda liga×parche
  league_days: 240,        // ventana de la liga (sin parche)
  shrink_k: 30,            // partidas de prior: celda → liga → circuito
  min_cell: 8,             // por debajo, la celda no aporta (todo prior)
  recent_days: 60,         // ventana del centro reciente de la liga (el ritmo sube parche a parche: 120 d ya iba por detrás)
  recent_min: 25,          // partidas mínimas para corregir el centro
  recent_days_2: 120,      // ventana de respaldo
  recent_min_2: 40,
  recent_max_shift: 0.15,  // tope del desplazamiento del centro (log)
  sims: 20000,
  seed: 77,
};

// ── ESTADÍSTICOS DE UN CONJUNTO DE PARTIDAS ─────────────────────────────────────────────────────────────
// rows: [{ len, k1, k2, win, t1 }]. Devuelve los parámetros del generador.
function stats(rows) {
  const xs = [];
  for (const g of rows) {
    const k1 = +g.k1, k2 = +g.k2, len = +g.len;
    if (!(len > 8 && len < 90) || !Number.isFinite(k1) || !Number.isFinite(k2) || k1 + k2 < 2) continue;
    const tot = k1 + k2;
    const winK = g.win === g.t1 ? k1 : g.win === g.t2 ? k2 : null;
    if (winK == null) continue;
    const share = winK / tot;                      // reparto del ganador
    xs.push({ d: Math.abs(share - 0.5), share, llen: Math.log(len), lkpm: Math.log(tot / len), tot });
  }
  const n = xs.length;
  if (n < 3) return null;
  const mean = (f) => xs.reduce((s, x) => s + f(x), 0) / n;
  const mD = mean((x) => x.d), mS = mean((x) => x.share), mL = mean((x) => x.llen), mK = mean((x) => x.lkpm), mT = mean((x) => x.tot);
  const vD = mean((x) => (x.d - mD) ** 2) || 1e-9;
  const sdS = Math.sqrt(mean((x) => (x.share - mS) ** 2));
  // acople: log-duración y log-ritmo como función de la paliza d (OLS)
  const bL = mean((x) => (x.d - mD) * (x.llen - mL)) / vD;
  const bK = mean((x) => (x.d - mD) * (x.lkpm - mK)) / vD;
  const rL = xs.map((x) => x.llen - mL - bL * (x.d - mD)), rK = xs.map((x) => x.lkpm - mK - bK * (x.d - mD));
  const sL = Math.sqrt(rL.reduce((s, v) => s + v * v, 0) / n), sK = Math.sqrt(rK.reduce((s, v) => s + v * v, 0) / n);
  const rho = sL > 0 && sK > 0 ? rL.reduce((s, v, i) => s + v * rK[i], 0) / n / (sL * sK) : 0;
  const vT = mean((x) => (x.tot - mT) ** 2);
  return { n, share_win: r4(mS), share_win_sd: r4(sdS), d_mean: r4(mD), llen: r4(mL), b_len: r4(bL), sd_len: r4(sL), lkpm: r4(mK), b_kpm: r4(bK), sd_kpm: r4(sK), rho: r4(rho),
    mean_kills: r2(mT), var_kills: r2(vT), mean_min: r2(mean((x) => Math.exp(x.llen))), kpm: r3(mean((x) => Math.exp(x.lkpm))) };
}

// ── AJUSTE POR CELDAS ───────────────────────────────────────────────────────────────────────────────────
// games: filas de la base propia (lol-data.load().games). asOf: ms; solo partidas ANTES de asOf (walk-forward).
function fit(games, { asOf = Date.now(), windowDays = CONST.window_days, leagueDays = CONST.league_days } = {}) {
  const cut = asOf - windowDays * dayMs, cutL = asOf - leagueDays * dayMs;
  const cells = new Map(), leagues = new Map(), all = [];
  for (const g of games) {
    const t = parseAt(g.at); if (!(t < asOf) || !(t >= cut)) continue;
    if (g.k1 == null || g.k2 == null || !(g.len > 0)) continue;
    const lk = leagueKey(g.page), mp = majorPatch(g.patch);
    all.push(g);
    if (t >= cutL) { const L = leagues.get(lk) || []; L.push(g); leagues.set(lk, L); }
    if (mp) { const k = lk + '|' + mp; const Cc = cells.get(k) || []; Cc.push(g); cells.set(k, Cc); }
  }
  const out = { version: CONST.version, as_of: new Date(asOf).toISOString(), n_games: all.length, global: stats(all), leagues: {}, cells: {}, patches: {}, recent: {} };
  for (const [k, rows] of leagues) { const s = stats(rows); if (s) out.leagues[k] = s; }
  // el CENTRO reciente de cada liga (120 d): la validación enseñó que la ventana larga va ~1 kill por detrás
  // de la tendencia (el ritmo sube parche a parche) y las colas salían descentradas. El centro se corrige a lo
  // reciente; la FORMA (dispersión, acople, reparto) se queda con la muestra larga, que es donde hace falta n.
  const cutR = asOf - CONST.recent_days * dayMs, cutR2 = asOf - CONST.recent_days_2 * dayMs;
  for (const [k, rows] of leagues) {
    const rr = rows.filter((g) => parseAt(g.at) >= cutR && g.k1 + g.k2 >= 2);
    if (rr.length >= CONST.recent_min) { out.recent[k] = { n: rr.length, days: CONST.recent_days, mean_kills: r2(rr.reduce((s2, g) => s2 + g.k1 + g.k2, 0) / rr.length) }; continue; }
    const r2r = rows.filter((g) => parseAt(g.at) >= cutR2 && g.k1 + g.k2 >= 2);
    if (r2r.length >= CONST.recent_min_2) out.recent[k] = { n: r2r.length, days: CONST.recent_days_2, mean_kills: r2(r2r.reduce((s2, g) => s2 + g.k1 + g.k2, 0) / r2r.length) };
  }
  for (const [k, rows] of cells) { if (rows.length >= CONST.min_cell) { const s = stats(rows); if (s) out.cells[k] = s; } }
  // parche vigente: el mayor con muestra en las últimas 6 semanas
  const recent = all.filter((g) => parseAt(g.at) >= asOf - 42 * dayMs);
  for (const g of recent) { const mp = majorPatch(g.patch); if (mp) out.patches[mp] = (out.patches[mp] || 0) + 1; }
  out.current_patch = Object.entries(out.patches).filter(([, n]) => n >= 20).sort((a, b) => (+b[0].split('.')[0] - +a[0].split('.')[0]) || (+b[0].split('.')[1] - +a[0].split('.')[1]))[0];
  out.current_patch = out.current_patch ? out.current_patch[0] : null;
  return out;
}

// Encogimiento: celda → liga → circuito, con k partidas de prior en cada salto. Devuelve parámetros + n efectivo.
const P_KEYS = ['share_win', 'share_win_sd', 'd_mean', 'llen', 'b_len', 'sd_len', 'lkpm', 'b_kpm', 'sd_kpm', 'rho'];
function blend(a, b, na, k) { // a con peso na, b es el prior
  const w = na / (na + k); const o = {};
  for (const key of P_KEYS) o[key] = r4(w * (a[key] != null ? a[key] : b[key]) + (1 - w) * b[key]);
  return o;
}
function paramsFor(F, league, patch, { k = CONST.shrink_k } = {}) {
  const G = F.global; if (!G) return null;
  const L = F.leagues[league] || null;
  const cell = patch ? F.cells[league + '|' + patch] : null;
  let base = Object.fromEntries(P_KEYS.map((key) => [key, G[key]])), src = 'circuito', nEff = Math.min(G.n, 400);
  if (L) { base = blend(L, base, L.n, k); src = 'liga'; nEff = L.n; }
  if (cell) { base = blend(cell, base, cell.n, k); src = 'liga×parche'; nEff = cell.n + Math.min(L ? L.n : 0, k); }
  const rec = F.recent && F.recent[league];
  return { ...base, source: src, n_eff: Math.round(nEff), n_cell: cell ? cell.n : 0, n_league: L ? L.n : 0, mean_min_ref: (cell || L || G).mean_min, kpm_ref: (cell || L || G).kpm, recent_mean: rec ? rec.mean_kills : null, recent_n: rec ? rec.n : 0, mean_kills_ref: (cell || L || G).mean_kills };
}

// ── SIMULACIÓN ──────────────────────────────────────────────────────────────────────────────────────────
// pMapA: probabilidad de que A gane el mapa (anclada a mercado, por doctrina). Devuelve histogramas.
function normal(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function poisson(lam, rnd) {
  if (lam > 30) { const k = Math.round(lam + Math.sqrt(lam) * normal(rnd)); return Math.max(0, k); }
  const L = Math.exp(-lam); let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
}
function simulate(P, pMapA, { sims = CONST.sims, seed = CONST.seed } = {}) {
  const rnd = C.rng(seed);
  const tot = [], home = [], away = [], margin = [], mins = [];
  const rho = Math.max(-0.95, Math.min(0.95, P.rho || 0));
  for (let i = 0; i < sims; i++) {
    const aWins = rnd() < pMapA;
    let shareW = P.share_win + P.share_win_sd * normal(rnd);
    shareW = Math.max(0.5, Math.min(0.95, shareW));
    const d = shareW - 0.5;
    const z1 = normal(rnd), z2 = rho * z1 + Math.sqrt(1 - rho * rho) * normal(rnd);
    const llen = P.llen + P.b_len * (d - P.d_mean) + P.sd_len * z1;
    const lkpm = P.lkpm + P.b_kpm * (d - P.d_mean) + P.sd_kpm * z2;
    const len = Math.max(12, Math.min(75, Math.exp(llen)));
    // SIN Poisson encima: el residuo de log-ritmo se midió sobre el ritmo REALIZADO (kills/min de cada
    // partida), así que ya lleva dentro el ruido de conteo. Sumar Poisson otra vez duplicaba la varianza
    // (107 simulada contra 65 medida en LCK) y salía un modelo subconfiado. Se redondea y punto.
    const k = Math.max(2, Math.round(Math.exp(lkpm) * len));
    const shareA = aWins ? shareW : 1 - shareW;
    const kA = Math.round(k * shareA), kB = k - kA;
    tot.push(k); home.push(kA); away.push(kB); margin.push(kA - kB); mins.push(Math.round(len));
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return {
    dist: { total: C.histOf(tot), home: C.histOf(home), away: C.histOf(away), margin: C.histOf(margin) },
    mean_kills: r2(mean(tot)), sd_kills: r2(Math.sqrt(mean(tot.map((v) => (v - mean(tot)) ** 2)))), p10: q(tot, 0.1), p50: q(tot, 0.5), p90: q(tot, 0.9),
    mean_min: r2(mean(mins)), team_a_mean: r2(mean(home)), team_b_mean: r2(mean(away)), handicap_mean: r2(mean(margin)), sims,
  };
}

// Con el centro corregido a lo reciente: un piloto corto mide la media del generador y se desplaza el log-ritmo
// para que case con la media reciente de la liga (tope ±0,15 en log). Devuelve la simulación completa.
function simulateCalibrated(P, pMapA, { sims = CONST.sims, seed = CONST.seed } = {}) {
  // el objetivo del centro: la media reciente de la liga si hay muestra, si no la media aritmética de la celda/liga
  // (la forma log-normal ajustada por OLS reproduce la MEDIANA, no la media: sin esto el generador nacía ~1 kill bajo)
  const target = P.recent_mean > 0 ? P.recent_mean : P.mean_kills_ref;
  if (!(target > 0)) return simulate(P, pMapA, { sims, seed });
  const pilot = simulate(P, pMapA, { sims: Math.min(4000, sims), seed: seed + 1 });
  let shift = Math.log(target / Math.max(1, pilot.mean_kills));
  shift = Math.max(-CONST.recent_max_shift, Math.min(CONST.recent_max_shift, shift));
  const out = simulate({ ...P, lkpm: P.lkpm + shift }, pMapA, { sims, seed });
  out.center_shift = r4(shift); out.center_target = target;
  return out;
}

// ── PRECIO DE UNA LÍNEA ─────────────────────────────────────────────────────────────────────────────────
// row: { family, side, line, team } con la convención de la casa: línea del LOCAL en hándicap; team home|away.
const negHist = (h) => ({ h: Object.fromEntries(Object.entries(h.h).map(([k, p]) => [-(+k), p])), n: h.n });
function price(sim, row) {
  const D = sim.dist;
  const fam = row.family, side = row.side, line = row.line != null ? +row.line : null;
  if (fam === 'KILLS') return side === 'over' ? C.pOver(D.total, line) : C.pUnder(D.total, line);
  if (fam === 'KILLS_EQUIPO') { const h = row.team === 'home' ? D.home : row.team === 'away' ? D.away : null; if (!h) return null; return side === 'over' ? C.pOver(h, line) : C.pUnder(h, line); }
  if (fam === 'KILLS_HANDICAP') { const r = side === 'home' ? C.pHandicap(D.margin, line) : C.pHandicap(negHist(D.margin), -line); return r ? r.p : null; }
  if (fam === 'KILLS_DNB') { const r = side === 'home' ? C.pHandicap(D.margin, 0) : C.pHandicap(negHist(D.margin), 0); return r ? r.p : null; }
  return null;
}

// ── INCERTIDUMBRE DE NACIMIENTO ─────────────────────────────────────────────────────────────────────────
// La de tenis de mesa, con la muestra EFECTIVA de la celda: 100·0,28·√(2/(n+2)); n_eff 30 → 7 pp, 100 → 3,9, 300 → 2,3.
function uncPp(nEff) { return r2(100 * 0.28 * Math.sqrt(2 / (Math.max(0, nEff) + 2))); }

// ── LA PIEZA COMPLETA PARA UN CRUCE ─────────────────────────────────────────────────────────────────────
let _fitCache = null;
function fitCached(games, dataAt) {
  if (_fitCache && _fitCache.key === String(dataAt) + '|' + games.length) return _fitCache.fit;
  const f = fit(games);
  _fitCache = { key: String(dataAt) + '|' + games.length, fit: f };
  return f;
}
function analyze({ games, dataAt, league, patch = null, pMapA = 0.5, sims } = {}) {
  const F = fitCached(games, dataAt);
  const mp = patch || F.current_patch;
  const P = paramsFor(F, league, mp);
  if (!P) return null;
  const sim = simulateCalibrated(P, pMapA, { sims });
  return { version: CONST.version, league, patch: mp, params: P, sim, unc_pp: uncPp(P.n_eff), p_map_a: pMapA,
    chain: [
      { step: 'reparto del ganador', value: `${Math.round(100 * P.share_win)} % ± ${Math.round(100 * P.share_win_sd)}`, from: P.source },
      { step: 'duración', value: `${P.mean_min_ref} min de referencia, −${r2(-100 * P.b_len * 0.1)} % por cada 0,1 de paliza`, from: P.source },
      { step: 'ritmo', value: `${P.kpm_ref} kills/min, +${r2(100 * P.b_kpm * 0.1)} % por cada 0,1 de paliza`, from: P.source },
      { step: 'total esperado', value: `${sim.mean_kills} ± ${sim.sd_kills} kills`, from: 'simulación (Poisson sobre ritmo × duración)' },
    ] };
}

module.exports = { CONST, stats, fit, paramsFor, simulate, simulateCalibrated, price, uncPp, analyze, majorPatch, leagueKey, parseAt, negHist };
