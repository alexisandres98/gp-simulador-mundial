// operations/jobRegistry.js — definición central de jobs (Sprint 8A §13). El orquestador LLAMA a los
// servicios existentes (runOnce/tick); NO mueve lógica. Cada job declara su gate, schedule, dependencias,
// lock, timeout, retry, criticidad y módulo dueño. Las requires son perezosas (evita cargas/cíclos en boot).
//
// LOCKS: cada runOnce/tick legacy ya toma su PROPIO advisory lock interno. El orquestador usa un lock_key
// con namespace propio ('<job_name>::run' por defecto en el runner) → no colisiona con el lock interno
// (evita el skip por lock anidado de misma clave) y a la vez impide doble lanzamiento entre instancias.
//
// NOTA: closing/settlement/commitment (Sprint 5) se cablearán en el paso 3 de 8A (§112) como sweeps; aún
// no se registran aquí porque requieren lógica de barrido sobre señales (hoy signals=0).
'use strict';

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

// Normaliza el retorno heterogéneo de los runOnce legacy a { counts, meta } para el run record.
function norm(res) {
  if (!res || typeof res !== 'object') return { counts: {}, meta: res != null ? { ok: true } : null };
  const counts = {
    scanned: res.scanned ?? res.evaluated ?? res.records_scanned ?? 0,
    created: res.created ?? res.inserted ?? res.records_created ?? 0,
    updated: res.updated ?? res.records_updated ?? 0,
    skipped: res.skipped != null && typeof res.skipped === 'number' ? res.skipped : 0,
  };
  const meta = {}; for (const k of ['provider', 'matched', 'opportunities', 'classification', 'status', 'reason']) if (res[k] != null) meta[k] = res[k];
  return { counts, meta: Object.keys(meta).length ? meta : null };
}

// flag helpers: cada job está gated por los MISMOS flags del sprint dueño (no inventa nuevos gates).
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

