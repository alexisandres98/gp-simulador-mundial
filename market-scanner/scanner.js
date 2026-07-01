// market-scanner/scanner.js — NÚCLEO PURO del scanner multi-venue. Sin I/O, sin DB: recibe cuotas normalizadas
// (de CUALQUIER venue) y produce consenso no-vig + las dos familias de oportunidad. Venue-agnóstico por diseño:
// agregar casas recreativas o prediction markets (Myriad/Prophet X/Novig) = alimentar más cuotas, nada más.
//
// Forma de una CUOTA normalizada (venue adapter → esto):
//   { venue, venue_label, independence_group, source_role, outcome, odds_decimal,
//     observed_at (ms epoch), max_stake?, live?, is_exchange? }
//   outcome ∈ universo del mercado (p.ej. ['home','draw','away'] o ['over','under']).
//
// Un MERCADO agrupa cuotas de un mismo (evento, familia, período, línea) con su `universe` (outcomes exhaustivos
// y mutuamente excluyentes). El scanner opera mercado por mercado.

'use strict';

const noVig = require('../value-engine/noVig');

const round = (v, p = 8) => (v == null || !Number.isFinite(v)) ? null : +v.toFixed(p);
const median = (xs) => { const a = xs.filter(Number.isFinite).slice().sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const groupKey = (q) => q.independence_group || q.venue;

// Cuota efectiva de un exchange: la cuota "back" mostrada es PRE-comisión. Neteamos para no reclamar arbitrajes
// que la comisión se come. odds_net = 1 + (odds − 1) × (1 − commission). Casas normales: vig ya en la cuota → sin cambio.
function netOdds(q, commissionPct) {
  if (!q.is_exchange || !commissionPct) return q.odds_decimal;
  return 1 + (q.odds_decimal - 1) * (1 - commissionPct);
}

// ---- Frescura ----
function freshQuotes(quotes, now, maxAgeMs) {
  return quotes.filter(q => Number.isFinite(q.odds_decimal) && q.odds_decimal > 1 &&
    Number.isFinite(q.observed_at) && (now - q.observed_at) <= maxAgeMs);
}

// ---- Consenso no-vig por mercado ----
// Método: por CASA que cotiza el universo COMPLETO y fresca → prob implícita cruda (1/odds) por outcome.
// Colapsa cada grupo de independencia a su mediana (máx. un voto por grupo). Toma la mediana por outcome entre
// grupos y devig (proporcional) → prob JUSTA. `excludeGroup` habilita leave-one-out (no comparar una casa consigo
// misma). Devuelve null si no hay suficientes grupos independientes.
function consensus(market, quotes, { minGroups, excludeGroup = null } = {}) {
  const U = market.universe;
  // agrupar por casa → sus cuotas por outcome
  const byBook = new Map();
  for (const q of quotes) {
    if (!byBook.has(q.venue)) byBook.set(q.venue, { venue: q.venue, group: groupKey(q), o: {} });
    byBook.get(q.venue).o[q.outcome] = q.odds_decimal;
  }
  // casas completas (cotizan todo el universo)
  const complete = [...byBook.values()].filter(b => U.every(o => Number.isFinite(b.o[o]) && b.o[o] > 1));
  // colapsar a grupos de independencia (excluyendo el grupo pedido para LOO)
  const groups = new Map();
  for (const b of complete) {
    if (excludeGroup && b.group === excludeGroup) continue;
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push(b);
  }
  if (groups.size < (minGroups || 1)) {
    return { status: 'insufficient', groups: groups.size, required: minGroups || 1 };
  }
  // mediana de prob implícita cruda por outcome, dentro de cada grupo → representante de grupo
  const groupImplied = [];
  for (const [g, bs] of groups) {
    const rep = {};
    for (const o of U) rep[o] = median(bs.map(b => 1 / b.o[o]));
    groupImplied.push({ group: g, implied: rep });
  }
  // mediana entre grupos por outcome
  const medImplied = {};
  for (const o of U) medImplied[o] = median(groupImplied.map(r => r.implied[o]));
  // devig proporcional → prob justa (Σ=1)
  const rawVec = U.map(o => medImplied[o]);
  const dv = noVig.removeVig(rawVec, { method: 'proportional' });
  if (!dv.official || dv.official.status !== 'ok') return { status: 'devig_failed', groups: groups.size };
  const fair = {}; U.forEach((o, i) => { fair[o] = dv.official.probabilities[i]; });
  // dispersión: rango de prob implícita normalizada entre grupos (máx − mín por outcome)
  const disp = {};
  for (const o of U) {
    const vals = groupImplied.map(r => r.implied[o]).filter(Number.isFinite);
    // normalizar cada grupo antes de medir dispersión (quita vig heterogénea entre casas)
    disp[o] = vals.length ? round(Math.max(...vals) - Math.min(...vals)) : null;
  }
  const overround = round(rawVec.reduce((a, b) => a + b, 0) - 1);
  return {
    status: 'ok',
    fair,
    fair_odds: Object.fromEntries(U.map(o => [o, fair[o] > 0 ? round(1 / fair[o], 4) : null])),
    dispersion: round(Math.max(...U.map(o => disp[o] || 0))),
    dispersion_by_outcome: disp,
    overround,
    groups: groups.size,
    books: complete.length,
    method: 'median_implied_by_group_then_devig_v1',
    devig_alt_disagreement: dv.method_disagreement,
  };
}

// ---- Producto 1: ARBITRAJE PURO (surebet 2/N patas) ----
// Toma la MEJOR cuota (neta de comisión) por outcome entre venues. Si Σ(1/mejor_odds) < 1 − buffer → surebet.
// ROI garantizado = 1/S − 1. Reparto de stake ∝ (1/odds)/S. Requiere ≥2 casas distintas y universo completo.
function detectArb(market, quotes, params) {
  const U = market.universe;
  const best = {}; // outcome → mejor pata
  for (const q of quotes) {
    const eff = netOdds(q, params.exchangeCommissionPct);
    if (!(eff > 1)) continue;
    if (!best[q.outcome] || eff > best[q.outcome].eff_odds) {
      best[q.outcome] = { venue: q.venue, venue_label: q.venue_label, group: groupKey(q), outcome: q.outcome, odds: q.odds_decimal, eff_odds: eff, observed_at: q.observed_at, max_stake: q.max_stake, is_exchange: !!q.is_exchange, source_role: q.source_role };
    }
  }
  if (!U.every(o => best[o])) return null; // universo incompleto
  const legs = U.map(o => best[o]);
  const distinctBooks = new Set(legs.map(l => l.venue)).size;
  if (distinctBooks < 2) return null; // una sola casa no arbitra consigo misma
  const S = legs.reduce((a, l) => a + 1 / l.eff_odds, 0);
  const grossRoi = 1 / S - 1;
  const netRoi = grossRoi - params.arbBufferPct;
  // desfase temporal entre patas
  const ts = legs.map(l => l.observed_at).filter(Number.isFinite);
  const skew = ts.length ? Math.max(...ts) - Math.min(...ts) : null;
  const stale = skew != null && skew > params.maxLegTimeSkewMs;
  const executable = netRoi >= params.arbMinRoi && !stale;
  if (grossRoi <= 0) return null; // ni bruto positivo → no es surebet
  // stakes normalizados a 100 unidades de inversión total
  const stakes = legs.map(l => round((1 / l.eff_odds) / S * 100, 2));
  return {
    family: 'PURE_ARB',
    event_id: market.event_id,
    market_family: market.market_family,
    period: market.period,
    line: market.line ?? null,
    home: market.home || null, away: market.away || null, kickoff: market.kickoff || null,
    universe: U,
    legs: legs.map((l, i) => ({ venue: l.venue, venue_label: l.venue_label, outcome: l.outcome, odds: round(l.odds, 4), eff_odds: round(l.eff_odds, 4), stake_pct: stakes[i], is_exchange: l.is_exchange, source_role: l.source_role, observed_at: l.observed_at, max_stake: l.max_stake ?? null })),
    sum_inverse: round(S, 6),
    gross_roi: round(grossRoi, 6),
    net_roi: round(netRoi, 6),
    leg_time_skew_ms: skew,
    stale,
    executable,
    distinct_books: distinctBooks,
  };
}

// ---- Producto 2: PRECIO ATRASADO (lag/value 1-pata) ----
// Para cada casa+outcome fresca: edge = odds_casa × prob_justa_LOO − 1. Reporta las que superan el umbral.
// prob_justa se calcula con leave-one-out (excluye el grupo de la casa evaluada) para no comparar contra sí misma.
// Clasifica soft vs sharp/exchange: el "precio atrasado" REAL es una casa soft que rezagó una movida de consenso.
function detectLag(market, quotes, params, now) {
  const U = market.universe;
  const out = [];
  // consenso base (todos los grupos) para reporte; el edge usa LOO por casa
  const base = consensus(market, quotes, { minGroups: params.minIndependentGroups });
  if (base.status !== 'ok') return { consensus: base, opportunities: [] };
  if (base.dispersion != null && base.dispersion > params.lagMaxDispersion) {
    return { consensus: base, opportunities: [], suppressed: 'high_dispersion' };
  }
  for (const q of quotes) {
    const grp = groupKey(q);
    // LOO: consenso sin el grupo de esta casa
    const loo = consensus(market, quotes, { minGroups: Math.max(2, params.minIndependentGroups - 1), excludeGroup: grp });
    const ref = loo.status === 'ok' ? loo : base;
    const fairP = ref.fair && ref.fair[q.outcome];
    if (!Number.isFinite(fairP) || fairP <= 0) continue;
    // piso de probabilidad justa: descarta longshots (consenso ruidoso, % de edge engañoso).
    if (fairP < params.lagMinFairProb) continue;
    const edge = q.odds_decimal * fairP - 1;
    if (edge < params.lagMinEdge || edge > params.lagMaxEdge) continue;
    if (ref.dispersion != null && ref.dispersion > params.lagMaxDispersion) continue;
    // dispersión RELATIVA a la prob del outcome (mata el sesgo de longshot que la absoluta no ve).
    const refDispOut = ref.dispersion_by_outcome && ref.dispersion_by_outcome[q.outcome];
    if (Number.isFinite(refDispOut) && refDispOut / fairP > params.lagMaxRelDispersion) continue;
    const isSharp = q.source_role === 'sharp_reference' || q.is_exchange;
    // Favorito del mercado según el consenso justo: sirve para advertir "estás apostando EN CONTRA del favorito"
    // (clave del trade-out: si holdeás y gana el favorito, el +edge se evapora → conviene vender al reajustarse).
    let favOutcome = null, favProb = -1;
    for (const o of U) { const p = ref.fair && ref.fair[o]; if (Number.isFinite(p) && p > favProb) { favProb = p; favOutcome = o; } }
    const isFavorite = favOutcome === q.outcome;
    out.push({
      family: 'PRICE_LAG',
      event_id: market.event_id,
      market_family: market.market_family,
      period: market.period,
      line: market.line ?? null,
      home: market.home || null, away: market.away || null, kickoff: market.kickoff || null,
      is_favorite: isFavorite, favorite_outcome: favOutcome, favorite_prob: round(favProb, 6),
      venue: q.venue,
      venue_label: q.venue_label,
      outcome: q.outcome,
      odds: round(q.odds_decimal, 4),
      fair_prob: round(fairP, 6),
      fair_odds: round(1 / fairP, 4),
      edge: round(edge, 6),
      implied_prob: round(1 / q.odds_decimal, 6),
      is_soft: !isSharp,
      is_exchange: !!q.is_exchange, venue_kind: q.venue_kind || 'sportsbook',
      source_role: q.source_role || null,
      consensus_groups: ref.groups,
      dispersion: ref.dispersion,
      observed_at: q.observed_at,
      age_ms: Number.isFinite(q.observed_at) ? now - q.observed_at : null,
      max_stake: q.max_stake ?? null,
    });
  }
  // ordenar por edge desc; soft primero (es el producto ejecutable)
  out.sort((a, b) => (b.is_soft - a.is_soft) || (b.edge - a.edge));
  // dedup por (outcome, grupo de independencia): dos casas del mismo grupo (p.ej. unibet_se y unibet_nl = Kindred)
  // son la MISMA oportunidad → quedarse con la de mejor cuota (ya ordenado por edge desc, la 1ª del grupo gana).
  const seen = new Set();
  const deduped = out.filter(o => {
    const grp = quotes.find(x => x.venue === o.venue);
    const key = o.outcome + '|' + ((grp && groupKey(grp)) || o.venue);
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  return { consensus: base, opportunities: deduped };
}

// ---- Scan de un mercado ----
function scanMarket(market, params, now) {
  const fresh = freshQuotes(market.quotes || [], now, params.maxQuoteAgeMs);
  if (fresh.length < 2) return { market: marketRef(market), consensus: { status: 'insufficient', groups: 0 }, arb: null, lag: [], stats: { fresh: fresh.length, total: (market.quotes || []).length } };
  const arb = detectArb(market, fresh, params);
  const lag = detectLag(market, fresh, params, now);
  return {
    market: marketRef(market),
    consensus: lag.consensus,
    arb,
    lag: lag.opportunities,
    lag_suppressed: lag.suppressed || null,
    stats: { fresh: fresh.length, total: (market.quotes || []).length, groups: lag.consensus.groups || 0 },
  };
}

function marketRef(m) {
  return { event_id: m.event_id, market_family: m.market_family, period: m.period, line: m.line ?? null, universe: m.universe, home: m.home || null, away: m.away || null, home_team_id: m.home_team_id || null, away_team_id: m.away_team_id || null, kickoff: m.kickoff || null };
}

// ---- Scan de todos los mercados ----
// markets: [{ event_id, market_family, period, line?, universe:[...], quotes:[...], home?, away?, ... }]
function scan(markets, { params, now = Date.now() } = {}) {
  const results = (markets || []).map(m => scanMarket(m, params, now));
  const arbs = results.map(r => r.arb).filter(Boolean);
  const lags = results.flatMap(r => r.lag);
  const arbExecutable = arbs.filter(a => a.executable);
  const lagSoft = lags.filter(l => l.is_soft);
  return {
    scanned_at: now,
    markets_scanned: results.length,
    markets_with_consensus: results.filter(r => r.consensus.status === 'ok').length,
    arbitrage: arbs.sort((a, b) => (b.executable - a.executable) || (b.net_roi - a.net_roi)),
    price_lag: lags.slice().sort((a, b) => (b.is_soft - a.is_soft) || (b.edge - a.edge)),
    counts: {
      arb_total: arbs.length,
      arb_executable: arbExecutable.length,
      lag_total: lags.length,
      lag_soft: lagSoft.length,
    },
    results,
  };
}

module.exports = { scan, scanMarket, consensus, detectArb, detectLag, netOdds, freshQuotes };
