-- 035 — Fase N.1: lifecycle SHADOW (closing/settlement/metrics) + observabilidad de jobs shadow + model family.
-- ADITIVA, reversible, INERTE. NADA escribe en tablas oficiales (signal_closing_snapshots, signal_settlements,
-- metric_facts). NO toca Registry/Picks/Verified Epoch. Reusa signal_forbid_mutation()/set_updated_at().

-- model family en goal snapshots (Poisson+DC vs overdispersion) + desacuerdo entre familias
ALTER TABLE goal_model_snapshots
  ADD COLUMN IF NOT EXISTS goal_model_family       TEXT NOT NULL DEFAULT 'poisson_dc',
  ADD COLUMN IF NOT EXISTS model_family_disagreement NUMERIC(10,6);

-- ---------- observabilidad de jobs shadow (lock/heartbeat/timeout/quota) ----------
CREATE TABLE IF NOT EXISTS shadow_job_runs (
  run_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name         TEXT NOT NULL,                          -- context|v2_eval|goal_model|goal_market_totals|goal_value|shadow_closing|shadow_settlement|shadow_metrics
  status           TEXT NOT NULL DEFAULT 'running',        -- running|success|failed|timed_out|skipped
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  heartbeat_at     TIMESTAMPTZ,
  duration_ms      INTEGER,
  rows_processed   INTEGER NOT NULL DEFAULT 0,
  quota_before     INTEGER,
  quota_after      INTEGER,
  requests_charged INTEGER,
  error_reason     TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_shadowjob_name ON shadow_job_runs(job_name, started_at DESC);

-- lock anti-solape por job
CREATE TABLE IF NOT EXISTS shadow_job_locks (
  job_name     TEXT PRIMARY KEY,
  locked_at    TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  holder       TEXT
);

-- ---------- shadow closing (NO oficial) ----------
CREATE TABLE IF NOT EXISTS shadow_closing_snapshots (
  closing_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id    UUID,
  subject_type          TEXT NOT NULL,                     -- v2_1x2 | goal_total | btts
  market_id             TEXT,                              -- TOTAL_GOALS_OVER_2_5 | null para 1x2
  outcome               TEXT,                              -- home|draw|away|over|under|yes|no
  period_code           TEXT NOT NULL DEFAULT 'REGULATION',
  publication_at        TIMESTAMPTZ,
  closing_at            TIMESTAMPTZ,
  publication_probability NUMERIC(20,8),
  closing_probability   NUMERIC(20,8),
  publication_odds      NUMERIC(20,8),
  closing_fair_odds     NUMERIC(20,8),
  price_clv             NUMERIC(20,8),
  entry_vs_closing_gap  NUMERIC(20,8),
  market_movement_no_vig NUMERIC(20,8),
  closing_status        TEXT NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE|UNAVAILABLE|STALE|EVENT_STARTED
  input_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shclosing_event ON shadow_closing_snapshots(canonical_event_id);
DROP TRIGGER IF EXISTS trg_shclosing_immutable ON shadow_closing_snapshots;
CREATE TRIGGER trg_shclosing_immutable BEFORE UPDATE OR DELETE ON shadow_closing_snapshots
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- shadow settlement (NO oficial; append-only versionado) ----------
CREATE TABLE IF NOT EXISTS shadow_settlements (
  settlement_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id    UUID,
  subject_type          TEXT NOT NULL,                     -- v2_1x2 | goal_total | btts
  market_id             TEXT,
  outcome               TEXT,
  settlement_version    INTEGER NOT NULL DEFAULT 1,
  settlement_status     TEXT NOT NULL DEFAULT 'pending',   -- pending|final|unresolved|void|corrected
  result_outcome        TEXT,                              -- home|draw|away|won|lost|push|void
  regulation_home_goals INTEGER,
  regulation_away_goals INTEGER,
  result_observed_at    TIMESTAMPTZ,
  settlement_policy_version TEXT NOT NULL DEFAULT 'shadow-settlement-1',
  input_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shsettle_event ON shadow_settlements(canonical_event_id);
DROP TRIGGER IF EXISTS trg_shsettle_immutable ON shadow_settlements;
CREATE TRIGGER trg_shsettle_immutable BEFORE UPDATE OR DELETE ON shadow_settlements
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- shadow metrics facts (NO oficial; congela prob publicada + resultado) ----------
CREATE TABLE IF NOT EXISTS shadow_metric_facts (
  fact_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id    UUID,
  model_label           TEXT NOT NULL,                     -- V1 | V2 | MARKET | GOAL
  subject_type          TEXT NOT NULL,                     -- 1x2 | goal_total | btts
  market_id             TEXT,
  published_probability JSONB,                             -- {home,draw,away} o {over,under}/{yes,no}
  closing_probability   JSONB,
  result_outcome        TEXT,
  brier_score           NUMERIC(20,8),
  log_loss              NUMERIC(20,8),
  clv_probability       NUMERIC(20,8),
  metrics_policy_version TEXT NOT NULL DEFAULT 'shadow-metrics-1',
  input_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shmetric_event ON shadow_metric_facts(canonical_event_id);
DROP TRIGGER IF EXISTS trg_shmetric_immutable ON shadow_metric_facts;
CREATE TRIGGER trg_shmetric_immutable BEFORE UPDATE OR DELETE ON shadow_metric_facts
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- +migrate down
DROP TABLE IF EXISTS shadow_metric_facts;
DROP TABLE IF EXISTS shadow_settlements;
DROP TABLE IF EXISTS shadow_closing_snapshots;
DROP TABLE IF EXISTS shadow_job_locks;
DROP TABLE IF EXISTS shadow_job_runs;
ALTER TABLE goal_model_snapshots DROP COLUMN IF EXISTS goal_model_family, DROP COLUMN IF EXISTS model_family_disagreement;
