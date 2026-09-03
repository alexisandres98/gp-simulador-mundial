'use strict';
// ═══ MONITOR DE COMBATE: etiquetas de PREREGISTRO + re-evaluación T−24 h + desgloses del track (2-sep) ═══
// Nace de los backtests de familias (docs/BACKTESTS_FAMILIAS_2026-09-02.md §7). Lo que se midió sobre las 48
// FIGHT liquidadas: comprar al PERRO del mercado da CLV −8,64 (t −3,5) y comprar al FAVORITO +3,31 (t +1,9);
// es el único corte robusto del libro, y solo en CLV. La respuesta NO es cambiar la compuerta —cambiarla a
// mitad de muestra destruye la muestra— sino ETIQUETAR cada pick al nacer con lo que la regla preregistrada
// necesita para juzgarse después (docs/PREREGISTRO_COMBATE_FAVORITO.md). Todo lo de aquí es PURO: sin db,
// sin red, sin reloj propio (el `now` entra por parámetro) — se prueba con scripts/smoke/combate-smoke.js.
//
// LO QUE NO SE TOCA: el peso del blend (0,5), el umbral (2 pp) y el techo de cuota (3) siguen donde están
// (server.js). Las constantes de abajo REPITEN esos valores solo para juzgar la degradación T−24 h; si algún
// día cambian en la compuerta, cambian aquí también — a propósito no se importan: la regla preregistrada
// queda congelada en su propio archivo.
const BLEND_W = 0.5;            // peso del modelo en la mezcla (el resto es mercado)
const EDGE_MIN_PP = 2;          // ventaja mínima post-blend, en puntos porcentuales
const DRIFT_MAX = 0.05;         // nuestro lado se alargó más de un 5 % → degradada
const T24_WINDOW_H = 26;        // la re-evaluación vive entre 26 h y 0 h antes del campanazo
const PREREG_FAV_K = 0.45;      // favorito "amplio" del mercado (k ≥ 0,45: no se pierden los pick'em)
const PLACEHOLDER_MAX_DAYS = 120; // una pelea a más de 120 días es un rumor de cartelera, no una fecha
const MKT_AWARE_EDGE_PP = 2;    // corte del track para la ventaja del modelo consciente del mercado (3-sep)

const round = (x, d) => (x == null || !isFinite(x)) ? null : +Number(x).toFixed(d);

// horas desde `now` hasta el evento (1 decimal); null si la fecha no parsea
function hoursToEvent(evDate, now) {
  const t = Date.parse(evDate || ''); if (!isFinite(t)) return null;
  return round((t - (now == null ? Date.now() : now)) / 3600e3, 1);
}

// Etiquetas que viajan en la pick FIGHT al crearse. `k` es la prob JUSTA del consenso de NUESTRO lado.
//   fav_market      k ≥ 0,50 (favorito estricto del mercado)
//   prereg_fav45    k ≥ 0,45 (la regla preregistrada: favorito amplio, incluye pick'em)
//   espn_order_home nuestro lado es el f1 que ESPN lista primero (solo orgs con cartelera ESPN; boxeo → null)
//   weigh_signal    lo que devolvió combatWeighCtx (over1/over2/sched), tal cual
//   press_signals   claves `lado:codigo` de combatIntelFlags + combatNewsFlags (dedup, orden estable)
//   hours_to_event  antelación en horas al crear
function pickTags({ k, side, org, wctx, flags, evDate, now }) {
  const kk = Number(k);
  const espnOrg = org !== 'boxing'; // la agenda de boxeo sale de la Odds API, no hay orden ESPN que guardar
  const press = [];
  for (const f of (flags || [])) {
    if (!f || !f.code) continue;
    const key = (f.side || '?') + ':' + f.code;
    if (press.indexOf(key) < 0) press.push(key);
  }
  return {
    market_fair_at_create: round(kk, 4),
    fav_market: isFinite(kk) ? kk >= 0.5 : null,
    prereg_fav45: isFinite(kk) ? kk >= PREREG_FAV_K : null,
    espn_order_home: espnOrg ? side === 'f1' : null,
    weigh_signal: wctx ? { over1: wctx.over1 || 0, over2: wctx.over2 || 0, sched: wctx.sched || null } : null,
    press_signals: press,
    hours_to_event: hoursToEvent(evDate, now),
  };
}

