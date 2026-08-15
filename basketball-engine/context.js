// basketball-engine/context.js — DESCANSO, VIAJE Y ALTITUD (16-ago).
//
// LO QUE EL RATING NO PUEDE VER. Dos equipos idénticos no rinden igual si uno jugó anoche a 3.000 km. El
// rating describe la calidad; esto describe el ESTADO en el que llegan.
//
// UNA CORRECCIÓN QUE VALE LA PENA CONTAR. La media cruda decía que el equipo en back-to-back rinde 1,56
// puntos peor, y con ese número se justificó construir este módulo. Al regresarlo CONTROLANDO por la calidad
// de los equipos, el coeficiente cae a −1,03 ± 1,55 (t = −0,66): la diferencia cruda era, en buena parte,
// que a los equipos en back-to-back les tocaban rivales distintos. La conclusión no cambia —hay que medirlo—
// pero el número honesto es "no distinguible de cero en 1.264 partidos", no "1,56 puntos".
//
// LOS COEFICIENTES SE AJUSTAN, NO SE COPIAN, y pasan dos filtros antes de usarse: evidencia (|t|) y SIGNO
// esperado. Si la muestra estima que jugar anoche AYUDA, lo que aprendió es ruido y se descarta.
'use strict';

// ---- GEOGRAFÍA ------------------------------------------------------------------------------------------
// Coordenadas y altitud de las sedes. La altitud importa de verdad en Denver (1.609 m) y Salt Lake (1.288 m):
// es el único factor "físico" del calendario que la literatura mide con consistencia.
const VENUES = {
  // NBA
  ATL: [33.757, -84.396, 320], BOS: [42.366, -71.062, 43], BKN: [40.683, -73.975, 10], CHA: [35.225, -80.839, 229],
  CHI: [41.881, -87.674, 182], CLE: [41.496, -81.688, 199], DAL: [32.790, -96.810, 131], DEN: [39.749, -105.008, 1609],
  DET: [42.341, -83.055, 183], GS: [37.768, -122.388, 3], HOU: [29.751, -95.362, 15], IND: [39.764, -86.156, 218],
  LAC: [34.043, -118.267, 87], LAL: [34.043, -118.267, 87], MEM: [35.138, -90.051, 78], MIA: [25.781, -80.187, 2],
  MIL: [43.045, -87.917, 188], MIN: [44.979, -93.276, 253], NO: [29.949, -90.082, 1], NY: [40.751, -73.994, 10],
  OKC: [35.463, -97.515, 366], ORL: [28.539, -81.384, 32], PHI: [39.901, -75.172, 12], PHX: [33.446, -112.071, 331],
  POR: [45.532, -122.667, 15], SAC: [38.580, -121.500, 9], SA: [29.427, -98.437, 198], TOR: [43.643, -79.379, 76],
  UTAH: [40.768, -111.901, 1288], WSH: [38.898, -77.021, 7],
  // WNBA
  LV: [36.090, -115.183, 610], SEA: [47.622, -122.354, 34], CON: [41.491, -72.090, 27], IND2: [39.764, -86.156, 218],
  DAL2: [32.745, -97.093, 180], LA: [34.043, -118.267, 87], NYL: [40.683, -73.975, 10], PHO: [33.446, -112.071, 331],
  WAS: [38.898, -77.021, 7], CHIS: [41.851, -87.617, 180], MINL: [44.979, -93.276, 253], ATLD: [33.757, -84.396, 320],
  GSV: [37.768, -122.388, 3], TOT: [43.643, -79.379, 76], POF: [45.532, -122.667, 15],
};
const R_EARTH = 6371;
function haversine(a, b) {
  if (!a || !b) return null;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}
const venueOf = (abbr) => VENUES[String(abbr || '').toUpperCase()] || null;

