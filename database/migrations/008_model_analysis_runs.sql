-- 008 — Registro experimental de ejecuciones de modelos (Sprint 0.1, scaffolding para validación).
-- Guarda cada ejecución de GP Intelligence (V2 challenger) junto al V1 control para comparar después.
-- Genérica para reutilizar en futuros modelos. Se escribe SOLO si GP_INTELLIGENCE_EXPERIMENT_LOGGING=true
-- y hay DB; un fallo al registrar NUNCA rompe la simulación del usuario. NO se mezcla con el track record.

CREATE TABLE IF NOT EXISTS model_analysis_runs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_type              TEXT NOT NULL DEFAULT 'h2h_sandbox',
  status                     TEXT NOT NULL DEFAULT 'completed'
                               CHECK (status IN ('completed','failed','partial')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at               TIMESTAMPTZ,
  control_model_version      TEXT,
  challenger_model_version   TEXT,
  factor_policy_version      TEXT,
  input_hash                 TEXT,
  random_seed                BIGINT,
  simulation_count           INTEGER,
  team_a_reference           TEXT,
  team_b_reference           TEXT,
  event_reference            TEXT,
  input_payload              JSONB,
  context_payload            JSONB,
  control_output             JSONB,
  challenger_output          JSONB,
  data_quality_payload       JSONB,
  metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_model_runs_type     ON model_analysis_runs(analysis_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_runs_inputhash ON model_analysis_runs(input_hash);
CREATE INDEX IF NOT EXISTS idx_model_runs_teams    ON model_analysis_runs(team_a_reference, team_b_reference);

-- +migrate down
DROP TABLE IF EXISTS model_analysis_runs;
