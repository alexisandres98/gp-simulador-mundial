// basketball-engine/props.js — PROPS DE JUGADOR CON DISTRIBUCIÓN (16-ago).
//
// POR QUÉ ES EL MERCADO QUE IMPORTA. El ganador de un partido lo cotizan cien casas y lo mueve el dinero
// informado en minutos. Los props de jugador son cientos de líneas por noche, con menos ojos encima y con
// límites bajos — es donde un modelo con datos finos puede ganar antes que en el moneyline.
//
// LA DIFERENCIA ENTRE UN PROP Y UNA MEDIA. "Promedia 18,4 puntos" no sirve para decidir sobre una línea de
// 17,5: lo que decide es P(pts > 17,5), y eso depende de la FORMA de la distribución, no de su centro. Un
// jugador de 18 puntos con varianza alta y otro con varianza baja tienen probabilidades muy distintas sobre
// la misma línea. Acá se modela la distribución entera:
//   1) MINUTOS proyectados (del módulo de minutos, ya con las bajas aplicadas).
//   2) TASA por minuto, encogida hacia la media de su posición según el tamaño de muestra.
//   3) AJUSTE POR RIVAL: cuánto concede el rival en esa categoría respecto a la liga.
//   4) DISPERSIÓN: binomial negativa ajustada a su historial, no Poisson. Poisson asume varianza = media y
//      en baloncesto SIEMPRE es mayor (medido acá); usarla infla las probabilidades de los extremos.
//
// PURO: entra el historial derivado, salen distribuciones. Sin red, sin disco, sin db.
'use strict';

const CATS = {
  pts: { label: 'Puntos', key: 'pts' },
  reb: { label: 'Rebotes', key: 'reb' },
  ast: { label: 'Asistencias', key: 'ast' },
  tpm: { label: 'Triples', key: 'tpm' },
  pra: { label: 'P+R+A', key: null },
};
const valOf = (p, cat) => (cat === 'pra' ? (p.pts || 0) + (p.reb || 0) + (p.ast || 0) : (p[CATS[cat].key] || 0));

// ---- HISTORIAL DE UN JUGADOR ----------------------------------------------------------------------------
function playerLog(games, playerId, { lastN = 40 } = {}) {
  const rows = [];
  for (const g of games) {
    const p = (g.players || []).find((x) => String(x.id) === String(playerId));
    if (!p || !(p.min > 0)) continue;
    rows.push({ date: g.date, min: p.min, opp: String(g.home.id) === String(p.t) ? String(g.away.id) : String(g.home.id),
      home: String(g.home.id) === String(p.t), pts: p.pts, reb: p.reb, ast: p.ast, tpm: p.tpm, fga: p.fga, tpa: p.tpa });
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, lastN);
}

// ---- TASAS POR MINUTO, ENCOGIDAS ------------------------------------------------------------------------
// La media de un jugador con 6 partidos no vale lo mismo que la de uno con 60. Se encoge hacia la media de
// la liga con un peso que crece con los minutos jugados: rate = (m·r_jugador + k·r_liga) / (m + k).
function rates(log, leagueRate, { k = 300 } = {}) {
  const out = {};
  const totMin = log.reduce((s, r) => s + r.min, 0);
  for (const cat of Object.keys(CATS)) {
    const tot = log.reduce((s, r) => s + valOf(r, cat), 0);
    const own = totMin > 0 ? tot / totMin : 0;
    const lg = leagueRate[cat] || 0;
    out[cat] = { per_min: +((totMin * own + k * lg) / (totMin + k)).toFixed(5), sample_min: +totMin.toFixed(1), raw: +own.toFixed(5) };
  }
  return out;
}
function leagueRates(games) {
  const tot = {}, min = { v: 0 };
  for (const g of games) for (const p of (g.players || [])) {
    if (!(p.min > 0)) continue;
    min.v += p.min;
    for (const cat of Object.keys(CATS)) tot[cat] = (tot[cat] || 0) + valOf(p, cat);
  }
  const out = {};
  for (const cat of Object.keys(CATS)) out[cat] = min.v > 0 ? tot[cat] / min.v : 0;
  return out;
}

// ---- CUÁNTO CONCEDE EL RIVAL ----------------------------------------------------------------------------
// Multiplicador: lo que el rival concede en esa categoría por 100 posesiones respecto a la media de liga.
// Encogido: con pocos partidos, un rival no puede mover la proyección un 30%.
function opponentFactor(games, oppId, cat, { k = 12 } = {}) {
  let vsOpp = 0, vsOppMin = 0, lgTot = 0, lgMin = 0, n = 0;
  for (const g of games) {
    const isOppHome = String(g.home.id) === String(oppId), isOppAway = String(g.away.id) === String(oppId);
    for (const p of (g.players || [])) {
      if (!(p.min > 0)) continue;
      lgTot += valOf(p, cat); lgMin += p.min;
      const against = (isOppHome && String(p.t) !== String(oppId)) || (isOppAway && String(p.t) !== String(oppId));
      if (against) { vsOpp += valOf(p, cat); vsOppMin += p.min; }
    }
    if (isOppHome || isOppAway) n++;
  }
  const lg = lgMin > 0 ? lgTot / lgMin : 0;
  const vs = vsOppMin > 0 ? vsOpp / vsOppMin : lg;
  if (!(lg > 0)) return 1;
  const raw = vs / lg;
  return +(((n * raw) + (k * 1)) / (n + k)).toFixed(4);     // encogido hacia 1
}

