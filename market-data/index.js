// market-data/index.js — orquestación de la capa de ingesta (Sprint 1).
// Arranque CONDICIONAL por flags. Aislado: cualquier fallo aquí no debe afectar la app principal.
//   - sin platformV2 → no se inicializa nada.
//   - platformV2 sin write → se puede inicializar (health/dry-run), pero el scheduler no escribe.
//   - platformV2 + write + flags por proveedor → ingesta persistente en shadow mode.

'use strict';
const cfg = require('./config');
const scheduler = require('./scheduler');
const pipeline = require('./pipeline');
const metrics = require('./metrics');
const log = require('../database/logger');

let initialized = false;

// initialize() — llamado desde server.js al arrancar (best-effort). No lanza.
async function initialize() {
  try {
    if (!cfg.platformInitable()) return { initialized: false, reason: 'platform_v2_disabled' };
    if (!cfg.base.db.configured) { log.warn('market-data: platformV2 on pero sin DATABASE_URL'); return { initialized: false, reason: 'no_db' }; }
    initialized = true;
    // limpia runs abandonadas de un crash previo
    await pipeline.reapAbandonedRuns().catch(() => {});
    const anyWrite = cfg.PROVIDERS.some(p => cfg.providerEnabled(p));
    if (cfg.writeEnabled() && anyWrite) {
      scheduler.start();
      log.info('market-data: scheduler iniciado (shadow mode)');
      return { initialized: true, scheduler: true };
    }
    log.info('market-data: inicializado sin escritura (dry-run posible)');
    return { initialized: true, scheduler: false };
  } catch (e) {
    log.error('market-data: fallo de inicialización (ignorado)', { error: e.message });
    return { initialized: false, reason: 'error' };
  }
}

async function shutdown() { try { scheduler.stop(); } catch { /* noop */ } }

// status() — para el endpoint admin. No ejecuta ingesta, no migra, no altera registros. Sin secretos.
async function adminStatus() {
  const q = require('./repositories/queryRepository');
  const freshnessMod = require('./freshness');
  const out = {
    enabled: cfg.platformInitable(),
    writeEnabled: cfg.writeEnabled(),
    schedulerRunning: scheduler.status().started,
    providers: [],
    database: null,
  };
  for (const p of cfg.PROVIDERS) {
    const m = metrics.snapshot(p);
    const row = {
      provider: p, enabled: cfg.providerEnabled(p),
      lastRunStatus: m.lastRunStatus, lastStartedAt: m.lastStartedAt, lastFinishedAt: m.lastFinishedAt,
      lastSuccessfulSnapshotAt: m.lastSuccessfulSnapshotAt, marketsTracked: m.marketsTracked,
      snapshotsLastHour: null, orderbookLevelsLastHour: null,
      averageLatencyMs: m.avgLatencyMs, p95LatencyMs: m.p95LatencyMs, errorRate: m.errorRate,
      freshness: 'unknown',
    };
    if (cfg.base.db.configured) {
      try {
        const prov = await require('../database/repositories').providers.findByCode(p);
        if (prov) {
          const c = await q.countsLastHour(prov.id);
          row.snapshotsLastHour = c.snapshots; row.orderbookLevelsLastHour = c.orderbookLevels;
          if (c.lastReceivedAt) row.freshness = freshnessMod.classify({ receivedAt: c.lastReceivedAt, expectedIntervalMs: cfg.intervals[p] }).state;
        }
      } catch { /* best-effort */ }
    }
    out.providers.push(row);
  }
  if (cfg.base.db.configured) { try { out.database = await q.getStorageCounts(); } catch { /* noop */ } }
  return out;
}

function schedulerStatus() { return scheduler.status(); }
function providerMetrics(p) { return metrics.snapshot(p); }

module.exports = { initialize, shutdown, adminStatus, schedulerStatus, providerMetrics, scheduler, pipeline, config: cfg };
