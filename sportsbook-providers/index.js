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
    try { out.state = await repo.getState(cfg.params.providerName); } catch { /* noop */ }
  }
  return out;
}

async function health() { return createProvider().health(); }

module.exports = { cfg, ingestion, repo, createProvider, adminStatus, health, runOnce: ingestion.runOnce };
