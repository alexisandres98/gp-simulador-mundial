'use strict';
// clubs-engine/referees.js — efecto del ÁRBITRO sobre el TOTAL de córners (3-sep-2026). PURO: sin red, sin DB.
//
// Modelo: efecto aleatorio multiplicativo con encogimiento empírico-Bayes. Para cada partido dirigido por el
// árbitro se guarda el cociente r_i = total_i / media_liga_i (la media de la liga EN ESE MOMENTO, así el
// efecto viaja entre divisiones: el mismo árbitro pita en Premier y Championship). El multiplicador es
//   mult = (K·1 + Σ r_i) / (K + n)
// que con n=0 vale 1 (ningún cambio) y con n→∞ tiende a la media de cocientes del árbitro. K es el prior en
// "partidos equivalentes" y sale del backtest walk-forward (docs/CORNERS_ARBITRO_BACKTEST.md): es la razón
// σ²_dentro / τ²_entre estimada por método de momentos. El efecto que se anota en la pick es `mult − 1`.
//
// El mismo código sirve al backtest (scripts/corners-ref-backtest.js) y a producción (server.js, tras
// GP_CORNERS_REF): un solo sitio para la aritmética.

// K = 400: es σ²_dentro/τ²_entre del backtest sobre 11.158 partidos (E0-E3 + SC0, 2021-2026): σ² = 11,53 córners²,
// τ² = 0,028 → 412. Léase bien: el árbitro explica el 0,24 % de la varianza residual del total de córners; con
// 150 partidos dirigidos el efecto encogido se queda en ~27 % de su desvío crudo (±1 %). En desarrollo puro el
// EB dio K ≈ 6.400 (τ² ≈ 0). Un K "de tarjetas" (14) EMPEORA el CRPS en test (t = +3,0). Se sobreescribe con
// GP_CORNERS_REF_K. Ver docs/CORNERS_ARBITRO_BACKTEST.md.
const DEFAULTS = {
  REF_PRIOR: 400,    // K: partidos equivalentes del prior (backtest; se sobreescribe con GP_CORNERS_REF_K)
  REF_CLAMP: 0.05,   // tope ±5 % al multiplicador en producción (p10/p90 del backtest con K=400: 0,993/1,009)
  MIN_N: 1,          // con menos partidos que esto el efecto es 0 (mult 1)
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// "M Oliver", "Michael Oliver ", "michael oliver" → una sola clave. Sin acentos, sin puntuación, minúsculas.
function normalizeName(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Multiplicador encogido. sumRatio = Σ r_i, n = nº de partidos, K = prior. n=0 → 1.
function shrunkMult(sumRatio, n, K) {
  const k = Number(K), s = Number(sumRatio) || 0, m = Number(n) || 0;
  if (!(m > 0)) return 1;
  if (!(k >= 0)) return s / m;
  return (k + s) / (k + m);
}

// Índice vacío.
function emptyIndex() { return { version: 1, built_at: null, refs: {}, matches: 0 }; }

// Añade un partido al índice. { referee, total, leagueMean, league, date, key }. `key` dedup (opcional).
function addMatch(index, m) {
  const name = normalizeName(m && m.referee);
  if (!m || m.total == null || m.total === '') return false; // Number(null) es 0: un total ausente NO es 0 córners
  const total = Number(m.total), lm = Number(m.leagueMean);
  if (!name || !(total >= 0) || !(lm > 0)) return false;
  const r = index.refs[name] || (index.refs[name] = { name: String(m.referee).trim(), n: 0, sum_ratio: 0, sum_total: 0, last: null, leagues: {}, keys: {} });
  if (m.key) { if (r.keys[m.key]) return false; r.keys[m.key] = 1; }
  r.n++; r.sum_ratio += total / lm; r.sum_total += total;
  if (m.league) r.leagues[m.league] = (r.leagues[m.league] || 0) + 1;
  if (m.date && (!r.last || String(m.date) > String(r.last))) r.last = String(m.date);
  index.matches++;
  return true;
}

// Efecto de un árbitro: { name, n, mult, effect, mean_ratio }. Sin árbitro o desconocido → n=0, mult=1, effect=0.
function effectFor(index, refereeName, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const name = normalizeName(refereeName);
  const r = name && index && index.refs ? index.refs[name] : null;
  if (!r || !(r.n >= cfg.MIN_N)) return { name: refereeName ? String(refereeName).trim() : null, n: r ? r.n : 0, mult: 1, effect: 0, mean_ratio: r && r.n ? r.sum_ratio / r.n : null };
  let mult = shrunkMult(r.sum_ratio, r.n, cfg.REF_PRIOR);
  if (cfg.REF_CLAMP != null && cfg.REF_CLAMP > 0) mult = clamp(mult, 1 - cfg.REF_CLAMP, 1 + cfg.REF_CLAMP);
  return { name: r.name, n: r.n, mult, effect: mult - 1, mean_ratio: r.sum_ratio / r.n };
}

// Aplica el efecto a la proyección de córners del prop-engine SIN mutar la original. Solo el TOTAL cambia
// (los mercados por equipo no entran en esta capa).
function applyToProjection(proj, eff) {
  if (!proj || !proj.corners || !eff || !(eff.mult > 0) || eff.mult === 1) return proj;
  return Object.assign({}, proj, { corners: Object.assign({}, proj.corners, { total: proj.corners.total * eff.mult, ref_mult: eff.mult }) });
}

// Persistencia sencilla (fichero JSON). Nunca lanza.
function loadIndex(file) {
  try { const j = JSON.parse(require('fs').readFileSync(file, 'utf8')); if (j && j.refs) return j; } catch { /* sin índice */ }
  return emptyIndex();
}
function saveIndex(file, index) {
  try {
    const fs = require('fs'), path = require('path');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(index)); fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

module.exports = { DEFAULTS, normalizeName, shrunkMult, emptyIndex, addMatch, effectFor, applyToProjection, loadIndex, saveIndex };
