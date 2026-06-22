-- 017 — Proveedor real de sportsbooks (Sprint 8A §7-11). Extiende sportsbook_quotes (mig 015, aditivo, no
-- borra datos) + catálogo de fuentes (operator/independence group, auditable) + estado de cuota del proveedor.

-- ---------- extensión de sportsbook_quotes (§7) ----------
ALTER TABLE sportsbook_quotes ADD COLUMN IF NOT EXISTS data_provider        TEXT;
ALTER TABLE sportsbook_quotes ADD COLUMN IF NOT EXISTS sportsbook_name      TEXT;
ALTER TABLE sportsbook_quotes ADD COLUMN IF NOT EXISTS jurisdiction         TEXT;
ALTER TABLE sportsbook_quotes ADD COLUMN IF NOT EXISTS raw_implied_probability NUMERIC(12,8);
ALTER TABLE sportsbook_quotes ADD COLUMN IF NOT EXISTS stake_limit_status   TEXT DEFAULT 'unknown';
ALTER TABLE sportsbook_quotes ADD COLUMN IF NOT EXISTS ingestion_run_id     UUID;
-- idempotencia de ingesta: una cuota por (book, evento, mercado, outcome, run)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sbq_book_outcome_run
  ON sportsbook_quotes (sportsbook_code, external_event_id, market_family, external_outcome_id, ingestion_run_id);
CREATE INDEX IF NOT EXISTS idx_sbq_event ON sportsbook_quotes (external_event_id, received_at DESC);

-- ---------- sportsbook_source_metadata (§11) — catálogo revisable de casas y grupos de independencia ----------
CREATE TABLE IF NOT EXISTS sportsbook_source_metadata (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_provider       TEXT NOT NULL,            -- de dónde viene la cuota (the_odds_api)
  sportsbook_code     TEXT NOT NULL,            -- key de la casa (pinnacle, williamhill, ...)
  sportsbook_name     TEXT,
  operator_group      TEXT,                     -- dueño/operador (varias marcas = un operador)
  independence_group  TEXT,                     -- skins del mismo operador NO cuentan como fuentes independientes
  source_role         TEXT NOT NULL DEFAULT 'market_consensus',  -- market_consensus | sharp_reference
  jurisdiction        TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  version             INTEGER NOT NULL DEFAULT 1,
  updated_by          TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_provider, sportsbook_code)
);
CREATE INDEX IF NOT EXISTS idx_ssm_indep ON sportsbook_source_metadata (independence_group);
DROP TRIGGER IF EXISTS trg_ssm_updated ON sportsbook_source_metadata;
CREATE TRIGGER trg_ssm_updated BEFORE UPDATE ON sportsbook_source_metadata FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- sportsbook_provider_state (§8) — cuota/rate/health del proveedor (una fila por proveedor) ----------
CREATE TABLE IF NOT EXISTS sportsbook_provider_state (
  provider_name       TEXT PRIMARY KEY,
  requests_used       INTEGER,
  requests_remaining  INTEGER,
  requests_last_cost  INTEGER,
  requests_reset_at   TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error_at       TIMESTAMPTZ,
  last_error_code     TEXT,
  provider_status     TEXT NOT NULL DEFAULT 'unknown',  -- ok | degraded | quota_critical | down | unknown
  circuit_state       TEXT NOT NULL DEFAULT 'closed',   -- closed | open | half_open
  circuit_opened_at   TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sps_updated ON sportsbook_provider_state;
CREATE TRIGGER trg_sps_updated BEFORE UPDATE ON sportsbook_provider_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +migrate down
DROP TABLE IF EXISTS sportsbook_provider_state;
DROP TABLE IF EXISTS sportsbook_source_metadata;
DROP INDEX IF EXISTS idx_sbq_event;
DROP INDEX IF EXISTS uq_sbq_book_outcome_run;
ALTER TABLE sportsbook_quotes DROP COLUMN IF EXISTS ingestion_run_id;
ALTER TABLE sportsbook_quotes DROP COLUMN IF EXISTS stake_limit_status;
ALTER TABLE sportsbook_quotes DROP COLUMN IF EXISTS raw_implied_probability;
ALTER TABLE sportsbook_quotes DROP COLUMN IF EXISTS jurisdiction;
ALTER TABLE sportsbook_quotes DROP COLUMN IF EXISTS sportsbook_name;
ALTER TABLE sportsbook_quotes DROP COLUMN IF EXISTS data_provider;
