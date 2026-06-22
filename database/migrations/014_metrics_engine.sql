-- 014 — Motor de métricas (track record verificable). Sprint 6.
-- Tablas DERIVADAS y reconstruibles (facts/aggregates/bins) + snapshots públicos INMUTABLES.
-- NO modifica señales ni datos de sprints previos. Reutiliza set_updated_at() y signal_forbid_mutation() (mig. 013).

-- ---------- metric_definitions (diccionario versionado) ----------
CREATE TABLE IF NOT EXISTS metric_definitions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_code        TEXT NOT NULL,
  metric_name        TEXT NOT NULL,
  metric_version     TEXT NOT NULL,
  signal_type        TEXT,
  calculation_type   TEXT,                 -- per_signal | aggregate
  formula_description TEXT,
  eligibility_policy TEXT,
  minimum_sample_size INTEGER,
  higher_is_better   BOOLEAN,
  unit               TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  methodology_url    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_code, metric_version)
);
DROP TRIGGER IF EXISTS trg_metric_def_updated ON metric_definitions;
CREATE TRIGGER trg_metric_def_updated BEFORE UPDATE ON metric_definitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- metric_runs ----------
CREATE TABLE IF NOT EXISTS metric_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','success','partial','failed','cancelled')),
  run_type         TEXT NOT NULL DEFAULT 'incremental'
                     CHECK (run_type IN ('incremental','full_rebuild','cohort_rebuild','correction_rebuild','dry_run')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  signals_scanned  INTEGER NOT NULL DEFAULT 0,
  facts_created    INTEGER NOT NULL DEFAULT 0,
  facts_updated    INTEGER NOT NULL DEFAULT 0,
  signals_excluded INTEGER NOT NULL DEFAULT 0,
  aggregates_created INTEGER NOT NULL DEFAULT 0,
  errors           INTEGER NOT NULL DEFAULT 0,
  metric_version   TEXT,
  code_version     TEXT,
  input_chain_head BIGINT,
  duration_ms      INTEGER,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_metric_runs_status ON metric_runs(status, created_at DESC);

-- ---------- signal_metric_facts (derivada, reconstruible) ----------
CREATE TABLE IF NOT EXISTS signal_metric_facts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  metric_version      TEXT NOT NULL,
  signal_type         TEXT,
  model_version       TEXT,
  methodology_version TEXT,
  sport               TEXT,
  competition         TEXT,
  market_family       TEXT,
  prediction_horizon  TEXT,
  probability_bucket  TEXT,
  data_quality        TEXT,
  published_at        TIMESTAMPTZ,
  event_start_at      TIMESTAMPTZ,
  settled_at          TIMESTAMPTZ,
  settlement_outcome  TEXT,
  benchmark_status    TEXT,
  experimental        BOOLEAN NOT NULL DEFAULT false,
  metrics             JSONB NOT NULL DEFAULT '{}'::jsonb,
  calibration_points  JSONB NOT NULL DEFAULT '[]'::jsonb,
  eligibility_status  TEXT,
  clv_eligibility_status TEXT,
  exclusion_reasons   JSONB NOT NULL DEFAULT '[]'::jsonb,
  cohort_dimensions   JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_hash          TEXT,
  run_id              UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, metric_version)
);
CREATE INDEX IF NOT EXISTS idx_smf_signal     ON signal_metric_facts(signal_id);
CREATE INDEX IF NOT EXISTS idx_smf_type       ON signal_metric_facts(signal_type);
CREATE INDEX IF NOT EXISTS idx_smf_model      ON signal_metric_facts(model_version);
CREATE INDEX IF NOT EXISTS idx_smf_published  ON signal_metric_facts(published_at);
CREATE INDEX IF NOT EXISTS idx_smf_settled    ON signal_metric_facts(settled_at);
CREATE INDEX IF NOT EXISTS idx_smf_elig       ON signal_metric_facts(eligibility_status);

-- ---------- metric_aggregates (derivada, reconstruible) ----------
CREATE TABLE IF NOT EXISTS metric_aggregates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_code       TEXT NOT NULL,
  metric_version    TEXT NOT NULL,
  cohort_key        TEXT NOT NULL,
  cohort_dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_size       INTEGER NOT NULL DEFAULT 0,
  eligible_count    INTEGER NOT NULL DEFAULT 0,
  excluded_count    INTEGER NOT NULL DEFAULT 0,
  value             NUMERIC(20,8),
  secondary_values  JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_interval JSONB,
  sample_status     TEXT,
  from_date         TIMESTAMPTZ,
  to_date           TIMESTAMPTZ,
  input_chain_head  BIGINT,
  idempotency_key   TEXT NOT NULL,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id            UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
DROP TRIGGER IF EXISTS trg_metric_agg_updated ON metric_aggregates;
CREATE TRIGGER trg_metric_agg_updated BEFORE UPDATE ON metric_aggregates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_magg_code   ON metric_aggregates(metric_code, metric_version);
CREATE INDEX IF NOT EXISTS idx_magg_cohort ON metric_aggregates(cohort_key);
CREATE INDEX IF NOT EXISTS idx_magg_sample ON metric_aggregates(sample_status);

-- ---------- metric_calibration_bins ----------
CREATE TABLE IF NOT EXISTS metric_calibration_bins (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id       UUID NOT NULL REFERENCES metric_aggregates(id) ON DELETE CASCADE,
  bucket_start       NUMERIC(10,6),
  bucket_end         NUMERIC(10,6),
  predicted_average  NUMERIC(10,6),
  observed_frequency NUMERIC(10,6),
  sample_size        INTEGER,
  confidence_low     NUMERIC(10,6),
  confidence_high    NUMERIC(10,6),
  absolute_gap       NUMERIC(10,6),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_calbins_agg ON metric_calibration_bins(aggregate_id);

-- ---------- public_metric_snapshots (INMUTABLE) ----------
CREATE TABLE IF NOT EXISTS public_metric_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id           TEXT UNIQUE,
  metric_versions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_chain_head    BIGINT,
  settlement_cutoff   TIMESTAMPTZ,
  sample_counts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  aggregate_values    JSONB NOT NULL DEFAULT '{}'::jsonb,
  methodology_version TEXT,
  content_hash        TEXT,
  published_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_metric_snap_immutable ON public_metric_snapshots;
CREATE TRIGGER trg_metric_snap_immutable BEFORE UPDATE OR DELETE ON public_metric_snapshots
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();
CREATE INDEX IF NOT EXISTS idx_metric_snap_pub ON public_metric_snapshots(published_at DESC);

-- +migrate down
DROP TABLE IF EXISTS metric_calibration_bins;
DROP TABLE IF EXISTS public_metric_snapshots;
DROP TABLE IF EXISTS metric_aggregates;
DROP TABLE IF EXISTS signal_metric_facts;
DROP TABLE IF EXISTS metric_runs;
DROP TABLE IF EXISTS metric_definitions;
