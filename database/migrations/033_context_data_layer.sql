-- 033 — Fase M.2: DATA LAYER + PROVENANCE para GP Intelligence V2 (motor oficial futuro).
-- ADITIVA, reversible, INERTE: crea el esquema para persistir contexto point-in-time, probabilidades V2,
-- catálogo de fuentes, políticas de factores y la maquinaria de promoción/cutover de modelo. NADA de esto se
-- cablea aún al pipeline oficial (V1 sigue siendo el único modelo en producción). NO toca Signals/Registry/
-- Picks/metric_facts/Verified Epoch ni value_evaluations. Reusa signal_forbid_mutation() (append-only) y
-- set_updated_at() (mutables), definidas en 013/001.

-- ---------- catálogo de fuentes de contexto (provenance + licencia + cobertura) ----------
CREATE TABLE IF NOT EXISTS contextual_source_catalog (
  source_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key          TEXT NOT NULL UNIQUE,                  -- 'api_football' | 'espn' | 'manual' | 'the_odds_api' | ...
  source_name         TEXT NOT NULL,
  source_type         TEXT NOT NULL,                         -- provider | public | manual | derived
  categories          JSONB NOT NULL DEFAULT '[]'::jsonb,    -- ['player','team','tactics','environment','market','competitive']
  base_url            TEXT,
  has_source_timestamps BOOLEAN NOT NULL DEFAULT false,      -- ¿la fuente entrega published_at/observed_at reales?
  national_team_coverage TEXT NOT NULL DEFAULT 'unknown',    -- full | partial | none | unknown
  license_note        TEXT,
  quota_note          TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',    -- verified | unverified | excluded
  is_active           BOOLEAN NOT NULL DEFAULT true,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ctx_source_type_chk CHECK (source_type IN ('provider','public','manual','derived')),
  CONSTRAINT ctx_source_coverage_chk CHECK (national_team_coverage IN ('full','partial','none','unknown'))
);
DROP TRIGGER IF EXISTS trg_ctx_source_updated ON contextual_source_catalog;
CREATE TRIGGER trg_ctx_source_updated BEFORE UPDATE ON contextual_source_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- políticas de factores versionadas (caps / confidence / decay / fact-required) ----------
CREATE TABLE IF NOT EXISTS factor_policy_versions (
  policy_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_policy_version  TEXT NOT NULL,                     -- 'context-policy-1'
  factor_code             TEXT NOT NULL,                     -- 'GK_FORM' | 'KEY_PLAYER_OUT' | 'REST' | 'WEATHER_WIND' | ...
  category                TEXT NOT NULL,                     -- player | team | tactics | environment | market | competitive
  subject_type            TEXT NOT NULL DEFAULT 'team',      -- team | player | match | environment | market
  max_logit_delta         NUMERIC(10,6) NOT NULL DEFAULT 0,  -- cap por factor (en log-odds)
  max_category_logit_delta NUMERIC(10,6) NOT NULL DEFAULT 0, -- cap por categoría
  confidence_weight       NUMERIC(6,4) NOT NULL DEFAULT 1,   -- ponderación por confianza
  decay_half_life_ms      BIGINT,                            -- decaimiento temporal (null = sin decay)
  min_sample_size         INTEGER NOT NULL DEFAULT 0,
  fact_required           BOOLEAN NOT NULL DEFAULT false,    -- ¿exige FACT verificable para impactar?
  default_impact          NUMERIC(10,6) NOT NULL DEFAULT 0,  -- impacto por defecto (normalmente 0)
  enabled                 BOOLEAN NOT NULL DEFAULT false,    -- INERTE por defecto
  effective_from          TIMESTAMPTZ,
  effective_to            TIMESTAMPTZ,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (context_policy_version, factor_code)
);