// ---- DISTRIBUCIÓN ---------------------------------------------------------------------------------------
// Binomial negativa por su dispersión: media μ, varianza μ + μ²/r. `r` sale del historial del jugador
// (método de momentos) y se acota para que no degenere. Si la varianza observada es ≤ media (rarísimo),
// se cae a Poisson, que es el límite r → ∞.
function nbPmf(mu, r, kMax) {
  const out = new Float64Array(kMax + 1);
  if (!(r > 0) || !isFinite(r)) {                            // Poisson
    let p = Math.exp(-mu);
    for (let k = 0; k <= kMax; k++) { out[k] = p; p = (p * mu) / (k + 1); }
    return out;
  }
  const pp = r / (r + mu);
  let term = Math.pow(pp, r);
  for (let k = 0; k <= kMax; k++) {
    out[k] = term;
    term = (term * (r + k) * (1 - pp)) / (k + 1);
  }
  return out;
}
function dispersionR(log, cat, mu) {
  const vals = log.map((x) => valOf(x, cat));
  if (vals.length < 6 || !(mu > 0)) return Infinity;
  const m = vals.reduce((s, x) => s + x, 0) / vals.length;
  const v = vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1);
  if (!(v > m)) return Infinity;                             // sin sobredispersión → Poisson
  return Math.max(1.2, Math.min(60, (m * m) / (v - m)));
}

// ---- PROYECCIÓN COMPLETA DE UN PROP --------------------------------------------------------------------
function projectProp(games, { playerId, minutes, oppId, cat = 'pts', lgRates = null, paceFactor = 1 }) {
  const log = playerLog(games, playerId);
  if (!log.length || !(minutes > 0)) return null;
  const LR = lgRates || leagueRates(games);
  const rt = rates(log, LR);
  const of = opponentFactor(games, oppId, cat);
  const mu = rt[cat].per_min * minutes * of * paceFactor;
  if (!(mu > 0)) return null;
  const r = dispersionR(log, cat, mu);
  const kMax = Math.max(10, Math.ceil(mu * 4 + 12));
  const pmf = nbPmf(mu, r, kMax);
  // acumulada para P(> línea) en líneas con .5
  const over = (line) => {
    let s = 0; const start = Math.floor(line) + 1;
    for (let k = start; k <= kMax; k++) s += pmf[k];
    return Math.min(0.999, Math.max(0.001, s));
  };
  const lines = [];
  const center = Math.round(mu * 2) / 2;
  for (let d = -3; d <= 3; d++) {
    const line = Math.max(0.5, Math.floor(center + d) + 0.5);
    if (lines.some((x) => x.line === line)) continue;
    const p = over(line);
    lines.push({ line, over: +p.toFixed(4), under: +(1 - p).toFixed(4), fair_over: +(1 / p).toFixed(2), fair_under: +(1 / (1 - p)).toFixed(2) });
  }
  // cuantiles para el panel
  let acc = 0; const q = {};
  for (let k = 0; k <= kMax; k++) { acc += pmf[k]; for (const [nm, f] of [['p10', 0.1], ['p25', 0.25], ['p50', 0.5], ['p75', 0.75], ['p90', 0.9]]) if (q[nm] == null && acc >= f) q[nm] = k; }
  return {
    player_id: String(playerId), cat, label: CATS[cat].label,
    minutes: +minutes.toFixed(1), mu: +mu.toFixed(2),
    per_min: rt[cat].per_min, sample_min: rt[cat].sample_min,
    opp_factor: of, dispersion_r: isFinite(r) ? +r.toFixed(2) : null, model: isFinite(r) ? 'binomial negativa' : 'poisson',
    quantiles: q, lines, hist: Array.from(pmf.slice(0, Math.min(kMax, Math.ceil(mu * 3 + 8)))).map((p, k) => [k, +p.toFixed(5)]),
    games_used: log.length,
  };
}

// Todos los props de un partido: cada jugador con minutos proyectados × las categorías principales.
function gameProps(games, { homeMinutes, awayMinutes, homeId, awayId, cats = ['pts', 'reb', 'ast', 'tpm'], paceFactor = 1, top = 8 }) {
  const LR = leagueRates(games);
  const out = [];
  const side = (map, oppId, teamId) => {
    const rows = Object.entries(map || {}).filter(([id]) => id !== '__repl__').sort((a, b) => b[1] - a[1]).slice(0, top);
    for (const [pid, mins] of rows) {
      const props = {};
      for (const c of cats) { const pr = projectProp(games, { playerId: pid, minutes: mins, oppId, cat: c, lgRates: LR, paceFactor }); if (pr) props[c] = pr; }
      if (Object.keys(props).length) out.push({ player_id: pid, team_id: teamId, minutes: +mins.toFixed(1), props });
    }
  };
  side(homeMinutes, awayId, homeId);
  side(awayMinutes, homeId, awayId);
  return out;
}

module.exports = { CATS, playerLog, rates, leagueRates, opponentFactor, projectProp, gameProps, nbPmf, dispersionR };
