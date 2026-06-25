-- 021 — Post-shadow Bloque B: separa "current state" de "history" para sportsbook_quotes.
-- Hoy cada run inserta un snapshot completo en sportsbook_quotes (raw legacy) atado a ingestion_run_id
-- (sin dedup → ~70 MB/día). Aquí se añaden DOS representaciones nuevas, ADITIVAS (no toca las 283k filas):
--   · sportsbook_quote_current  — UNA fila por identidad natural, con el último estado conocido.
--   · sportsbook_quote_history  — append-only, solo en cambio material (precio/disponibilidad/estado).
-- También añade heartbeat + reconciliación a sportsbook_ingestion_runs (Bloque D, runs huérfanos).
-- IDENTIDAD NATURAL (NO depende de ingestion_run_id):
--   (data_provider, external_event_id, market_family, period, sportsbook_code, external_outcome_id)

-- ---------- current state (Bloque B) ----------
CREATE TABLE IF NOT EXISTS sportsbook_quote_current (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- identidad natural
  data_provider        TEXT NOT NULL,
  sportsbook_code      TEXT NOT NULL,
  external_event_id    TEXT NOT NULL,
  market_family        TEXT NOT NULL,
  period               TEXT NOT NULL,
  external_outcome_id  TEXT NOT NULL,
  -- contexto de fuente (resuelto desde el catálogo)
  sportsbook_name      TEXT,
  operator_group       TEXT,
  independence_group   TEXT,
  source_role          TEXT DEFAULT 'market_consensus',
  jurisdiction         TEXT,
  -- enlace canónico (lo llena el wiring del Bloque G; null hasta matchear)
  canonical_event_id   UUID,
  canonical_market_id  UUID,
  canonical_outcome_id UUID,
  -- último estado conocido
  is_live              BOOLEAN NOT NULL DEFAULT false,
  odds_format          TEXT DEFAULT 'decimal',
  odds_decimal         NUMERIC(12,4),
  implied_probability  NUMERIC(12,8),
  raw_implied_probability NUMERIC(12,8),
  quote_status         TEXT DEFAULT 'open',          -- open | suspended
  stake_limit_status   TEXT DEFAULT 'unknown',
  maximum_stake        NUMERIC(20,2),
  external_market_id   TEXT,
  -- tiempos
  provider_update      TIMESTAMPTZ,                  -- last_update del proveedor (= quote_timestamp)
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- cuándo lo vimos por última vez (received_at)
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),  -- último cambio MATERIAL
  observation_count    INTEGER NOT NULL DEFAULT 1,    -- cuántas veces se observó (incluye no-cambios)
  -- procedencia
  normalizer_version   TEXT,
  last_ingestion_run_id UUID,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id)
);
CREATE INDEX IF NOT EXISTS idx_sbqc_event ON sportsbook_quote_current (external_event_id, market_family, period);
CREATE INDEX IF NOT EXISTS idx_sbqc_canonical ON sportsbook_quote_current (canonical_event_id) WHERE canonical_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sbqc_observed ON sportsbook_quote_current (observed_at DESC);
DROP TRIGGER IF EXISTS trg_sbqc_updated ON sportsbook_quote_current;
CREATE TRIGGER trg_sbqc_updated BEFORE UPDATE ON sportsbook_quote_current FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- history (Bloque B) — append-only, solo cambios materiales ----------
CREATE TABLE IF NOT EXISTS sportsbook_quote_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- identidad natural (denormalizada para consultas rápidas sin join)
  data_provider        TEXT NOT NULL,
  sportsbook_code      TEXT NOT NULL,
  external_event_id    TEXT NOT NULL,
  market_family        TEXT NOT NULL,
  period               TEXT NOT NULL,
  external_outcome_id  TEXT NOT NULL,
  independence_group   TEXT,
  canonical_event_id   UUID,
  -- estado observado en este punto de la historia
  change_type          TEXT NOT NULL,                -- new | price | availability | status | heartbeat
  is_live              BOOLEAN NOT NULL DEFAULT false,
  odds_decimal         NUMERIC(12,4),
  implied_probability  NUMERIC(12,8),
  quote_status         TEXT,
  -- estado anterior (para auditar el cambio)
  prev_odds_decimal    NUMERIC(12,4),
  prev_quote_status    TEXT,
  prev_provider_update TIMESTAMPTZ,
  -- tiempos
  provider_update      TIMESTAMPTZ,
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingestion_run_id     UUID,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sbqh_identity ON sportsbook_quote_history
  (data_provider, sportsbook_code, external_event_id, market_family, external_outcome_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sbqh_event ON sportsbook_quote_history (external_event_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sbqh_run ON sportsbook_quote_history (ingestion_run_id);

-- ---------- trigger: escribe history SOLO en cambio material ----------
-- Garantiza la separación current/history a nivel de DB (no se puede saltar desde la app). El upsert batch
-- de la app siempre toca current (bump observation_count/observed_at); este trigger decide si hubo cambio
-- MATERIAL (precio | estado open/suspended | live) y solo entonces inserta una fila de history.
-- Un nuevo provider_update SIN cambio de precio/estado NO genera history (evita el bloat de los 283k).
CREATE OR REPLACE FUNCTION sbq_write_history() RETURNS trigger AS $$
DECLARE ct TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ct := 'new';
  ELSIF NEW.odds_decimal IS DISTINCT FROM OLD.odds_decimal THEN
    ct := 'price';
  ELSIF NEW.quote_status IS DISTINCT FROM OLD.quote_status THEN
    ct := 'status';
  ELSIF NEW.is_live IS DISTINCT FROM OLD.is_live THEN
    ct := 'availability';
  ELSE
    ct := NULL;  -- sin cambio material → no history
  END IF;
  IF ct IS NOT NULL THEN
    INSERT INTO sportsbook_quote_history
      (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id,
       independence_group, canonical_event_id, change_type, is_live, odds_decimal, implied_probability,
       quote_status, prev_odds_decimal, prev_quote_status, prev_provider_update,
       provider_update, observed_at, ingestion_run_id, metadata)
    VALUES
      (NEW.data_provider, NEW.sportsbook_code, NEW.external_event_id, NEW.market_family, NEW.period, NEW.external_outcome_id,
       NEW.independence_group, NEW.canonical_event_id, ct, NEW.is_live, NEW.odds_decimal, NEW.implied_probability,
       NEW.quote_status,
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.odds_decimal     ELSE NULL END,
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.quote_status     ELSE NULL END,
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.provider_update  ELSE NULL END,
       NEW.provider_update, NEW.observed_at, NEW.last_ingestion_run_id, '{}'::jsonb);
  END IF;
  RETURN NULL;  -- AFTER trigger: el valor de retorno se ignora
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sbqc_history ON sportsbook_quote_current;
CREATE TRIGGER trg_sbqc_history AFTER INSERT OR UPDATE ON sportsbook_quote_current
  FOR EACH ROW EXECUTE FUNCTION sbq_write_history();

-- ---------- heartbeat + reconciliación de runs (Bloque D) ----------
-- sportsbook_ingestion_runs (mig 015) no tenía heartbeat → no se podían detectar runs huérfanos.
ALTER TABLE sportsbook_ingestion_runs ADD COLUMN IF NOT EXISTS heartbeat_at   TIMESTAMPTZ;
ALTER TABLE sportsbook_ingestion_runs ADD COLUMN IF NOT EXISTS run_type       TEXT DEFAULT 'scheduled';  -- scheduled | manual | replay
ALTER TABLE sportsbook_ingestion_runs ADD COLUMN IF NOT EXISTS reconciled_at  TIMESTAMPTZ;
ALTER TABLE sportsbook_ingestion_runs ADD COLUMN IF NOT EXISTS reconcile_note TEXT;
ALTER TABLE sportsbook_ingestion_runs ADD COLUMN IF NOT EXISTS error_code     TEXT;
-- estados válidos (convención, sin CHECK para no romper filas existentes):
--   running | success | partial | failed | timed_out | cancelled | abandoned
CREATE INDEX IF NOT EXISTS idx_sir_running ON sportsbook_ingestion_runs (status, heartbeat_at) WHERE status = 'running';

-- +migrate down
DROP TRIGGER IF EXISTS trg_sbqc_history ON sportsbook_quote_current;
DROP FUNCTION IF EXISTS sbq_write_history();
DROP INDEX IF EXISTS idx_sir_running;
ALTER TABLE sportsbook_ingestion_runs DROP COLUMN IF EXISTS error_code;
ALTER TABLE sportsbook_ingestion_runs DROP COLUMN IF EXISTS reconcile_note;
ALTER TABLE sportsbook_ingestion_runs DROP COLUMN IF EXISTS reconciled_at;
ALTER TABLE sportsbook_ingestion_runs DROP COLUMN IF EXISTS run_type;
ALTER TABLE sportsbook_ingestion_runs DROP COLUMN IF EXISTS heartbeat_at;
DROP TABLE IF EXISTS sportsbook_quote_history;
DROP TABLE IF EXISTS sportsbook_quote_current;
