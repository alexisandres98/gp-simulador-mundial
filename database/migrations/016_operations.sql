-- 016 — Operaciones (Sprint 8A · fundación). No modifica datos previos. Reutiliza set_updated_at() de mig. previas.
-- Capa de orquestación: registro de ejecuciones de jobs + dead letters. Tablas DERIVADAS/operativas
-- (reconstruibles, no inmutables): no contienen señales, hashes, settlements ni secretos.

-- ---------- operational_job_runs (§14) — una fila por ejecución de un job ----------
CREATE TABLE IF NOT EXISTS operational_job_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name          TEXT NOT NULL,
  run_type          TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled | manual | recovery
  status            TEXT NOT NULL DEFAULT 'queued',       -- queued|running|success|partial|failed|timed_out|blocked|disabled|stale|cancelled
  scheduled_for     TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  heartbeat_at      TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  attempt           INTEGER NOT NULL DEFAULT 1,
  lock_acquired     BOOLEAN NOT NULL DEFAULT false,
  records_scanned   INTEGER NOT NULL DEFAULT 0,
  records_created   INTEGER NOT NULL DEFAULT 0,
  records_updated   INTEGER NOT NULL DEFAULT 0,
  records_skipped   INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,
  error_summary     TEXT,                                 -- redactado: nunca secretos ni payloads crudos sensibles
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ojr_job_created   ON operational_job_runs (job_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ojr_status        ON operational_job_runs (status);
-- recuperación de runs abandonadas: las que siguen 'running' con heartbeat viejo
CREATE INDEX IF NOT EXISTS idx_ojr_running_hb    ON operational_job_runs (heartbeat_at) WHERE status = 'running';

-- ---------- operational_dead_letters (§24) — operaciones que no completaron tras los retries ----------
CREATE TABLE IF NOT EXISTS operational_dead_letters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name          TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         TEXT,
  error_code        TEXT,
  safe_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- SIN secretos ni payloads crudos sensibles
  attempts          INTEGER NOT NULL DEFAULT 1,
  first_failed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'open',          -- open | retrying | resolved | ignored
  resolution_note   TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_odl_status   ON operational_dead_letters (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_odl_job      ON operational_dead_letters (job_name);
-- dedup suave: una entrada abierta por (job, entity)
CREATE UNIQUE INDEX IF NOT EXISTS uq_odl_open_entity
  ON operational_dead_letters (job_name, entity_type, entity_id)
  WHERE status IN ('open', 'retrying');

-- ---------- admin_audit_events (§62) — auditoría de acciones administrativas importantes ----------
CREATE TABLE IF NOT EXISTS admin_audit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id     TEXT,
  action            TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         TEXT,
  request_id        TEXT,
  before_safe       JSONB,
  after_safe        JSONB,
  reason            TEXT,
  ip_hash           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aae_created ON admin_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aae_action  ON admin_audit_events (action, created_at DESC);

-- +migrate down
DROP TABLE IF EXISTS admin_audit_events;
DROP TABLE IF EXISTS operational_dead_letters;
DROP TABLE IF EXISTS operational_job_runs;
