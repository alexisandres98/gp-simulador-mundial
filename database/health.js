// database/health.js — snapshot de salud de la plataforma v2 (Sprint 0). NUNCA lanza.
// No revela secretos: solo estado, latencia, flags y catálogo de proveedores (sin keys ni URLs privadas).

'use strict';

const cfg = require('./config');
const client = require('./client');
const migrate = require('./migrate');

// Catálogo de proveedores conocidos por la configuración de resiliencia (sin secretos, sin jobs en Sprint 0).
function providerCatalog() {
  return Object.keys(cfg.PROVIDER_OVERRIDES).map(code => {
    const c = cfg.providerConfig(code);
    return { code, jobsActive: false, rateLimitPerMinute: c.rateLimitPerMinute, defaultCacheTtlMs: c.defaultCacheTtlMs };
  });
}

async function snapshot() {
  const ts = new Date().toISOString();
  const platformV2 = {
    enabled: cfg.flags.platformV2,
    writeEnabled: cfg.flags.writeEnabled,
    configurationValid: cfg.flags.configurationValid,
    warning: cfg.flags.warning,
  };

  // Sin DATABASE_URL: la plataforma queda inerte por diseño; la app actual funciona igual.
  if (!cfg.db.configured) {
    return {
      status: 'ok',
      database: { configured: false, connected: false, latencyMs: null, migrationStatus: 'not_configured' },
      platformV2, providers: providerCatalog(), timestamp: ts,
    };
  }

  // Con DATABASE_URL: probamos conexión + estado de migraciones, sin propagar errores.
  const probe = await client.healthProbe().catch(() => ({ configured: true, connected: false, latencyMs: null, error: 'probe failed' }));
  let migrationStatus = 'unknown';
  if (probe.connected) {
    try { const s = await migrate.status(); migrationStatus = s.upToDate ? 'up_to_date' : 'pending'; }
    catch { migrationStatus = 'unknown'; }
  }

  const status = probe.connected ? 'ok' : 'unavailable';
  return {
    status,
    database: {
      configured: true,
      connected: probe.connected,
      latencyMs: probe.latencyMs,
      migrationStatus,
      info: cfg.redactedDbInfo(),          // host/puerto/base — NUNCA usuario/contraseña
    },
    platformV2,
    providers: providerCatalog(),
    timestamp: ts,
  };
}

module.exports = { snapshot };
