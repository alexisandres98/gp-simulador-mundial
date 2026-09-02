// basketball-engine/clv.js — CLV JUSTA CONTRA JUSTA, TESIS, LÍNEAS Y DESCANSO (2-sep, backtests §5).
//
// POR QUÉ EXISTE. El monitor medía `clv_pct = best_odds / close_odds − 1` con `close_odds` = consenso SIN
// margen y `best_odds` = precio de una casa CON margen. Una pick cuya probabilidad justa no se mueve un
// ápice daba CLV ≈ −3,2 % por construcción (H3 del backtest: −4,62 = −3,16 de margen + −1,46 de movimiento
// real). Acá el CLV se mide entre dos probabilidades JUSTAS del consenso —la de nacer y la del cierre— y el
// viejo número se conserva aparte como `clv_price_pct`, que mide otra cosa (el precio que compramos frente
// al cierre sin margen: siempre arranca en negativo por el vig).
//
// Todo es PURO: sin red, sin db, sin fechas implícitas. server.js pasa los datos y guarda lo que sale.
// Las reglas del monitor (umbrales, cuotas, compuertas) NO viven acá: hay un preregistro que las congela.
'use strict';

const CLV_V = 2;
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);

// Textos que viajan en el track y en /api/hoops/perf para que quien lea sepa qué mide cada número.
const NOTAS = {
  clv_pct: 'CLV justa vs justa: (prob. justa del consenso al cierre / prob. justa del consenso al nacer − 1) × 100. Positivo = el mercado se movió hacia nuestro lado. Sin sesgo de margen.',
  clv_price_pct: 'CLV de precio (fórmula anterior): (mejor cuota tomada / cuota justa de cierre − 1) × 100. Compara un precio CON margen contra uno SIN margen, así que una pick sin movimiento da ≈ −3 %. Se conserva por continuidad.',
  line_moved_pts: 'Puntos que se movió la línea principal del mercado entre nacer y cerrar, con signo a favor de nuestro lado (positivo = el cierre nos dio la razón).',
};

// ---- CLV ----------------------------------------------------------------------------------------------
// Justa contra justa. `fairAtCreate` y `fairAtClose` son probabilidades (0-1) de la MISMA selección.
function clvFair(fairAtCreate, fairAtClose) {
  if (!(fairAtCreate > 0 && fairAtCreate < 1) || !(fairAtClose > 0 && fairAtClose < 1)) return null;
  return r2((fairAtClose / fairAtCreate - 1) * 100);
}
// La fórmula vieja, tal cual estaba en `hoopsPicksCloseline`, para no perder la serie histórica.
function clvPrice(bestOdds, closeOdds) {
  if (!(bestOdds > 1) || !(closeOdds > 1)) return null;
  return r2((bestOdds / closeOdds - 1) * 100);
}

