// operations/config.js — Sprint 8A. Flags + parámetros del orquestador de jobs. Centralizado.
// INVARIANTE: con OPERATIONS_ORCHESTRATOR_ENABLED=false la capa es INERTE — la app conserva su
// comportamiento anterior (los schedulers legacy de cada sprint siguen mandando). El orquestador NO
// mueve lógica: envuelve los runOnce/tick existentes. Nunca escribe sin OPERATIONS_JOB_WRITES_ENABLED.
'use strict';

const LAYER_VERSION = 'operations-1';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function resolveFlags() {
  const orchestrator = bool(process.env.OPERATIONS_ORCHESTRATOR_ENABLED, false);
  return {
    orchestrator,
    // las escrituras de jobs (run records, dead letters) solo si el orquestador está activo Y se habilita
    jobWrites: orchestrator && bool(process.env.OPERATIONS_JOB_WRITES_ENABLED, false),
    admin: orchestrator && bool(process.env.OPERATIONS_ADMIN_ENABLED, false),
  };
}

function resolveParams() {
  return {
    // intervalo del schedulerManager: con qué frecuencia evalúa si toca lanzar cada job
    tickIntervalMs: int(process.env.OPERATIONS_TICK_INTERVAL_MS, 15 * 1000),
    // heartbeat: cada cuánto un job largo actualiza heartbeat_at
    heartbeatIntervalMs: int(process.env.OPERATIONS_HEARTBEAT_INTERVAL_MS, 10 * 1000),
    // un run 'running' cuyo heartbeat supera esto se considera abandonado (stale) y es recuperable
    defaultStaleAfterMs: int(process.env.OPERATIONS_STALE_AFTER_MS, 5 * 60 * 1000),
    // timeout duro por defecto de un job (se puede sobreescribir por job)
    defaultTimeoutMs: int(process.env.OPERATIONS_DEFAULT_TIMEOUT_MS, 4 * 60 * 1000),
    // reintentos por defecto y backoff base (exponencial con jitter determinístico)
    defaultMaxRetries: int(process.env.OPERATIONS_DEFAULT_MAX_RETRIES, 2),
    defaultBackoffBaseMs: int(process.env.OPERATIONS_DEFAULT_BACKOFF_BASE_MS, 500),
    // cuántos runs históricos retiene status() por job (lectura)
    recentRunsLimit: int(process.env.OPERATIONS_RECENT_RUNS_LIMIT, 20),
    // margen de gracia para drenar jobs en vuelo durante shutdown
    shutdownDrainMs: int(process.env.OPERATIONS_SHUTDOWN_DRAIN_MS, 8 * 1000),
    // allowlist: si está seteada (lista separada por comas), el orquestador SOLO gestiona esos jobs y deja
    // el resto a los schedulers legacy. Permite activar p.ej. solo 'sportsbook_ingestion' sin tocar el
    // pipeline de arbitraje vivo. Vacío = gestiona todos los jobs habilitados.
    managedJobs: (process.env.OPERATIONS_MANAGED_JOBS || '').split(',').map(s => s.trim()).filter(Boolean),
  };
}

module.exports = {
  LAYER_VERSION,
  get flags() { return resolveFlags(); },
  get params() { return resolveParams(); },
  bool, int,
};
