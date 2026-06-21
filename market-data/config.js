// market-data/config.js — configuración de la ingesta persistente (Sprint 1).
// Reutiliza los flags y la resiliencia por-proveedor de database/config y añade lo específico de
// market-data (intervalos, profundidad de book, frescura, flags por proveedor). Solo lee process.env.

'use strict';
const base = require('../database/config');

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// Escribir requiere plataforma v2 + write habilitados (validación central de Sprint 0.1) Y el flag del proveedor.
function providerEnabled(code) {
  if (!base.flags.platformV2 || !base.flags.writeEnabled) return false;
  const map = { polymarket: 'MARKET_DATA_POLYMARKET_ENABLED', kalshi: 'MARKET_DATA_KALSHI_ENABLED' };
  return bool(process.env[map[code]], false);
}

// Inicializar la capa (no necesariamente escribir): basta platformV2 (permite dry-run/health).
function platformInitable() { return base.flags.platformV2; }
function writeEnabled() { return base.flags.platformV2 && base.flags.writeEnabled; }

const intervals = {
  polymarket: num(process.env.MARKET_DATA_POLYMARKET_INTERVAL_MS, 30000),
  kalshi: num(process.env.MARKET_DATA_KALSHI_INTERVAL_MS, 30000),
  live: num(process.env.MARKET_DATA_LIVE_INTERVAL_MS, 15000),
  longDated: num(process.env.MARKET_DATA_LONG_DATED_INTERVAL_MS, 60000),
  discovery: num(process.env.MARKET_DATA_DISCOVERY_INTERVAL_MS, 600000),
};

const orderbookMaxLevels = num(process.env.MARKET_DATA_ORDERBOOK_MAX_LEVELS, 20);

const freshness = {
  freshMultiplier: num(process.env.MARKET_DATA_FRESH_MULTIPLIER, 2),
  staleMultiplier: num(process.env.MARKET_DATA_STALE_MULTIPLIER, 5),
};

// Resiliencia por proveedor (timeout/retries/backoff/rateLimit/ttl) desde database/config.
function resilience(code) { return base.providerConfig(code); }

module.exports = {
  base, providerEnabled, platformInitable, writeEnabled,
  intervals, orderbookMaxLevels, freshness, resilience,
  PROVIDERS: ['polymarket', 'kalshi'],
};
