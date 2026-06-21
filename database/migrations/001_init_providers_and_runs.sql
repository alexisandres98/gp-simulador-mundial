-- 001 — Extensiones, helper updated_at, providers e ingestion_runs.
-- Fundación del Sprint 0. Tablas vacías; los collectors que las llenan son Sprint 1.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Trigger genérico para mantener updated_at en cada UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- providers ----------
-- Catálogo de fuentes externas. NO guarda secretos (las API keys viven solo en variables de entorno).
CREATE TABLE IF NOT EXISTS providers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,              -- polymarket | kalshi | api_football | espn | sportsbook_x
  name                TEXT NOT NULL,
  provider_type       TEXT NOT NULL DEFAULT 'prediction_market'
                        CHECK (provider_type IN ('prediction_market','sportsbook','data_feed','other')),
  base_url            TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  supports_rest       BOOLEAN NOT NULL DEFAULT true,
  supports_websocket  BOOLEAN NOT NULL DEFAULT false,
  supports_orderbook  BOOLEAN NOT NULL DEFAULT false,
  supports_historical BOOLEAN NOT NULL DEFAULT false,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_providers_updated ON providers;
CREATE TRIGGER trg_providers_updated BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- ingestion_runs ----------
-- Auditoría de cada ejecución de un collector futuro. Resuelve el riesgo R9 (sin auditoría).
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  job_type          TEXT NOT NULL,                      -- p.ej. champion_markets | match_markets | orderbook
  status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','success','partial','failed','cancelled')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  records_received  INTEGER NOT NULL DEFAULT 0,
  records_written   INTEGER NOT NULL DEFAULT 0,
  records_rejected  INTEGER NOT NULL DEFAULT 0,
  request_count     INTEGER NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  error_summary     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_provider   ON ingestion_runs(provider_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started_at ON ingestion_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status     ON ingestion_runs(status);

-- +migrate down
DROP TABLE IF EXISTS ingestion_runs;
DROP TRIGGER IF EXISTS trg_providers_updated ON providers;
DROP TABLE IF EXISTS providers;
DROP FUNCTION IF EXISTS set_updated_at();
