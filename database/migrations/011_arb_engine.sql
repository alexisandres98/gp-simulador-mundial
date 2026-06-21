-- 011 — Motor de arbitraje ejecutable V1 (Sprint 3). Fee schedules + runs + oportunidades + evaluaciones + legs.
-- Money en NUMERIC. Evaluaciones inmutables (una por conjunto de snapshots). No borra datos previos.

-- ---------- provider_fee_schedules ----------
CREATE TABLE IF NOT EXISTS provider_fee_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  schedule_code     TEXT NOT NULL,
  version           TEXT NOT NULL,
  effective_from    TIMESTAMPTZ,
  effective_to      TIMESTAMPTZ,
  market_scope      TEXT,
  fee_type          TEXT NOT NULL,
  formula           TEXT,
  parameters        JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_url        TEXT,
  source_checked_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'known' CHECK (status IN ('known','estimated','unknown')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, schedule_code, version)
);
DROP TRIGGER IF EXISTS trg_fee_sched_updated ON provider_fee_schedules;
CREATE TRIGGER trg_fee_sched_updated BEFORE UPDATE ON provider_fee_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- arb_engine_runs ----------
CREATE TABLE IF NOT EXISTS arb_engine_runs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed','cancelled')),
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at                 TIMESTAMPTZ,
  candidates_evaluated        INTEGER NOT NULL DEFAULT 0,
  pure_arb_count              INTEGER NOT NULL DEFAULT 0,
  execution_sensitive_count   INTEGER NOT NULL DEFAULT 0,
  conditional_count           INTEGER NOT NULL DEFAULT 0,
  discrepancy_count           INTEGER NOT NULL DEFAULT 0,
  rejected_count              INTEGER NOT NULL DEFAULT 0,
  error_count                 INTEGER NOT NULL DEFAULT 0,
  duration_ms                 INTEGER,
  engine_version              TEXT,
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arb_runs_started ON arb_engine_runs(started_at DESC);

-- ---------- arb_opportunities (ciclo de vida agregado) ----------
CREATE TABLE IF NOT EXISTS arb_opportunities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_key       TEXT NOT NULL UNIQUE,
  canonical_event_id    UUID REFERENCES canonical_events(id) ON DELETE SET NULL,
  canonical_market_id   UUID REFERENCES canonical_markets(id) ON DELETE SET NULL,
  classification        TEXT,
  first_detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at     TIMESTAMPTZ,
  expired_at            TIMESTAMPTZ,
  observation_count     INTEGER NOT NULL DEFAULT 0,
  best_net_roi          NUMERIC(20,8),
  best_net_profit       NUMERIC(20,8),
  best_executable_size  NUMERIC(28,8),
  current_evaluation_id UUID,
  status                TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','active','aging','expired','invalidated','rejected')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_arb_opp_updated ON arb_opportunities;
CREATE TRIGGER trg_arb_opp_updated BEFORE UPDATE ON arb_opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_arb_opp_classification ON arb_opportunities(classification);
CREATE INDEX IF NOT EXISTS idx_arb_opp_status ON arb_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_arb_opp_market ON arb_opportunities(canonical_market_id);
CREATE INDEX IF NOT EXISTS idx_arb_opp_last_seen ON arb_opportunities(last_seen_at DESC);

-- ---------- arb_evaluations (inmutable, una por conjunto de snapshots) ----------
CREATE TABLE IF NOT EXISTS arb_evaluations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_run_id          UUID REFERENCES arb_engine_runs(id) ON DELETE SET NULL,
  opportunity_key        TEXT NOT NULL,
  canonical_event_id     UUID,
  canonical_market_id    UUID,
  evaluation_type        TEXT,
  classification         TEXT,
  mapping_version        TEXT,
  rules_fingerprint      TEXT,
  snapshot_ids           TEXT[] NOT NULL DEFAULT '{}',
  input_hash             TEXT,
  leg_time_skew_ms       INTEGER,
  gross_margin           NUMERIC(20,8),
  fee_total              NUMERIC(20,8),
  book_slippage_total    NUMERIC(20,8),
  execution_buffer_total NUMERIC(20,8),
  net_margin             NUMERIC(20,8),
  capital_required       NUMERIC(28,8),
  net_profit             NUMERIC(20,8),
  net_roi                NUMERIC(20,8),
  max_executable_size    NUMERIC(28,8),
  confidence_score       INTEGER,
  confidence_label       TEXT,
  rejection_reasons      JSONB,
  warning_codes          JSONB,
  engine_version         TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- idempotencia: mismos snapshots + versión + estrategia no duplican
  UNIQUE (input_hash)
);
CREATE INDEX IF NOT EXISTS idx_arb_eval_oppkey ON arb_evaluations(opportunity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arb_eval_classification ON arb_evaluations(classification);
CREATE INDEX IF NOT EXISTS idx_arb_eval_run ON arb_evaluations(engine_run_id);
CREATE INDEX IF NOT EXISTS idx_arb_eval_market ON arb_evaluations(canonical_market_id, created_at DESC);

-- ---------- arb_evaluation_legs ----------
CREATE TABLE IF NOT EXISTS arb_evaluation_legs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id       UUID NOT NULL REFERENCES arb_evaluations(id) ON DELETE CASCADE,
  leg_index           INTEGER NOT NULL,
  provider_id         UUID REFERENCES providers(id) ON DELETE SET NULL,
  external_market_id  TEXT,
  external_outcome_id TEXT,
  canonical_outcome_id UUID,
  side                TEXT,
  quantity            NUMERIC(28,8),
  best_price          NUMERIC(20,8),
  vwap                NUMERIC(20,8),
  worst_price         NUMERIC(20,8),
  gross_cost          NUMERIC(28,8),
  fee                 NUMERIC(20,8),
  book_slippage       NUMERIC(20,8),
  execution_buffer    NUMERIC(20,8),
  price_source        TEXT,
  snapshot_id         TEXT,
  snapshot_age_ms     INTEGER,
  depth_consumed      INTEGER,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (evaluation_id, leg_index)
);
CREATE INDEX IF NOT EXISTS idx_arb_legs_eval ON arb_evaluation_legs(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_arb_legs_snapshot ON arb_evaluation_legs(snapshot_id);

-- +migrate down
DROP TABLE IF EXISTS arb_evaluation_legs;
DROP TABLE IF EXISTS arb_evaluations;
DROP TABLE IF EXISTS arb_opportunities;
DROP TABLE IF EXISTS arb_engine_runs;
DROP TABLE IF EXISTS provider_fee_schedules;
