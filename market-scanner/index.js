// market-scanner/index.js — orquestador del scanner multi-venue. Carga mercados de la DB (venue-agnóstico),
// corre el núcleo puro (consenso + arbitraje puro + precio atrasado) y devuelve el resultado listo para el DTO.
// INERTE salvo flag MARKET_SCANNER_ENABLED. Lectura pura por defecto (no persiste sin MARKET_SCANNER_WRITE_ENABLED).

'use strict';

const { flags, params, SCANNER_VERSION } = require('./config');
const scanner = require('./scanner');
const quotes = require('./quotes');

// scanNow(db, opts) → resultado del scan (objeto de scanner.scan) o { disabled:true }.
//   opts.force ignora el flag enabled (para disparo admin manual).
async function scanNow(db, { now = Date.now(), force = false, extraMarkets = [] } = {}) {
  if (!flags.enabled && !force) return { disabled: true, scanner_version: SCANNER_VERSION };
  if (!db || !db.isConfigured || !db.isConfigured()) return { unavailable: 'db_not_configured', scanner_version: SCANNER_VERSION };
  const markets = await quotes.loadMarkets(db, {
    includeTotals: true,
    includePredictionMarkets: flags.includePredictionMarkets,
  });
  // extraMarkets: mercados ya con forma de scanner construidos fuera (p.ej. campeón desde marketCache Poly/Kalshi).
  if (Array.isArray(extraMarkets) && extraMarkets.length) markets.push(...extraMarkets);
  const out = scanner.scan(markets, { params, now });
  out.scanner_version = SCANNER_VERSION;
  return out;
}

module.exports = { scanNow, flags, params, SCANNER_VERSION };
