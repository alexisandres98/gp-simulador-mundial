// sportsbook-providers/config.js — Sprint 8A §6-8. Config del proveedor real de sportsbooks (The Odds API).
// INVARIANTES: la API key SOLO viene de entorno (SPORTSBOOK_PROVIDER_API_KEY); nunca en repo/DB/logs/responses.
// INERTE si SPORTSBOOK_PROVIDER_ENABLED=false. Escribe solo con SPORTSBOOK_PROVIDER_WRITE_ENABLED.
'use strict';

const LAYER_VERSION = 'sportsbook-providers-1';
const NORMALIZER_VERSION = 'odds-normalize-1';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const str = (v, d) => (v === undefined || v === '') ? d : String(v).trim();

function resolveFlags() {
  const enabled = bool(process.env.SPORTSBOOK_PROVIDER_ENABLED, false);
  return {
    enabled,
    write: enabled && bool(process.env.SPORTSBOOK_PROVIDER_WRITE_ENABLED, false),
    scheduler: enabled && bool(process.env.SPORTSBOOK_PROVIDER_SCHEDULER_ENABLED, false),
    // ¿hay key configurada? (no expone el valor — solo si existe)
    hasKey: !!process.env.SPORTSBOOK_PROVIDER_API_KEY,
  };
}

function resolveParams() {
  return {
    providerName: str(process.env.SPORTSBOOK_PROVIDER_NAME, 'the_odds_api'),
    apiHost: str(process.env.SPORTSBOOK_PROVIDER_HOST, 'https://api.the-odds-api.com'),
    // regiones de casas a consultar (cada región suma costo). Por defecto eu+uk (incluye Pinnacle/sharp).
    regions: str(process.env.SPORTSBOOK_PROVIDER_REGIONS, 'eu,uk'),
    markets: 'h2h',            // SOLO 1X2 prematch en esta integración inicial (§7)
    oddsFormat: 'decimal',
    // descubrimiento del deporte: filtro por título (la sport key del Mundial se descubre, no se hardcodea)
    sportFilter: str(process.env.SPORTSBOOK_PROVIDER_SPORT_FILTER, 'world cup'),
    sportGroup: str(process.env.SPORTSBOOK_PROVIDER_SPORT_GROUP, 'Soccer'),
    // cuota / rate limiting (§8)
    maxRequestsPerRun: int(process.env.SPORTSBOOK_PROVIDER_MAX_REQUESTS_PER_RUN, 4),
    quotaReservePercent: int(process.env.SPORTSBOOK_PROVIDER_QUOTA_RESERVE_PERCENT, 15),
    requestTimeoutMs: int(process.env.SPORTSBOOK_PROVIDER_REQUEST_TIMEOUT_MS, 12000),
    maxRetries: int(process.env.SPORTSBOOK_PROVIDER_MAX_RETRIES, 2),
    backoffBaseMs: int(process.env.SPORTSBOOK_PROVIDER_BACKOFF_BASE_MS, 800),
    // validación 1X2 (§10)
    maxOutcomeSkewMs: int(process.env.SPORTSBOOK_MAX_OUTCOME_SKEW_MS, 90 * 1000),
    maxQuoteAgeMs: int(process.env.SPORTSBOOK_MAX_QUOTE_AGE_MS, 10 * 60 * 1000),
    eventStartBufferMs: int(process.env.SPORTSBOOK_EVENT_START_BUFFER_MS, 60 * 1000),
    // circuit breaker (§23)
    circuitFailThreshold: int(process.env.SPORTSBOOK_CIRCUIT_FAIL_THRESHOLD, 3),
    circuitOpenMs: int(process.env.SPORTSBOOK_CIRCUIT_OPEN_MS, 5 * 60 * 1000),
    ingestionIntervalMs: int(process.env.SPORTSBOOK_INGESTION_INTERVAL_MS, 5 * 60 * 1000),
  };
}

module.exports = {
  LAYER_VERSION, NORMALIZER_VERSION,
  get flags() { return resolveFlags(); },
  get params() { return resolveParams(); },
  // lectura de la key SOLO aquí (un único punto), nunca se loguea
  apiKey: () => process.env.SPORTSBOOK_PROVIDER_API_KEY || null,
  bool, int, str,
};
