// sportsbook-providers/index.js — fachada del proveedor de sportsbooks (Sprint 8A). Provider-agnostic.
// NO acopla el Value Engine: expone ingestión + estado. INERTE sin SPORTSBOOK_PROVIDER_ENABLED.
'use strict';
const cfg = require('./config');
const ingestion = require('./ingestion');
const repo = require('./repositories');
const { createProvider } = require('./theOddsApiProvider');
const db = require('../database/client');

// status admin: sin secretos. Estado de cuota/circuit + frescura. No gasta cuota salvo health explícito.
async function adminStatus() {
  const out = { enabled: cfg.flags.enabled, write: cfg.flags.write, has_key: cfg.flags.hasKey, provider: cfg.params.providerName, regions: cfg.params.regions, market: 'h2h/1x2' };
  if (cfg.flags.enabled && db.isConfigured()) {
    try {
      out.state = await repo.getState(cfg.params.providerName);
      // el panel mentía (17-ago): updated_at se refresca en cada upsert aunque los números de cuota vengan
      // conservados por COALESCE. `quota_updated_at` (045) es la fecha REAL de los números, y aquí se dice
      // explícitamente cuándo la cuota que se enseña dejó de ser fresca.
      if (out.state) {
        const qa = out.state.quota_updated_at ? Date.parse(out.state.quota_updated_at) : null;
        out.state.quota_age_min = qa ? Math.round((Date.now() - qa) / 60000) : null;
        out.state.quota_stale = qa == null || (Date.now() - qa) > 6 * 3600e3;
      }
    } catch { /* noop */ }
  }
  return out;
}

async function health() { return createProvider().health(); }

// módulos post-shadow (Bloques B/F/G/H/I/K)
const retention = require('./retention');
const sourceCatalog = require('./sourceCatalog');
const sportsbookCanonical = require('./sportsbookCanonical');
const valueDryRun = require('./valueDryRun');
const setAssembly = require('./setAssembly');
const outliers = require('./outliers');

module.exports = {
  cfg, ingestion, repo, createProvider, adminStatus, health, runOnce: ingestion.runOnce,
  retention, sourceCatalog, sportsbookCanonical, valueDryRun, setAssembly, outliers,
  // operaciones administrativas auditadas (Bloque D)
  reconcileOrphanRuns: repo.reconcileOrphanRuns,
};