// ---- ESTADO DE CALENDARIO ------------------------------------------------------------------------------
// Para cada equipo y cada partido: días de descanso, si viene de back-to-back, cuántos partidos lleva en 7
// días, y cuánto viajó desde su partido anterior. Se calcula UNA vez sobre el histórico y se consulta.
function scheduleState(games) {
  const byTeam = new Map();
  for (const g of games) {
    for (const side of ['home', 'away']) {
      const id = String(g[side].id);
      if (!byTeam.has(id)) byTeam.set(id, []);
      byTeam.get(id).push({ t: Date.parse(g.date || 0), gid: String(g.id), side, abbr: g[side].abbr, venue: g.home.abbr });
    }
  }
  const out = new Map();                                   // gid|teamId -> estado
  for (const [id, list] of byTeam) {
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i], prev = i > 0 ? list[i - 1] : null;
      const restDays = prev ? (cur.t - prev.t) / 864e5 : null;
      const in7 = list.filter((x) => x.t < cur.t && x.t >= cur.t - 7 * 864e5).length;
      const travel = prev ? haversine(venueOf(prev.venue), venueOf(cur.venue)) : 0;
      out.set(cur.gid + '|' + id, {
        rest_days: restDays == null ? null : +restDays.toFixed(2),
        b2b: restDays != null && restDays < 1.4 ? 1 : 0,
        three_in_four: list.filter((x) => x.t <= cur.t && x.t >= cur.t - 4 * 864e5).length >= 3 ? 1 : 0,
        games_last7: in7,
        travel_km: travel == null ? null : Math.round(travel),
        road: cur.side === 'away' ? 1 : 0,
        alt_m: (venueOf(cur.venue) || [0, 0, 0])[2],
      });
    }
  }
  return out;
}

