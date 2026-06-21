// database/config.js — configuración centralizada de la nueva plataforma de datos (Sprint 0).
// Lee SOLO de process.env (poblado por loadDotEnv en server.js). No contiene secretos hardcodeados.
// Expone: flags, configuración de conexión, resiliencia por proveedor y políticas de datos.
// NADA de lo que se devuelve aquí debe imprimirse con el secreto en claro: usa redactedDbInfo().

'use strict';

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}
function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// ---- Feature flags (aislamiento de la nueva infraestructura) — VALIDADOS centralmente ----
// Regla: escribir requiere que la plataforma v2 esté habilitada. La combinación
// (platformV2=false, writeEnabled=true) es INVÁLIDA → se fuerza writeEnabled=false y se marca
// configurationValid=false con un warning estructurado. Nunca tumba la app ni inicia writers.
function resolveFlags() {
  const platformV2 = bool(process.env.MARKET_DATA_PLATFORM_V2, false);
  const writeRequested = bool(process.env.MARKET_DATA_WRITE_ENABLED, false);
  const invalidWrite = writeRequested && !platformV2;
  return {
    platformV2,
    writeRequested,
    writeEnabled: invalidWrite ? false : writeRequested, // forzado a false si es inválida
    configurationValid: !invalidWrite,
    warning: invalidWrite ? 'write_requires_platform_v2' : null,
  };
}
const flags = resolveFlags();
// Aviso al cargar (best-effort; el logger redacta secretos). No imprime valores sensibles.
if (!flags.configurationValid) {
  try { require('./logger').warn('config: combinación de flags inválida', { reason: flags.warning, platformV2: flags.platformV2, writeRequested: flags.writeRequested, effectiveWriteEnabled: flags.writeEnabled }); } catch { /* noop */ }
}

// ---- Conexión a PostgreSQL ----
// configured = hay DATABASE_URL. Sin ella, la app actual sigue funcionando y la capa queda inerte.
const db = {
  url: process.env.DATABASE_URL || null,
  configured: !!process.env.DATABASE_URL,
  ssl: bool(process.env.DB_SSL, true),
  poolMax: int(process.env.DB_POOL_MAX, 10),
  connectionTimeoutMs: int(process.env.DB_CONNECTION_TIMEOUT_MS, 5000),
  // tope defensivo del tamaño de payload aceptado por la capa (Sprint 1 lo usará al insertar raw)
  maxPayloadBytes: int(process.env.DB_MAX_PAYLOAD_BYTES, 1_000_000),
  statementTimeoutMs: int(process.env.DB_STATEMENT_TIMEOUT_MS, 15000),
};

// ---- Políticas de datos (configurables; defaults documentados en sprint-0-data-policies.md) ----
const policies = {
  rawRetentionDays: int(process.env.RAW_RETENTION_DAYS, 365),
  freshnessAgingMs: int(process.env.FRESHNESS_AGING_MS, 60_000),
  freshnessStaleMs: int(process.env.FRESHNESS_STALE_MS, 300_000),
};

// ---- Resiliencia por proveedor ----
// Cada proveedor tiene su propia configuración (no una global única). Sirve a los adapters de Sprint 1.
const PROVIDER_DEFAULT = {
  requestTimeoutMs: 15000,
  maxRetries: 2,
  backoffMs: 500,
  rateLimitPerMinute: 60,
  defaultCacheTtlMs: 60_000,
};
const PROVIDER_OVERRIDES = {
  polymarket: { requestTimeoutMs: 15000, maxRetries: 2, backoffMs: 600, rateLimitPerMinute: 100, defaultCacheTtlMs: 60_000 },
  kalshi:     { requestTimeoutMs: 15000, maxRetries: 2, backoffMs: 600, rateLimitPerMinute: 100, defaultCacheTtlMs: 60_000 },
  api_football:{ requestTimeoutMs: 12000, maxRetries: 2, backoffMs: 800, rateLimitPerMinute: 300, defaultCacheTtlMs: 7_200_000 },
  espn:       { requestTimeoutMs: 12000, maxRetries: 1, backoffMs: 500, rateLimitPerMinute: 120, defaultCacheTtlMs: 45_000 },
};
function providerConfig(code) {
  return { code, ...PROVIDER_DEFAULT, ...(PROVIDER_OVERRIDES[code] || {}) };
}

// ---- Info de DB SIN secretos (apta para logs / health) ----
// Devuelve host y nombre de base si se pueden parsear, NUNCA usuario/contraseña ni la URL completa.
function redactedDbInfo() {
  if (!db.url) return { configured: false };
  try {
    const u = new URL(db.url);
    return { configured: true, host: u.hostname, port: u.port || '5432', database: (u.pathname || '').replace(/^\//, '') || null, ssl: db.ssl };
  } catch {
    return { configured: true, host: 'unparseable', ssl: db.ssl };
  }
}

module.exports = { flags, db, policies, providerConfig, redactedDbInfo, PROVIDER_DEFAULT, PROVIDER_OVERRIDES };
