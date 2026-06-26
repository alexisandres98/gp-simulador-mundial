-- 024 — Checkpoint 2.1: hardening semántico + metadata del Value interno. ADITIVA (no toca fórmulas/datos
-- matemáticos de las 48). Distingue scope/elegibilidad, persiste casa de mejor cuota, conteos verificados vs
-- crudos, quality raw/max/componentes, descomposición del edge, y una tabla diagnóstica V2 aislada.

-- ---------- scope / elegibilidad (§2) ----------
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS evaluation_mode TEXT;            -- shadow|internal_validation|internal_operational|official_registry_eligible|internal_validation_pre_epoch
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS validation_run_id UUID;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS registry_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS pick_candidate_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS public_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS created_before_verified_epoch BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS official_gp_model TEXT NOT NULL DEFAULT 'V1';
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS challenger_gp_model TEXT NOT NULL DEFAULT 'V2';
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS challenger_official_weight NUMERIC(6,4) NOT NULL DEFAULT 0;

-- ---------- casa de la mejor cuota (§4) ----------
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS best_sportsbook_code TEXT;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS best_sportsbook_name TEXT;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS best_price_observed_at TIMESTAMPTZ;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS best_price_provider_updated_at TIMESTAMPTZ;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS best_price_deep_link TEXT;

-- ---------- conteos verificados vs crudos (§5) ----------
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS raw_sportsbook_count INTEGER;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS usable_sportsbook_count INTEGER;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS verified_sportsbook_count INTEGER;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS unverified_sportsbook_count INTEGER;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS duplicate_skin_count INTEGER;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS verified_independence_group_count INTEGER;

-- ---------- quality raw/max/componentes (§6) — NO cambia quality_score legacy (gate) ----------
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS quality_raw_points NUMERIC(8,2);
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS quality_max_points NUMERIC(8,2);
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS quality_normalized_percent NUMERIC(6,2);
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS quality_components JSONB;
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS quality_policy_version TEXT;

-- ---------- descomposición del edge (§7) ----------
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS gp_vs_consensus_pp NUMERIC(12,8);
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS ensemble_vs_consensus_pp NUMERIC(12,8);
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS consensus_vs_best_price_break_even_pp NUMERIC(12,8);
ALTER TABLE value_evaluations ADD COLUMN IF NOT EXISTS edge_source_code TEXT;  -- MODEL_DISAGREEMENT|BEST_PRICE_DISPERSION|HYBRID|NO_ACTIONABLE_EDGE

-- ---------- value_opportunities: mismo scope/elegibilidad ----------
ALTER TABLE value_opportunities ADD COLUMN IF NOT EXISTS evaluation_mode TEXT;
ALTER TABLE value_opportunities ADD COLUMN IF NOT EXISTS registry_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE value_opportunities ADD COLUMN IF NOT EXISTS pick_candidate_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE value_opportunities ADD COLUMN IF NOT EXISTS public_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE value_opportunities ADD COLUMN IF NOT EXISTS created_before_verified_epoch BOOLEAN NOT NULL DEFAULT true;