function buildJobs() {
  return [
    {
      job_name: 'market_data_polymarket', owner_module: 'market-data', criticality: 'high',
      enabled: () => bool(process.env.MARKET_DATA_WRITE_ENABLED, false),
      schedule_ms: int(process.env.MARKET_DATA_POLYMARKET_INTERVAL_MS, 60000),
      dependencies: [], stale_after_ms: 5 * 60 * 1000, timeout_ms: 90 * 1000,
      run: async () => norm(await require('../market-data/scheduler').runOnce('polymarket')),
    },
    {
      job_name: 'market_data_kalshi', owner_module: 'market-data', criticality: 'high',
      enabled: () => bool(process.env.MARKET_DATA_WRITE_ENABLED, false),
      schedule_ms: int(process.env.MARKET_DATA_KALSHI_INTERVAL_MS, 60000),
      dependencies: [], stale_after_ms: 5 * 60 * 1000, timeout_ms: 90 * 1000,
      run: async () => norm(await require('../market-data/scheduler').runOnce('kalshi')),
    },
    {
      job_name: 'sportsbook_ingestion', owner_module: 'sportsbook-providers', criticality: 'high',
      enabled: () => bool(process.env.SPORTSBOOK_PROVIDER_SCHEDULER_ENABLED, false) && bool(process.env.SPORTSBOOK_PROVIDER_ENABLED, false),
      schedule_ms: int(process.env.SPORTSBOOK_INGESTION_INTERVAL_MS, 5 * 60 * 1000),
      // Bloque C: timeout subido de 60s → 4min (default) tras corregir el N+1 (la escritura batch de 3000
      // cuotas tarda <1s; el resto es red: ~4 requests). Ajustable por evidencia con SPORTSBOOK_JOB_TIMEOUT_MS
      // una vez medido p95 en el 2º shadow. La cancelación es cooperativa (runOnce respeta signal).
      dependencies: [], stale_after_ms: 10 * 60 * 1000, timeout_ms: int(process.env.SPORTSBOOK_JOB_TIMEOUT_MS, 4 * 60 * 1000),
      run: async ({ signal } = {}) => norm(await require('../sportsbook-providers').runOnce({ signal })),
    },
    {
      job_name: 'canonical_matching', owner_module: 'canonical-graph', criticality: 'high',
      enabled: () => bool(process.env.CANONICAL_GRAPH_WRITE_ENABLED, false) && bool(process.env.CANONICAL_AUTO_MATCH_ENABLED, false),
      schedule_ms: int(process.env.CANONICAL_MATCH_INTERVAL_MS, 5 * 60 * 1000),
      dependencies: ['market_data_polymarket', 'market_data_kalshi'], stale_after_ms: 10 * 60 * 1000, timeout_ms: 4 * 60 * 1000,
      run: async () => norm(await require('../canonical-graph/scheduler').runOnce()),
    },
    {
      job_name: 'arb_evaluation', owner_module: 'arb-engine', criticality: 'medium',
      enabled: () => bool(process.env.ARB_ENGINE_WRITE_ENABLED, false),
      schedule_ms: int(process.env.ARB_ENGINE_INTERVAL_MS, 10 * 1000),
      dependencies: ['canonical_matching'], stale_after_ms: 5 * 60 * 1000, timeout_ms: 2 * 60 * 1000,
      run: async () => norm(await require('../arb-engine/scheduler').runOnce()),
    },
    {
      job_name: 'value_evaluation', owner_module: 'value-engine', criticality: 'high',
      enabled: () => bool(process.env.VALUE_ENGINE_WRITE_ENABLED, false),
      schedule_ms: int(process.env.VALUE_ENGINE_INTERVAL_MS, 60 * 1000),
      // depende de matching Y de consenso fresco de sportsbooks → el orquestador lo bloquea si falta alguno
      dependencies: ['canonical_matching', 'sportsbook_ingestion'], stale_after_ms: 6 * 60 * 1000, timeout_ms: 2 * 60 * 1000,
      run: async () => norm(await require('../value-engine/scheduler').valueTick()),
    },
    {
      job_name: 'pick_price_monitor', owner_module: 'value-engine', criticality: 'high',
      enabled: () => bool(process.env.PICKS_ENABLED, false),
      schedule_ms: int(process.env.PICK_PRICE_MONITOR_INTERVAL_MS, 60 * 1000),
      dependencies: [], stale_after_ms: 5 * 60 * 1000, timeout_ms: 60 * 1000,
      run: async () => norm(await require('../value-engine/scheduler').monitorTick()),
    },
    {
      job_name: 'metrics_engine', owner_module: 'metrics-engine', criticality: 'low',
      enabled: () => bool(process.env.METRICS_ENGINE_WRITE_ENABLED, false),
      schedule_ms: int(process.env.METRICS_ENGINE_INTERVAL_MS, 15 * 60 * 1000),
      dependencies: ['settlement'], stale_after_ms: 20 * 60 * 1000, timeout_ms: 5 * 60 * 1000,
      run: async () => norm(await require('../metrics-engine/scheduler').runOnce()),
    },
    // --- Sprint 5 cableado al orquestador (§112). Closing/settlement: sweep honesto (pendiente fuente real). ---
    {
      job_name: 'closing_capture', owner_module: 'signal-registry', criticality: 'medium',
      enabled: () => bool(process.env.SIGNAL_CLOSING_CAPTURE_ENABLED, false),
      schedule_ms: int(process.env.SIGNAL_CLOSING_CAPTURE_INTERVAL_MS, 5 * 60 * 1000),
      dependencies: [], stale_after_ms: 15 * 60 * 1000, timeout_ms: 2 * 60 * 1000,
      run: async () => norm(await require('../signal-registry/sweeps').closingSweep()),
    },
    {
      job_name: 'settlement', owner_module: 'signal-registry', criticality: 'medium',
      enabled: () => bool(process.env.SIGNAL_SETTLEMENT_ENABLED, false),
      schedule_ms: int(process.env.SIGNAL_SETTLEMENT_INTERVAL_MS, 10 * 60 * 1000),
      dependencies: [], stale_after_ms: 20 * 60 * 1000, timeout_ms: 3 * 60 * 1000,
      run: async () => norm(await require('../signal-registry/sweeps').settlementSweep()),
    },
    {
      job_name: 'signal_commitment', owner_module: 'signal-registry', criticality: 'low',
      enabled: () => bool(process.env.SIGNAL_REGISTRY_WRITE_ENABLED, false) && bool(process.env.SIGNAL_REGISTRY_ENABLED, false),
      schedule_ms: int(process.env.SIGNAL_COMMITMENT_INTERVAL_MS, 60 * 60 * 1000),
      dependencies: [], stale_after_ms: 90 * 60 * 1000, timeout_ms: 60 * 1000,
      run: async () => norm(await require('../signal-registry/sweeps').commitmentSweep()),
    },
  ];
}

module.exports = { buildJobs, norm };
