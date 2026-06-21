// market-data/freshness.js — clasificación de frescura (Sprint 1).
// Estados: fresh | aging | stale | unknown. Considera proveedor, live/prematch, provider_timestamp,
// received_at, intervalo esperado y último snapshot exitoso. Si no hay provider_timestamp, usa received_at
// pero MARCA freshness_basis='received_at' (no presentar como frescura garantizada por el proveedor).

'use strict';
const cfg = require('./config');

// classify({ providerTimestamp, receivedAt, expectedIntervalMs, now }) → { state, basis, ageMs }
function classify({ providerTimestamp, receivedAt, expectedIntervalMs, now } = {}) {
  const t = now || Date.now();
  const interval = expectedIntervalMs || 30000;
  const fresh = interval * cfg.freshness.freshMultiplier;   // p.ej. 30s*2 = 60s
  const stale = interval * cfg.freshness.staleMultiplier;   // p.ej. 30s*5 = 150s

  let basis = 'provider_timestamp';
  let ref = providerTimestamp ? new Date(providerTimestamp).getTime() : NaN;
  if (!Number.isFinite(ref)) { basis = 'received_at'; ref = receivedAt ? new Date(receivedAt).getTime() : NaN; }
  if (!Number.isFinite(ref)) return { state: 'unknown', basis: 'none', ageMs: null };

  const ageMs = t - ref;
  let state;
  if (ageMs > stale) state = 'stale';
  else if (ageMs > fresh) state = 'aging';
  else state = 'fresh';
  return { state, basis, ageMs };
}

module.exports = { classify };