// ---- AJUSTE DE LOS COEFICIENTES ------------------------------------------------------------------------
// Regresión por mínimos cuadrados del margen residual (observado − esperado por rating) sobre las
// diferencias de contexto entre local y visitante. Se devuelve el peso Y su error estándar: sin la barra de
// error, un coeficiente es una superstición con decimales.
function fitContext(games, sched, expectedMargin) {
  const X = [], Y = [];
  for (const g of games) {
    if (g.home.pts == null || g.away.pts == null) continue;
    const sh = sched.get(String(g.id) + '|' + String(g.home.id));
    const sa = sched.get(String(g.id) + '|' + String(g.away.id));
    if (!sh || !sa || sh.rest_days == null || sa.rest_days == null) continue;
    const exp = expectedMargin ? expectedMargin(g) : 0;
    if (exp == null) continue;
    const clampRest = (r) => Math.min(4, r);
    X.push([
      (sh.b2b - sa.b2b),                                   // back-to-back (diferencia)
      (clampRest(sh.rest_days) - clampRest(sa.rest_days)), // días de descanso, saturados a 4
      (sh.three_in_four - sa.three_in_four),               // 3 partidos en 4 días
      ((sa.travel_km || 0) - (sh.travel_km || 0)) / 1000,  // viaje del rival menos el propio, en miles de km
      Math.log1p(Math.max(0, (sh.alt_m || 0) - 500) / 1000) * (1 - 0),  // altitud de la sede (favorece al local)
    ]);
    Y.push((g.home.pts - g.away.pts) - exp);
  }
  if (X.length < 60) return { n: X.length, ok: false, reason: 'muestra insuficiente' };
  const k = X[0].length;
  // normales con ridge mínima para estabilidad numérica
  const A = Array.from({ length: k }, () => new Float64Array(k));
  const b = new Float64Array(k);
  for (let r = 0; r < X.length; r++) {
    for (let i = 0; i < k; i++) { b[i] += X[r][i] * Y[r]; for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j]; }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-6 * X.length;
  const beta = solve(A, b, k);
  if (!beta) return { n: X.length, ok: false, reason: 'sistema singular' };
  // error estándar: sigma² · diag((X'X)⁻¹)
  let sse = 0;
  for (let r = 0; r < X.length; r++) { let p = 0; for (let i = 0; i < k; i++) p += X[r][i] * beta[i]; sse += (Y[r] - p) ** 2; }
  const sigma2 = sse / Math.max(1, X.length - k);
  const inv = invert(A, k);
  const se = inv ? beta.map((_, i) => Math.sqrt(Math.max(0, sigma2 * inv[i][i]))) : beta.map(() => null);
  const names = ['b2b', 'rest_days', 'three_in_four', 'travel_1000km', 'altitude'];
  // SIGNO ESPERADO. No es censura: es el conocimiento del deporte puesto por delante del ruido. Jugar
  // anoche no puede AYUDAR, descansar no puede PERJUDICAR, y la altura de tu propia sede no puede volverte
  // peor en casa. Cuando la muestra estima el signo contrario, lo que aprendió es ruido o confusión con
  // otra cosa, y se descarta. Sin esta regla el ajuste devolvió altitud = −10,6 puntos (t = −3,5): con solo
  // dos sedes en altura, ese término no mide altura, mide el residuo de Denver y Utah.
  const SIGN = { b2b: -1, rest_days: +1, three_in_four: -1, travel_1000km: +1, altitude: +1 };
  const coef = {};
  names.forEach((nm, i) => {
    const t = se[i] ? beta[i] / se[i] : null;
    // ENCOGIMIENTO por evidencia: |t| < 1 no se usa, entre 1 y 2 entra a la mitad, ≥ 2 entra entero.
    const shrink = t == null ? 0 : Math.abs(t) >= 2 ? 1 : Math.abs(t) >= 1 ? 0.5 : 0;
    const signOk = SIGN[nm] == null || beta[i] === 0 || Math.sign(beta[i]) === SIGN[nm];
    coef[nm] = {
      beta: +beta[i].toFixed(4), se: se[i] != null ? +se[i].toFixed(4) : null,
      t: t != null ? +t.toFixed(2) : null,
      sign_ok: signOk,
      used: +(signOk ? beta[i] * shrink : 0).toFixed(4),
      note: signOk ? null : 'signo contrario al esperado: se descarta',
    };
  });
  return { n: X.length, ok: true, coef, rmse: +Math.sqrt(sigma2).toFixed(3) };
}
function solve(A, b, k) {
  const M = A.map((r, i) => Array.from(r).concat([b[i]]));
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < k; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r, i) => r[k] / r[i]);
}
function invert(A, k) {
  const M = A.map((r, i) => Array.from(r).concat(Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))));
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) { if (r === c) continue; const f = M[r][c]; for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(k));
}

// ---- APLICACIÓN -----------------------------------------------------------------------------------------
// Devuelve el ajuste en PUNTOS DE MARGEN a favor del local, listo para sumarse a la proyección.
function contextAdjust(fit, sh, sa) {
  if (!fit || !fit.ok || !sh || !sa) return { pts: 0, parts: [] };
  const c = fit.coef;
  const clampRest = (r) => Math.min(4, r == null ? 2 : r);
  const terms = [
    ['Back-to-back', c.b2b.used * ((sh.b2b || 0) - (sa.b2b || 0))],
    ['Días de descanso', c.rest_days.used * (clampRest(sh.rest_days) - clampRest(sa.rest_days))],
    ['3 partidos en 4 días', c.three_in_four.used * ((sh.three_in_four || 0) - (sa.three_in_four || 0))],
    ['Viaje', c.travel_1000km.used * (((sa.travel_km || 0) - (sh.travel_km || 0)) / 1000)],
    ['Altitud', c.altitude.used * Math.log1p(Math.max(0, (sh.alt_m || 0) - 500) / 1000)],
  ].filter((x) => Math.abs(x[1]) > 0.01);
  return { pts: +terms.reduce((s, x) => s + x[1], 0).toFixed(2), parts: terms.map((x) => ({ label: x[0], pts: +x[1].toFixed(2) })) };
}

module.exports = { VENUES, venueOf, haversine, scheduleState, fitContext, contextAdjust };
