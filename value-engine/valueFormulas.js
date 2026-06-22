// value-engine/valueFormulas.js — Sprint 7 §24-25. Fórmulas de value. Sin doble conteo de vig/fee/slippage.
'use strict';
const cfg = require('./config');

const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };

// forSportsbook({ ensembleProb, conservativeProb, decimalOdds, minEv }) → bloque de value para una cuota sportsbook.
function forSportsbook({ ensembleProb, conservativeProb, decimalOdds, minEv = cfg.params.minEv } = {}) {
  const p = num(ensembleProb), pc = num(conservativeProb), d = num(decimalOdds);
  if (p == null || d == null || !(d > 1)) return { status: 'invalid' };
  const breakEven = 1 / d;
  const out = {
    status: 'ok',
    break_even_probability: r(breakEven),
    fair_odds: r(1 / p), conservative_fair_odds: pc != null ? r(1 / pc) : null,
    raw_edge_pp: r(p - breakEven),
    adjusted_edge_pp: pc != null ? r(pc - breakEven) : null,
    raw_ev: r(p * d - 1),
    adjusted_ev: pc != null ? r(pc * d - 1) : null,
    // cuota mínima aceptable para exigir minEv sobre la prob conservadora. La cuota ya contiene el vig del book:
    // NO se resta overround como fee adicional (eso sería doble conteo; el no-vig solo estima el consenso).
    minimum_acceptable_odds: pc != null && pc > 0 ? r((1 + minEv) / pc) : null,
    price_meets_minimum: null,
  };
  if (out.minimum_acceptable_odds != null) out.price_meets_minimum = d >= out.minimum_acceptable_odds;
  return out;
}

// forPredictionMarket({ ensembleProb, conservativeProb, executablePrice, feeBlock, minEv }) → value de un mercado 0–1.
//   Usa el fee engine de Sprint 3 a través de feeBlock (fee ya estimada por contrato). No usa la fórmula sportsbook.
function forPredictionMarket({ ensembleProb, conservativeProb, executablePrice, minEv = cfg.params.minEv } = {}) {
  const p = num(ensembleProb), pc = num(conservativeProb), price = num(executablePrice);
  if (p == null || price == null || !(price > 0 && price < 1)) return { status: 'invalid' };
  // comprar YES a `price` paga 1 si gana. EV (sin fee) = prob − price. max precio aceptable para EV≥minEv·price:
  const out = {
    status: 'ok',
    break_even_probability: r(price),
    fair_price: r(p), conservative_fair_price: pc != null ? r(pc) : null,
    raw_edge_pp: r(p - price),
    adjusted_edge_pp: pc != null ? r(pc - price) : null,
    raw_ev: r((p - price) / price),
    adjusted_ev: pc != null ? r((pc - price) / price) : null,
    // precio máximo aceptable (las fees del execution engine de Sprint 3 se aplican aparte sobre el tamaño).
    maximum_acceptable_price: pc != null ? r(pc / (1 + minEv)) : null,
    price_meets_minimum: null,
  };
  if (out.maximum_acceptable_price != null) out.price_meets_minimum = price <= out.maximum_acceptable_price;
  return out;
}

function r(v) { return v == null ? null : +Number(v).toFixed(8); }

module.exports = { forSportsbook, forPredictionMarket };