// Re-evaluación a T−24 h de una pick FIGHT ACTIVA. NO cambia status: anota. Devuelve el parche a aplicar o
// null si no toca (fuera de ventana, ya evaluada, sin cuota). IDEMPOTENTE: la foto se toma UNA vez (la
// primera pasada dentro de la ventana) y no se reescribe; `t24_hours_to_event` dice cuándo se tomó de verdad
// (si el servidor estuvo caído, puede ser T−3 h, y eso hay que poder verlo).
//   drift_t24_pct = odds_t24 / best_odds − 1  (> 0 = nuestro lado se alargó = el mercado se movió en contra)
//   degradada si drift > 5 % O si con el fair actual la ventaja post-blend queda por debajo de 2 pp
function t24Eval(p, { oddsNow, fairNow, now }) {
  if (!p || p.status !== 'ACTIVE' || (p.family || 'FIGHT') !== 'FIGHT') return null;
  if (p.t24_at) return null; // ya evaluada: la foto no se mueve
  const h = hoursToEvent((p.event || {}).kickoff_at, now);
  if (h == null || h > T24_WINDOW_H || h <= 0) return null;
  if (!(oddsNow > 1) || !(p.best_odds > 1)) return null;
  // se juzga sobre los valores REDONDEADOS que se guardan (2 decimales), no sobre el flotante crudo:
  // 2,1/2,0 − 1 da 0,05000000000000004 y una deriva exacta del 5 % no debe degradar.
  const driftPct = round((oddsNow / p.best_odds - 1) * 100, 2);
  const m = Number(p.model_prob);
  const edgeNow = (isFinite(m) && isFinite(Number(fairNow))) ? round((BLEND_W * m + (1 - BLEND_W) * fairNow - fairNow) * 100, 2) : null;
  const reasons = [];
  if (driftPct > DRIFT_MAX * 100) reasons.push(`cuota alargada ${driftPct.toFixed(1)} % (${p.best_odds} → ${oddsNow})`);
  if (edgeNow != null && edgeNow < EDGE_MIN_PP) reasons.push(`ventaja post-blend ${edgeNow.toFixed(2)} pp < ${EDGE_MIN_PP} pp con el fair actual`);
  return {
    odds_t24: oddsNow,
    fair_t24: round(fairNow, 4),
    drift_t24_pct: driftPct, // en %, mismo criterio que clv_pct
    edge_blend_t24_pp: edgeNow,
    t24_at: new Date(now == null ? Date.now() : now).toISOString(),
    t24_hours_to_event: h,
    degraded_monitor: reasons.length > 0,
    degraded_reason: reasons.length ? reasons.join('; ') : null,
  };
}

// Fecha placeholder de cartelera: el 31-dic a las 22/23h que las casas usan para "algún día", o cualquier
// pelea a más de 120 días. Con esa fecha no se generan picks (las cuotas son especulativas).
function isPlaceholderDate(evDate, now) {
  const s = String(evDate || '');
  if (/-12-31T2[23]:/.test(s)) return true;
  const t = Date.parse(s); if (!isFinite(t)) return false;
  return (t - (now == null ? Date.now() : now)) > PLACEHOLDER_MAX_DAYS * 864e5;
}

