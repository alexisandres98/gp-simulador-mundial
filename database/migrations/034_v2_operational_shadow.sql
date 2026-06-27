-- 034 — Fase N: V2 operational shadow + wiring real + goal markets value. ADITIVA, reversible, INERTE.
-- Extiende context_observations con la JERARQUÍA DE TIMESTAMPS (forward-testing sin leakage) y crea las tablas
-- shadow de N: candidates V2 hipotéticos, snapshots del Goal Engine, goal value shadow, y cuotas reales de
-- mercados de goles (current+history). NADA se cablea al pipeline oficial (V1 sigue único; V2/goles OFF).
-- NO toca Signals/Registry/Picks/metric_facts/Verified Epoch/value_evaluations. Reusa signal_forbid_mutation()/set_updated_at().

-- ---------- N.2: jerarquía de timestamps en context_observations ----------
ALTER TABLE context_observations
  ADD COLUMN IF NOT EXISTS timestamp_quality    TEXT NOT NULL DEFAULT 'UNKNOWN',  -- SOURCE_PUBLISHED|PROVIDER_UPDATED|INGESTION_OBSERVED|MANUAL_VERIFIED|UNKNOWN
  ADD COLUMN IF NOT EXISTS timestamp_confidence NUMERIC(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at        TIMESTAMPTZ,                      -- 1er ingreso real en GP (nunca se backdatea)
  ADD COLUMN IF NOT EXISTS last_seen_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_updated_at  TIMESTAMPTZ;                      -- cuándo la API dice que actualizó el dato
-- (published_at ya existe en 033 = source_published_at)

-- ---------- N.8: candidates V2 SHADOW (hipotéticos; nunca oficiales) ----------
CREATE TABLE IF NOT EXISTS v2_shadow_candidates (
  shadow_candidate_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  v2_snapshot_id        UUID REFERENCES v2_probability_snapshots(snapshot_id),
  canonical_event_id    UUID,
  market_code           TEXT NOT NULL DEFAULT '1X2',
  period_code           TEXT NOT NULL DEFAULT 'REGULATION',
  outcome               TEXT NOT NULL,                         -- home|draw|away (o TEAM_A_QUALIFIES...)
  gp_probability        NUMERIC(20,8),
  consensus_probability NUMERIC(20,8),
  best_decimal_odds     NUMERIC(20,8),
  adjusted_edge_pp      NUMERIC(20,8),
  adjusted_ev           NUMERIC(20,8),
  uncertainty           NUMERIC(20,8),
  classification        TEXT,                                  -- pass|watch|lean|strong (hipotético)
  context_state         TEXT,
  shadow_only           BOOLEAN NOT NULL DEFAULT true,
  registry_eligible     BOOLEAN NOT NULL DEFAULT false,
  pick_candidate_eligible BOOLEAN NOT NULL DEFAULT false,
  public_eligible       BOOLEAN NOT NULL DEFAULT false,
  cutoff_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v2shadow_event ON v2_shadow_candidates(canonical_event_id);
DROP TRIGGER IF EXISTS trg_v2shadow_immutable ON v2_shadow_candidates;
CREATE TRIGGER trg_v2shadow_immutable BEFORE UPDATE OR DELETE ON v2_shadow_candidates
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- Anexo G §18: snapshots del Goal Engine (append-only, versionado, idempotente) ----------
CREATE TABLE IF NOT EXISTS goal_model_snapshots (
  goal_snapshot_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id    UUID,
  model_version         TEXT NOT NULL,
  period_code           TEXT NOT NULL DEFAULT 'REGULATION',
  base_lambda_home      NUMERIC(14,6),
  base_lambda_away      NUMERIC(14,6),
  context_lambda_home   NUMERIC(14,6),
  context_lambda_away   NUMERIC(14,6),
  final_lambda_home     NUMERIC(14,6),
  final_lambda_away     NUMERIC(14,6),
  expected_total_goals  NUMERIC(14,6),
  scoreline_matrix_hash TEXT,
  total_goals_distribution JSONB,
  over_under            JSONB,
  btts                  JSONB,
  team_totals           JSONB,
  top_scorelines        JSONB,
  uncertainty           JSONB,
  data_completeness     NUMERIC(6,4),
  factor_lineage        JSONB NOT NULL DEFAULT '[]'::jsonb,
  cutoff_at             TIMESTAMPTZ,
  input_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goalsnap_event ON goal_model_snapshots(canonical_event_id);
DROP TRIGGER IF EXISTS trg_goalsnap_immutable ON goal_model_snapshots;
CREATE TRIGGER trg_goalsnap_immutable BEFORE UPDATE OR DELETE ON goal_model_snapshots
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- N.12: goal value SHADOW (evaluation_mode=shadow_goal_value; nunca oficial) ----------
CREATE TABLE IF NOT EXISTS goal_value_shadow (
  goal_value_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_snapshot_id      UUID REFERENCES goal_model_snapshots(goal_snapshot_id),
  canonical_event_id    UUID,
  market_id             TEXT NOT NULL,                         -- TOTAL_GOALS_OVER_2_5 | BTTS_YES | ...
  market_family         TEXT NOT NULL,                         -- match_total | btts | team_total
  period_code           TEXT NOT NULL DEFAULT 'REGULATION',
  gp_probability        NUMERIC(20,8),
  market_consensus_probability NUMERIC(20,8),
  best_decimal_odds     NUMERIC(20,8),
  break_even_probability NUMERIC(20,8),
  raw_edge_pp           NUMERIC(20,8),
  conservative_probability NUMERIC(20,8),
  adjusted_edge_pp      NUMERIC(20,8),
  adjusted_ev           NUMERIC(20,8),
  uncertainty           NUMERIC(20,8),
  line_probability_sensitivity JSONB,
  classification        TEXT,                                  -- provisional
  evaluation_mode       TEXT NOT NULL DEFAULT 'shadow_goal_value',
  goal_value_policy_version TEXT NOT NULL DEFAULT 'goal-value-policy-shadow-1',
  registry_eligible     BOOLEAN NOT NULL DEFAULT false,
  pick_candidate_eligible BOOLEAN NOT NULL DEFAULT false,
  public_eligible       BOOLEAN NOT NULL DEFAULT false,
  cutoff_at             TIMESTAMPTZ,
  input_hash            TEXT NOT NULL UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goalval_event ON goal_value_shadow(canonical_event_id);
DROP TRIGGER IF EXISTS trg_goalval_immutable ON goal_value_shadow;
CREATE TRIGGER trg_goalval_immutable BEFORE UPDATE OR DELETE ON goal_value_shadow
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- N.9/N.10: cuotas reales de mercados de goles (semántica canónica separada del 1X2) ----------
CREATE TABLE IF NOT EXISTS sportsbook_goal_quote_current (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_provider        TEXT NOT NULL,
  sportsbook_code      TEXT NOT NULL,
  external_event_id    TEXT NOT NULL,
  canonical_event_id   UUID,
  market_family        TEXT NOT NULL,                          -- match_total | btts | team_total
  period               TEXT NOT NULL DEFAULT 'regulation_90m',
  line                 NUMERIC(6,2),                           -- 2.5, 1.5... (null para BTTS)
  side                 TEXT NOT NULL,                          -- over|under|yes|no
  team_scope           TEXT,                                   -- null|home|away
  market_id            TEXT,                                   -- ID canónico (TOTAL_GOALS_OVER_2_5...)
  odds_decimal         NUMERIC(12,4),
  implied_probability  NUMERIC(12,8),
  quote_status         TEXT NOT NULL DEFAULT 'open',
  is_live              BOOLEAN NOT NULL DEFAULT false,
  provider_update      TIMESTAMPTZ,
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingestion_run_id     UUID,
  UNIQUE (data_provider, sportsbook_code, external_event_id, market_family, period, line, side, team_scope)
);
CREATE INDEX IF NOT EXISTS idx_sbgoal_event ON sportsbook_goal_quote_current(external_event_id, market_family);

CREATE TABLE IF NOT EXISTS sportsbook_goal_quote_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_provider        TEXT NOT NULL,
  sportsbook_code      TEXT NOT NULL,
  external_event_id    TEXT NOT NULL,
  market_family        TEXT NOT NULL,
  period               TEXT NOT NULL,
  line                 NUMERIC(6,2),
  side                 TEXT NOT NULL,
  team_scope           TEXT,
  change_type          TEXT NOT NULL,                          -- new|price|status
  odds_decimal         NUMERIC(12,4),
  prev_odds_decimal    NUMERIC(12,4),
  quote_status         TEXT,
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingestion_run_id     UUID
);
CREATE INDEX IF NOT EXISTS idx_sbgoalhist_event ON sportsbook_goal_quote_history(external_event_id, market_family, observed_at DESC);
DROP TRIGGER IF EXISTS trg_sbgoalhist_immutable ON sportsbook_goal_quote_history;
CREATE TRIGGER trg_sbgoalhist_immutable BEFORE UPDATE OR DELETE ON sportsbook_goal_quote_history
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- N.10: review queue para mercados de goles ambiguos (auto-match OFF) ----------
CREATE TABLE IF NOT EXISTS goal_market_review_queue (
  review_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_provider      TEXT NOT NULL,
  sportsbook_code    TEXT,
  external_event_id  TEXT,
  raw_market_label   TEXT,
  proposed_market_id TEXT,
  ambiguity_reason   TEXT,
  review_status      TEXT NOT NULL DEFAULT 'pending',          -- pending|approved|rejected
  resolved_by        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_goalreview_updated ON goal_market_review_queue;
CREATE TRIGGER trg_goalreview_updated BEFORE UPDATE ON goal_market_review_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +migrate down
DROP TABLE IF EXISTS goal_market_review_queue;
DROP TABLE IF EXISTS sportsbook_goal_quote_history;
DROP TABLE IF EXISTS sportsbook_goal_quote_current;
DROP TABLE IF EXISTS goal_value_shadow;
DROP TABLE IF EXISTS goal_model_snapshots;
DROP TABLE IF EXISTS v2_shadow_candidates;
ALTER TABLE context_observations
  DROP COLUMN IF EXISTS timestamp_quality, DROP COLUMN IF EXISTS timestamp_confidence,
  DROP COLUMN IF EXISTS first_seen_at, DROP COLUMN IF EXISTS last_seen_at, DROP COLUMN IF EXISTS provider_updated_at;
