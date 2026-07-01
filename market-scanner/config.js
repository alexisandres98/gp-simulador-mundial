// market-scanner/config.js — flags y parámetros del SCANNER MULTI-VENUE (Producto 1: Arbitraje puro; Producto 2: Precio atrasado).
// Reorienta la visión del arb-engine (2-patas Polymarket↔Kalshi) a un scanner que consume TODOS los venues
// que ya ingerimos (sportsbooks vía the_odds_api + prediction markets) y produce dos familias de oportunidad:
//   - PURE_ARB   : surebet cross-venue (2/N patas), libre de riesgo tras vig + comisión + buffer.
//   - PRICE_LAG  : value 1-pata = la casa cuya cuota REZAGA el consenso no-vig del resto (ejecutable, con varianza).
// TODO detrás de flags, default OFF. No publica solo. No toca Value (GP modelo vs mercado) ni Picks.

'use strict';

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

const SCANNER_VERSION = 'market-scanner-1.0.0';

function resolveFlags() {
  const enabled = bool(process.env.MARKET_SCANNER_ENABLED, false);
  const writeReq = bool(process.env.MARKET_SCANNER_WRITE_ENABLED, false);
  const schedReq = bool(process.env.MARKET_SCANNER_SCHEDULER_ENABLED, false);
  return {
    // master switch del scanner (lectura + scan). Sin esto, el endpoint responde "no disponible".
    enabled,
    // persistir snapshots del scan (para historial/observatorio). Requiere enabled.
    writeEnabled: enabled && writeReq,
    // loop periódico. Requiere writeEnabled.
    schedulerEnabled: enabled && writeReq && schedReq,
    // Incluir prediction markets (Polymarket/Kalshi) como venue adicional del consenso/arb. Default OFF
    // (Fase A/B se enfocan en sportsbooks, que son el venue soft con lag ejecutable). Se enciende en fase posterior.
    includePredictionMarkets: bool(process.env.MARKET_SCANNER_INCLUDE_PM, false),
  };
}

const params = {
  // ---- Consenso / frescura ----
  // Mínimo de grupos de independencia para publicar un consenso fiable (evita "consenso" de 1 operador).
  minIndependentGroups: num(process.env.MARKET_SCANNER_MIN_GROUPS, 4),
  // Ventana de frescura de una cuota prematch. Fuera de esto la cuota se excluye del consenso y de la detección.
  maxQuoteAgeMs: num(process.env.MARKET_SCANNER_MAX_QUOTE_AGE_MS, 30 * 60 * 1000), // 30 min
  // Máx. desfase temporal entre las patas de un arb (todas deben ser del mismo "round" de ingesta).
  maxLegTimeSkewMs: num(process.env.MARKET_SCANNER_MAX_LEG_SKEW_MS, 10 * 60 * 1000), // 10 min

  // ---- Producto 1: Arbitraje puro ----
  // ROI garantizado mínimo (tras vig+comisión+buffer) para reportar un surebet.
  arbMinRoi: num(process.env.MARKET_SCANNER_ARB_MIN_ROI, 0.005), // 0.5%
  // Buffer operativo restado al ROI bruto (movimiento de línea entre clic y confirmación). No es fee.
  arbBufferPct: num(process.env.MARKET_SCANNER_ARB_BUFFER_PCT, 0.005), // 0.5%
  // Comisión de exchanges (Betfair/Smarkets): la cuota "back" mostrada es PRE-comisión → se descuenta para honestidad.
  exchangeCommissionPct: num(process.env.MARKET_SCANNER_EXCHANGE_COMMISSION, 0.02), // 2%

  // ---- Producto 2: Precio atrasado (lag/value) ----
  // Edge mínimo (EV por unidad) para reportar una casa como precio atrasado. edge = cuota_casa × prob_justa − 1.
  lagMinEdge: num(process.env.MARKET_SCANNER_LAG_MIN_EDGE, 0.02), // 2%
  // Edge máximo plausible: por encima de esto casi seguro es error de datos / regla distinta → se descarta.
  lagMaxEdge: num(process.env.MARKET_SCANNER_LAG_MAX_EDGE, 0.25), // 25%
  // Dispersión máxima del consenso (rango de prob entre grupos) para confiar en el lag. Alta dispersión = mercado
  // sin acuerdo → el "value" puede ser ruido, no lag.
  lagMaxDispersion: num(process.env.MARKET_SCANNER_LAG_MAX_DISPERSION, 0.08), // 8pp
  // Piso de probabilidad justa: por debajo (longshots) el consenso es ruidoso y el % de edge engaña
  // (diferencia absoluta chica sobre cuota alta = % enorme, alta varianza, la casa limita rápido). Descarta longshots.
  lagMinFairProb: num(process.env.MARKET_SCANNER_LAG_MIN_FAIR_PROB, 0.08), // 8%
  // Dispersión RELATIVA máxima (dispersión / prob justa). Mata el sesgo de longshot: 4.5pp sobre 5% = 0.9 → fuera.
  lagMaxRelDispersion: num(process.env.MARKET_SCANNER_LAG_MAX_REL_DISPERSION, 0.5),

  // ---- Presentación / límites ----
  maxOpportunities: num(process.env.MARKET_SCANNER_MAX_OPPS, 60),
};

module.exports = { flags: resolveFlags(), params, SCANNER_VERSION, resolveFlags };