// Agregado de un grupo de picks liquidadas (WIN/LOSS): n, acierto, ROI y CLV medio con su error estándar.
function aggClv(list) {
  const rows = list || [];
  const w = rows.filter(p => p.result_code === 'WIN').length;
  const u = rows.reduce((s, p) => s + (p.units || 0), 0);
  const clv = rows.map(p => p.clv_pct).filter(x => typeof x === 'number' && isFinite(x));
  const n = rows.length, cn = clv.length;
  const mean = cn ? clv.reduce((s, x) => s + x, 0) / cn : null;
  const sd = cn > 1 ? Math.sqrt(clv.reduce((s, x) => s + (x - mean) ** 2, 0) / (cn - 1)) : null;
  const se = sd != null && cn ? sd / Math.sqrt(cn) : null;
  return {
    n, w, l: n - w,
    hit: n ? round(w / n * 100, 1) : null,
    units: round(u, 2), roi_pct: n ? round(u / n * 100, 1) : null,
    clv_n: cn, clv_avg: round(mean, 2), clv_sd: round(sd, 2), clv_se: round(se, 2),
    clv_t: (se && mean != null) ? round(mean / se, 2) : null,
  };
}

// Las picks anteriores al despliegue no traen etiquetas: se derivan de market_prob (que es la misma k).
const kOf = (p) => typeof p.market_fair_at_create === 'number' ? p.market_fair_at_create : (typeof p.market_prob === 'number' ? p.market_prob : null);
const isFav45 = (p) => typeof p.prereg_fav45 === 'boolean' ? p.prereg_fav45 : (kOf(p) != null ? kOf(p) >= PREREG_FAV_K : null);
const isFavMkt = (p) => typeof p.fav_market === 'boolean' ? p.fav_market : (kOf(p) != null ? kOf(p) >= 0.5 : null);

// Desgloses del track de FIGHT (solo liquidadas WIN/LOSS): por regla preregistrada, por degradación T−24 h y
// CLV por lado del mercado. ROUNDS y METHOD no entran aquí.
function trackBreakdown(fightRows) {
  const rows = (fightRows || []).filter(p => (p.family || 'FIGHT') === 'FIGHT');
  return {
    prereg_fav45: { si: aggClv(rows.filter(p => isFav45(p) === true)), no: aggClv(rows.filter(p => isFav45(p) === false)) },
    degraded_monitor: {
      si: aggClv(rows.filter(p => p.degraded_monitor === true)),
      no: aggClv(rows.filter(p => p.degraded_monitor === false)),
      sin_t24: aggClv(rows.filter(p => typeof p.degraded_monitor !== 'boolean')), // nacieron antes o no llegaron a la ventana
    },
    clv_by_side: { favorito: aggClv(rows.filter(p => isFavMkt(p) === true)), perro: aggClv(rows.filter(p => isFavMkt(p) === false)) },
    // MODELO CONSCIENTE DEL MERCADO (3-sep): corte por la ventaja informativa `edge_mkt_aware_pp` (≥ 2 pp vs < 2).
    // Con los coeficientes en 0 la ventaja es 0 y todo cae en `lt2`; el corte cobra sentido cuando algún rasgo
    // pase el backtest. Las picks sin el campo (anteriores) van a `sin_dato`.
    mkt_aware_edge: {
      ge2: aggClv(rows.filter(p => typeof p.edge_mkt_aware_pp === 'number' && p.edge_mkt_aware_pp >= MKT_AWARE_EDGE_PP)),
      lt2: aggClv(rows.filter(p => typeof p.edge_mkt_aware_pp === 'number' && p.edge_mkt_aware_pp < MKT_AWARE_EDGE_PP)),
      sin_dato: aggClv(rows.filter(p => typeof p.edge_mkt_aware_pp !== 'number')),
    },
  };
}

module.exports = { pickTags, t24Eval, isPlaceholderDate, hoursToEvent, aggClv, trackBreakdown, BLEND_W, EDGE_MIN_PP, DRIFT_MAX, T24_WINDOW_H, PREREG_FAV_K, PLACEHOLDER_MAX_DAYS, MKT_AWARE_EDGE_PP };