-- ---------- observaciones de contexto (append-only, provenance point-in-time, §5 del spec) ----------
CREATE TABLE IF NOT EXISTS context_observations (
  observation_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id        UUID,
  context_policy_version  TEXT NOT NULL DEFAULT 'context-policy-1',
  factor_code             TEXT NOT NULL,
  category                TEXT,
  subject_type            TEXT NOT NULL,                     -- team | player | match | environment | market
  subject_id              TEXT,                              -- code del equipo / id de jugador / etc.
  canonical_event_id      UUID,                              -- event_id (sin FK dura: el contexto puede preceder al canónico)
  source_type             TEXT NOT NULL,                     -- provider | public | manual | derived
  source_name             TEXT NOT NULL,
  source_reference        TEXT,                              -- url / endpoint / archivo
  observed_at             TIMESTAMPTZ,                       -- cuándo el proveedor observó el dato
  published_at            TIMESTAMPTZ,                       -- cuándo la fuente publicó el dato
  valid_from              TIMESTAMPTZ,
  valid_until             TIMESTAMPTZ,
  confidence              NUMERIC(6,4) NOT NULL DEFAULT 0,
  fact_or_inference       TEXT NOT NULL DEFAULT 'UNKNOWN',   -- FACT | INFERENCE | RUMOR | UNKNOWN
  direction               TEXT,                              -- home | away | tempo | variance | draw | neutral
  raw_value               JSONB,
  normalized_value        NUMERIC(14,6),
  proposed_impact         NUMERIC(10,6) NOT NULL DEFAULT 0,
  applied_impact          NUMERIC(10,6) NOT NULL DEFAULT 0,
  reason                  TEXT,
  evidence_hash           TEXT,
  cutoff_at               TIMESTAMPTZ,                       -- corte point-in-time usado al ingerir/evaluar
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ctx_obs_fact_chk CHECK (fact_or_inference IN ('FACT','INFERENCE','RUMOR','UNKNOWN'))
);
CREATE INDEX IF NOT EXISTS idx_ctx_obs_event ON context_observations(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_ctx_obs_subject ON context_observations(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_ctx_obs_factor ON context_observations(factor_code);
DROP TRIGGER IF EXISTS trg_ctx_obs_immutable ON context_observations;
CREATE TRIGGER trg_ctx_obs_immutable BEFORE UPDATE OR DELETE ON context_observations
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- corridas de evaluación de contexto (agrupan observaciones en una evaluación V2) ----------
CREATE TABLE IF NOT EXISTS context_evaluation_runs (
  run_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id      UUID,
  context_policy_version  TEXT NOT NULL,
  factor_policy_version   TEXT,
  cutoff_at               TIMESTAMPTZ,                       -- corte point-in-time
  evaluated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  observation_count       INTEGER NOT NULL DEFAULT 0,
  applied_factor_count    INTEGER NOT NULL DEFAULT 0,
  context_state           TEXT NOT NULL DEFAULT 'BASE_ONLY_FALLBACK', -- FULL_CONTEXT|PARTIAL_CONTEXT|BASE_ONLY_FALLBACK|BLOCKED
  context_completeness    NUMERIC(6,4),
  data_freshness          NUMERIC(6,4),
  missing_critical_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ctx_run_state_chk CHECK (context_state IN ('FULL_CONTEXT','PARTIAL_CONTEXT','BASE_ONLY_FALLBACK','BLOCKED'))
);
CREATE INDEX IF NOT EXISTS idx_ctx_run_event ON context_evaluation_runs(canonical_event_id);

-- ---------- snapshots de probabilidad V2 (append-only, versionado, point-in-time, idempotente) ----------
CREATE TABLE IF NOT EXISTS v2_probability_snapshots (
  snapshot_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context_evaluation_run_id UUID REFERENCES context_evaluation_runs(run_id),
  canonical_event_id        UUID,
  market_code               TEXT NOT NULL DEFAULT '1X2',
  period_code               TEXT NOT NULL DEFAULT 'REGULATION',
  model_family              TEXT NOT NULL DEFAULT 'GP_INTELLIGENCE_V2',
  model_version             TEXT NOT NULL,
  context_policy_version    TEXT,
  calibration_version       TEXT,
  base_probability_vector   JSONB,                           -- {home,draw,away} de la base calibrada
  context_adjustments       JSONB,                           -- deltas por factor (log-odds)
  pre_uncertainty_vector    JSONB,                           -- {home,draw,away} antes de penalizar por uncertainty
  final_probability_vector  JSONB,                           -- {home,draw,away} V2 final
  confidence                NUMERIC(6,4),
  uncertainty               NUMERIC(6,4),
  data_freshness            NUMERIC(6,4),
  context_completeness      NUMERIC(6,4),
  source_count              INTEGER NOT NULL DEFAULT 0,
  factor_count              INTEGER NOT NULL DEFAULT 0,
  missing_critical_inputs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_state             TEXT NOT NULL DEFAULT 'BASE_ONLY_FALLBACK',
  cutoff_at                 TIMESTAMPTZ,
  evaluated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  input_hash                TEXT NOT NULL UNIQUE,            -- idempotencia: misma entrada → mismo snapshot
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT v2_snap_state_chk CHECK (context_state IN ('FULL_CONTEXT','PARTIAL_CONTEXT','BASE_ONLY_FALLBACK','BLOCKED'))
);
CREATE INDEX IF NOT EXISTS idx_v2_snap_event ON v2_probability_snapshots(canonical_event_id);
DROP TRIGGER IF EXISTS trg_v2_snap_immutable ON v2_probability_snapshots;
CREATE TRIGGER trg_v2_snap_immutable BEFORE UPDATE OR DELETE ON v2_probability_snapshots
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- política de promoción de modelo (cutover V1 → V2 versionado y reversible) ----------
CREATE TABLE IF NOT EXISTS model_promotion_policies (
  policy_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from         TIMESTAMPTZ,
  previous_official_model TEXT NOT NULL,
  new_official_model     TEXT NOT NULL,
  model_version          TEXT NOT NULL,
  calibration_version    TEXT,
  context_policy_version TEXT,
  approved_by            TEXT,
  approved_at            TIMESTAMPTZ,
  reason                 TEXT,
  rollback_version       TEXT,
  status                 TEXT NOT NULL DEFAULT 'proposed',   -- proposed | active | rolled_back | superseded
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT model_promo_status_chk CHECK (status IN ('proposed','active','rolled_back','superseded'))
);
DROP TRIGGER IF EXISTS trg_model_promo_updated ON model_promotion_policies;
CREATE TRIGGER trg_model_promo_updated BEFORE UPDATE ON model_promotion_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- eventos de cutover (append-only, auditoría de la promoción) ----------
CREATE TABLE IF NOT EXISTS model_cutover_events (
  event_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     UUID REFERENCES model_promotion_policies(policy_id),
  event_type    TEXT NOT NULL,                               -- proposed | approved | activated | rolled_back
  from_model    TEXT,
  to_model      TEXT,
  actor_id      TEXT,
  reason        TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT model_cutover_type_chk CHECK (event_type IN ('proposed','approved','activated','rolled_back'))
);
CREATE INDEX IF NOT EXISTS idx_model_cutover_policy ON model_cutover_events(policy_id);
DROP TRIGGER IF EXISTS trg_model_cutover_immutable ON model_cutover_events;
CREATE TRIGGER trg_model_cutover_immutable BEFORE UPDATE OR DELETE ON model_cutover_events
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- +migrate down
DROP TABLE IF EXISTS model_cutover_events;
DROP TABLE IF EXISTS model_promotion_policies;
DROP TABLE IF EXISTS v2_probability_snapshots;
DROP TABLE IF EXISTS context_evaluation_runs;
DROP TABLE IF EXISTS context_observations;
DROP TABLE IF EXISTS factor_policy_versions;
DROP TABLE IF EXISTS contextual_source_catalog;