// Probabilidad justa de una selección a partir de la lista de cuotas de cada lado del mercado (mismo
// método que usa el monitor al nacer: mediana de implícitas por lado y Shin para quitar el margen).
// `novig` es PRC.novig; se inyecta para que este módulo siga siendo puro y probable sin red.
function fairFromQuotes(m, side, novig) {
  if (!m || !m.q || !m.sides || m.sides.length !== 2) return null;
  const med = (arr) => { const v = (arr || []).map((x) => 1 / x.o).filter((x) => x > 0 && x < 1).sort((a, b) => a - b);
    if (!v.length) return null; const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
  const ia = med(m.q[m.sides[0]]), ib = med(m.q[m.sides[1]]);
  if (!(ia > 0) || !(ib > 0)) return null;
  let p = null;
  try { const nv = novig ? novig([1 / ia, 1 / ib], { method: 'shin' }) : null; if (nv && nv.p) p = side === m.sides[0] ? nv.p[0] : nv.p[1]; } catch { p = null; }
  if (!(p > 0 && p < 1)) p = (side === m.sides[0] ? ia : ib) / (ia + ib);
  return r4(p);
}

// Aplica la versión 2 a una pick que ya tiene su cierre. Idempotente: si `clv_v === 2` no toca nada.
// Para picks cerradas con la fórmula vieja no hay prob. justa Shin del cierre guardada: se reconstruye
// desde `close_odds` (que era el consenso proporcional sin margen) y se deja constancia del método.
function applyV2(p, { closeFair = null, closeMethod = null } = {}) {
  if (!p || p.clv_v === CLV_V) return false;
  const fairCreate = p.market_fair_at_create != null ? p.market_fair_at_create : p.market_prob;
  if (p.close_odds == null || fairCreate == null) return false;
  const priceOld = p.clv_pct;                       // con la fórmula vieja este campo ERA el CLV de precio
  p.clv_price_pct = p.clv_price_pct != null ? p.clv_price_pct : (priceOld != null ? priceOld : clvPrice(p.best_odds, p.close_odds));
  const pc = closeFair != null ? closeFair : (p.close_odds > 1 ? r4(1 / p.close_odds) : null);
  p.close_fair = pc;
  p.close_fair_method = closeMethod || (closeFair != null ? 'shin' : 'proporcional_desde_close_odds');
  p.market_fair_at_create = fairCreate;
  p.clv_pct = clvFair(fairCreate, pc);
  p.clv_v = CLV_V;
  return true;
}
// Migración de todo el monitor. Devuelve cuántas picks cambiaron (0 en las pasadas siguientes).
function migrateV2(picks) {
  let n = 0;
  for (const p of picks || []) if (applyV2(p)) n++;
  return n;
}

// ---- UNA PICK POR TESIS ---------------------------------------------------------------------------------
// La tesis es partido + familia + lado: "Under en el partido X". `Under 171` y `Under 171,5` son la misma
// tesis con otro decimal; el monitor re-picaba cuando la línea se movía y una tesis aparecía como 5 picks.
const FAM_OF = { MONEYLINE: 'match_winner', SPREAD: 'spread', TOTAL: 'match_total' };
function thesisOf(p) {
  if (!p) return null;
  if (p.thesis) return p.thesis;
  const fam = FAM_OF[p.family] || p.family;
  return [fam, p.selection_code || p.side, String(p.game_id)].join('|');
}
function findByThesis(picks, thesis) {
  if (!thesis) return null;
  for (const p of picks || []) if (thesisOf(p) === thesis) return p;
  return null;
}
// Anota la re-cotización en la pick existente (máx. 20). Si la última anotada es idéntica en línea y
// cuota no se repite: cada 30 min pasa el constructor y sin esto el tope se llenaría de copias.
function addRequote(p, rq, { max = 20 } = {}) {
  if (!p || !rq) return false;
  p.requotes = Array.isArray(p.requotes) ? p.requotes : [];
  const last = p.requotes[p.requotes.length - 1];
  if (last && last.line === rq.line && last.best_odds === rq.best_odds) return false;
  if (p.requotes.length >= max) return false;
  p.requotes.push({ at: rq.at, line: rq.line == null ? null : rq.line, best_odds: rq.best_odds, model_prob: rq.model_prob, edge_pp: rq.edge_pp });
  return true;
}

// ---- LÍNEAS -------------------------------------------------------------------------------------------
// Línea principal de una familia en un partido: la que más casas cotizan (empate → la más cercana a `near`).
function mainLine(mkts, { ceid, fam, near = null } = {}) {
  let best = null;
  for (const m of mkts || []) {
    if (m.ceid !== ceid || m.fam !== fam || m.line == null) continue;
    const n = (m.q[m.sides[0]] || []).length + (m.q[m.sides[1]] || []).length;
    const d = near == null ? 0 : Math.abs(m.line - near);
    if (!best || n > best.n || (n === best.n && d < best.d)) best = { line: m.line, n, d };
  }
  return best ? best.line : null;
}
// Movimiento con signo a favor de nuestro lado. `line` del hándicap está normalizada al hándicap del LOCAL
// (igual que en el monitor): si tomamos local +3 y cierra +1, el mercado nos dio la razón → +2.
function lineMoved({ family, side, lineAtCreate, closeLine }) {
  if (!Number.isFinite(lineAtCreate) || !Number.isFinite(closeLine)) return null;
  const fam = FAM_OF[family] || family;
  if (fam === 'match_total') return r2(side === 'under' ? lineAtCreate - closeLine : closeLine - lineAtCreate);
  if (fam === 'spread') return r2(side === 'home' ? lineAtCreate - closeLine : closeLine - lineAtCreate);
  return null;
}

// ---- DESCANSO -----------------------------------------------------------------------------------------
// Días desde el partido anterior del equipo, saturados a `cap` (misma definición que el backtest H4:
// min(7, Δt/86400e3); sin partido anterior en la ventana → null y el que llama decide el valor por defecto).
function restDays(games, teamId, kickoffAt, { cap = 7 } = {}) {
  const t0 = Date.parse(kickoffAt || 0); if (!t0) return null;
  const id = String(teamId);
  let last = null;
  for (const g of games || []) {
    if (!g || !g.home || !g.away) continue;
    if (String(g.home.id) !== id && String(g.away.id) !== id) continue;
    const t = Date.parse(g.date || 0);
    if (!t || t >= t0 - 3600e3) continue;            // el mismo partido u otro posterior no cuentan
    if (last == null || t > last) last = t;
  }
  if (last == null) return null;
  return r2(Math.min(cap, (t0 - last) / 864e5));
}
const REST_OVER_THRESHOLD = 0.9;
// `rest_diff = away_rest − home_rest`; la regla preregistrada dispara over si supera 0,9 días.
function restDiff(homeRest, awayRest) {
  if (!Number.isFinite(homeRest) || !Number.isFinite(awayRest)) return null;
  return r2(awayRest - homeRest);
}
function restFeatures(games, game, { defaultRest = 3 } = {}) {
  if (!game || !game.home || !game.away) return null;
  const hr = restDays(games, game.home.id, game.date), ar = restDays(games, game.away.id, game.date);
  const home = hr == null ? defaultRest : hr, away = ar == null ? defaultRest : ar;
  const diff = restDiff(home, away);
  return { home_rest_days: home, away_rest_days: away, rest_diff: diff, home_rest_known: hr != null, away_rest_known: ar != null,
    prereg_rest_over: diff != null && diff > REST_OVER_THRESHOLD };
}

// Evaluación del preregistro de descanso sobre partidos COMPLETADOS: dónde habría disparado la regla y
// cómo le fue al over contra la línea de cierre (si hay). `closeLineOf(g)` devuelve la línea de total o null.
function restPrereg(games, { since = null, closeLineOf = null } = {}) {
  const done = (games || []).filter((g) => g && g.home && g.away && g.home.pts != null && g.away.pts != null && g.date);
  const rows = [];
  for (const g of done) {
    if (since && String(g.date) < since) continue;
    const f = restFeatures(done, g);
    if (!f || !f.prereg_rest_over) continue;
    const total = g.home.pts + g.away.pts;
    const line = closeLineOf ? closeLineOf(g) : null;
    const res = line == null ? null : (total > line ? 'OVER' : total < line ? 'UNDER' : 'PUSH');
    rows.push({ game_id: String(g.id), date: g.date, home: g.home.id, away: g.away.id, rest_diff: f.rest_diff, total, close_line: line, result: res });
  }
  const conLinea = rows.filter((r) => r.result);
  const over = conLinea.filter((r) => r.result === 'OVER').length, under = conLinea.filter((r) => r.result === 'UNDER').length;
  const decided = over + under;
  return {
    regla: `over si away_rest − home_rest > ${REST_OVER_THRESHOLD} días (descanso saturado a 7; sin partido previo = 3)`,
    n_disparos: rows.length, n_con_linea: conLinea.length, over, under, push: conLinea.length - decided,
    over_pct: decided ? r2(100 * over / decided) : null,
    // error estándar binomial del acierto: sin él 13/18 parece una señal y es una moneda cargada un poco
    over_se_pp: decided ? r2(100 * Math.sqrt(0.25 / decided)) : null,
    rows: rows.slice(-200),
  };
}

module.exports = { CLV_V, NOTAS, REST_OVER_THRESHOLD, clvFair, clvPrice, fairFromQuotes, applyV2, migrateV2,
  thesisOf, findByThesis, addRequote, mainLine, lineMoved, restDays, restDiff, restFeatures, restPrereg };