-- ---------- tabla diagnóstica V2 (challenger) — AISLADA de las oficiales (§8) ----------
CREATE TABLE IF NOT EXISTS value_v2_diagnostics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_run_id    UUID,
  value_evaluation_id  UUID,
  canonical_event_id   UUID,
  selection            TEXT,
  v1_probability       NUMERIC(12,8),
  v2_probability       NUMERIC(12,8),
  difference_pp        NUMERIC(12,8),
  context_features_available JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_features_missing   JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_adjustment_elo NUMERIC(8,2),
  v1_classification    TEXT,
  hypothetical_v2_classification TEXT,
  v1_adjusted_edge_pp  NUMERIC(12,8),
  hypothetical_v2_adjusted_edge_pp NUMERIC(12,8),
  v2_status            TEXT NOT NULL DEFAULT 'computed',  -- computed | unavailable
  v2_reason            TEXT,
  challenger_official_weight NUMERIC(6,4) NOT NULL DEFAULT 0,
  registry_eligible    BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v2diag_event ON value_v2_diagnostics (canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_v2diag_run ON value_v2_diagnostics (validation_run_id);

-- ---------- BACKFILL determinístico de las filas existentes (§2) ----------
-- Tag de scope: todo lo previo al verified epoch = validación interna, NO elegible para nada oficial/público.
UPDATE value_evaluations SET
  evaluation_mode = COALESCE(evaluation_mode, 'internal_validation_pre_epoch'),
  registry_eligible = false, pick_candidate_eligible = false, public_eligible = false, created_before_verified_epoch = true,
  quality_max_points = COALESCE(quality_max_points, 110), quality_policy_version = COALESCE(quality_policy_version, 'quality-1'),
  -- descomposición del edge (computable desde columnas existentes; NO altera la matemática)
  gp_vs_consensus_pp = COALESCE(gp_vs_consensus_pp, gp_probability - sportsbook_consensus_probability),
  ensemble_vs_consensus_pp = COALESCE(ensemble_vs_consensus_pp, ensemble_probability - sportsbook_consensus_probability),
  consensus_vs_best_price_break_even_pp = COALESCE(consensus_vs_best_price_break_even_pp,
    CASE WHEN best_decimal_odds > 0 THEN sportsbook_consensus_probability - (1.0/best_decimal_odds) ELSE NULL END),
  edge_source_code = COALESCE(edge_source_code,
    CASE WHEN raw_edge_pp <= 0 THEN 'NO_ACTIONABLE_EDGE'
         WHEN raw_edge_pp > 0 AND (ensemble_probability - sportsbook_consensus_probability) / NULLIF(raw_edge_pp,0) >= 0.6 THEN 'MODEL_DISAGREEMENT'
         WHEN raw_edge_pp > 0 AND (ensemble_probability - sportsbook_consensus_probability) / NULLIF(raw_edge_pp,0) <= 0.2 THEN 'BEST_PRICE_DISPERSION'
         ELSE 'HYBRID' END)
WHERE evaluation_mode IS NULL OR evaluation_mode = 'internal_validation_pre_epoch';

UPDATE value_opportunities SET
  evaluation_mode = COALESCE(evaluation_mode, 'internal_validation_pre_epoch'),
  registry_eligible = false, pick_candidate_eligible = false, public_eligible = false, created_before_verified_epoch = true
WHERE evaluation_mode IS NULL OR evaluation_mode = 'internal_validation_pre_epoch';

-- +migrate down
DROP TABLE IF EXISTS value_v2_diagnostics;
ALTER TABLE value_opportunities DROP COLUMN IF EXISTS created_before_verified_epoch;
ALTER TABLE value_opportunities DROP COLUMN IF EXISTS public_eligible;
ALTER TABLE value_opportunities DROP COLUMN IF EXISTS pick_candidate_eligible;
ALTER TABLE value_opportunities DROP COLUMN IF EXISTS registry_eligible;
ALTER TABLE value_opportunities DROP COLUMN IF EXISTS evaluation_mode;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS edge_source_code;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS consensus_vs_best_price_break_even_pp;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS ensemble_vs_consensus_pp;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS gp_vs_consensus_pp;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS quality_policy_version;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS quality_components;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS quality_normalized_percent;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS quality_max_points;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS quality_raw_points;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS verified_independence_group_count;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS duplicate_skin_count;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS unverified_sportsbook_count;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS verified_sportsbook_count;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS usable_sportsbook_count;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS raw_sportsbook_count;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS best_price_deep_link;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS best_price_provider_updated_at;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS best_price_observed_at;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS best_sportsbook_name;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS best_sportsbook_code;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS challenger_official_weight;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS challenger_gp_model;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS official_gp_model;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS created_before_verified_epoch;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS public_eligible;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS pick_candidate_eligible;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS registry_eligible;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS validation_run_id;
ALTER TABLE value_evaluations DROP COLUMN IF EXISTS evaluation_mode;
