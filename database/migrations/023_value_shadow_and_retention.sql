-- 023 — Post-shadow Bloques K + B.
-- K: tablas de SHADOW para el Value dry-run. Semánticamente SEPARADAS de las oficiales (value_evaluations,
--    value_opportunities, pick_candidates): NUNCA las consumen endpoints públicos, tienen su propia retención
--    y nunca producen Picks/señales. Permiten correr el pipeline completo con WRITE oficial = false.
-- B: auditoría de retención (cada purga es configurable, incremental, auditable y pausada por defecto).

-- ---------- K: shadow runs del Value dry-run ----------
CREATE TABLE IF NOT EXISTS sportsbook_value_shadow_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status               TEXT NOT NULL DEFAULT 'running',  -- running | success | partial | failed
  evaluated            INTEGER NOT NULL DEFAULT 0,
  blocked              INTEGER NOT NULL DEFAULT 0,
  pass                 INTEGER NOT NULL DEFAULT 0,
  watch                INTEGER NOT NULL DEFAULT 0,
  lean                 INTEGER NOT NULL DEFAULT 0,
  strong               INTEGER NOT NULL DEFAULT 0,
  policy_versions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary              JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ,
  duration_ms          INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_svsr_started ON sportsbook_value_shadow_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS sportsbook_value_shadow_evaluations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_run_id        UUID NOT NULL REFERENCES sportsbook_value_shadow_runs(id) ON DELETE CASCADE,
  -- identidad del evento/outcome (admin/interno; sin payloads completos ni secrets)
  canonical_event_id   UUID,
  canonical_market_id  UUID,
  external_event_id    TEXT,
  selection            TEXT,                 -- home | draw | away
  event_label          TEXT,                 -- "Home vs Away" para auditoría humana
  classification       TEXT,                 -- pass | watch | lean | strong | blocked
  reason_codes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  strong_blockers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_count         INTEGER,
  verified_independence_groups INTEGER,
  consensus_completeness TEXT,               -- complete | incomplete
  no_vig_methods       JSONB NOT NULL DEFAULT '{}'::jsonb,
  method_disagreement  NUMERIC(12,8),
  ensemble_probability NUMERIC(12,8),
  uncertainty_score    INTEGER,
  quality_score        INTEGER,
  best_decimal_odds    NUMERIC(12,4),
  minimum_acceptable_odds NUMERIC(12,4),
  maximum_acceptable_price NUMERIC(12,8),
  freshness_ok         BOOLEAN,
  policy_versions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_svse_run ON sportsbook_value_shadow_evaluations (shadow_run_id);
CREATE INDEX IF NOT EXISTS idx_svse_class ON sportsbook_value_shadow_evaluations (classification);

-- ---------- B: auditoría de retención ----------
CREATE TABLE IF NOT EXISTS sportsbook_retention_audit (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                 TEXT NOT NULL,        -- dry_run | execute
  target_table         TEXT NOT NULL,        -- sportsbook_quotes | sportsbook_quote_history
  scope                TEXT,                 -- redundant_raw | closed_event | material_history | ...
  cutoff_at            TIMESTAMPTZ,
  rows_considered      BIGINT NOT NULL DEFAULT 0,
  rows_deleted         BIGINT NOT NULL DEFAULT 0,
  flags_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  executed_by          TEXT,
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sra_created ON sportsbook_retention_audit (created_at DESC);

-- +migrate down
DROP TABLE IF EXISTS sportsbook_retention_audit;
DROP TABLE IF EXISTS sportsbook_value_shadow_evaluations;
DROP TABLE IF EXISTS sportsbook_value_shadow_runs;
