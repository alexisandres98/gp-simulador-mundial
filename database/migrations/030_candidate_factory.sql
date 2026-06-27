-- 030 — Fase J: Value operativo continuo + Candidate Factory + readiness + price state + parche CLV. Aditiva,
-- posterior a 029. count(signals)=0 y 0 STRONG históricos → candidates=0 es el resultado correcto/esperado.

-- ---------- §2 parche semántico de CLV (sobre metric_facts; 0 facts → sin reescritura) ----------
ALTER TABLE metric_facts
  ADD COLUMN IF NOT EXISTS entry_price_vs_closing_fair_gap NUMERIC(20,8),  -- = official_closing_prob - published_break_even (entry vs precio justo del cierre)
  ADD COLUMN IF NOT EXISTS price_clv                        NUMERIC(20,8),  -- = published_odds / closing_fair_odds - 1
  ADD COLUMN IF NOT EXISTS market_move_no_vig               NUMERIC(20,8),  -- closing_no_vig - publication_no_vig (solo si se congeló al publicar)
  ADD COLUMN IF NOT EXISTS clv_semantics_version            TEXT DEFAULT 'clv-semantics-2';
COMMENT ON COLUMN metric_facts.clv_probability IS 'DEPRECATED alias de entry_price_vs_closing_fair_gap (clv-semantics-1). NO es no-vig vs no-vig.';
COMMENT ON COLUMN metric_facts.clv_odds IS 'DEPRECATED alias de price_clv (clv-semantics-1).';

-- ---------- §5 quota guard de cadencia (sobre sportsbook_provider_state) ----------
ALTER TABLE sportsbook_provider_state
  ADD COLUMN IF NOT EXISTS estimated_daily_usage   INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_monthly_usage INTEGER,
  ADD COLUMN IF NOT EXISTS soft_limit_reached      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hard_limit_reached      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quota_policy_version    TEXT;

-- ---------- §7,§11,§12,§13 Candidate Factory (interna; NO es Pick/señal/Registry) ----------
CREATE TABLE IF NOT EXISTS candidate_factory (
  candidate_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- identidad natural (§13): una misma oportunidad NO crea un candidate nuevo por ciclo
  dedup_key           TEXT NOT NULL UNIQUE,
  canonical_event_id  UUID,
  canonical_market_id UUID,
  market              TEXT, period TEXT, outcome TEXT, selection TEXT,
  model_version       TEXT, value_policy_version TEXT,
  -- evaluación STRONG congelada al detectar (no cambia por price refresh §12)
  value_evaluation_id UUID,
  classification      TEXT,
  gp_probability      NUMERIC(20,8), consensus_probability NUMERIC(20,8), conservative_probability NUMERIC(20,8),
  adjusted_edge_pp    NUMERIC(20,8), adjusted_ev NUMERIC(20,8), quality_score INTEGER, uncertainty_score INTEGER,
  verified_independence_group_count INTEGER, edge_source_code TEXT,
  published_min_odds  NUMERIC(20,8), detection_best_odds NUMERIC(20,8), detection_sportsbook TEXT,
  -- price state (§12) — se actualiza con cada ingesta
  current_best_odds   NUMERIC(20,8), minimum_odds NUMERIC(20,8), best_sportsbook TEXT,
  price_observed_at   TIMESTAMPTZ,
  price_state         TEXT NOT NULL DEFAULT 'AVAILABLE'
                        CHECK (price_state IN ('AVAILABLE','ABOVE_MINIMUM','AT_MINIMUM','BELOW_MINIMUM','STALE','SUSPENDED','UNAVAILABLE','EVENT_STARTED')),
  deep_link           TEXT, deep_link_level TEXT,
  -- lifecycle (§11) — en esta fase NUNCA llega a CONVERTED_TO_PICK
  candidate_lifecycle TEXT NOT NULL DEFAULT 'DETECTED'
                        CHECK (candidate_lifecycle IN ('DETECTED','READY_FOR_REVIEW','BLOCKED','PRICE_BELOW_MINIMUM','STALE','SUSPENDED','EXPIRED','REJECTED','CONVERTED_TO_PICK')),
  readiness_state     TEXT, readiness_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_reason    JSONB NOT NULL DEFAULT '{}'::jsonb,
  transition_history  JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_notes      JSONB NOT NULL DEFAULT '[]'::jsonb,
  kickoff_at          TIMESTAMPTZ,
  evaluation_mode     TEXT NOT NULL DEFAULT 'internal_operational',
  registry_eligible   BOOLEAN NOT NULL DEFAULT false,
  observation_count   INTEGER NOT NULL DEFAULT 1,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded          BOOLEAN NOT NULL DEFAULT false,  -- al cambiar identidad material (model/policy/mapping)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_candidate_lifecycle ON candidate_factory(candidate_lifecycle);
CREATE INDEX IF NOT EXISTS idx_candidate_event ON candidate_factory(canonical_event_id);
DROP TRIGGER IF EXISTS trg_candidate_updated ON candidate_factory;
CREATE TRIGGER trg_candidate_updated BEFORE UPDATE ON candidate_factory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- §9 ESPN fixture pre-flight (mappings propuestos para revisión admin antes de un STRONG) ----------
ALTER TABLE signal_event_fixture_mappings
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'
                            CHECK (review_status IN ('proposed','approved','rejected'));

-- +migrate down
ALTER TABLE signal_event_fixture_mappings DROP COLUMN IF EXISTS review_status;
DROP TABLE IF EXISTS candidate_factory;
ALTER TABLE sportsbook_provider_state
  DROP COLUMN IF EXISTS estimated_daily_usage, DROP COLUMN IF EXISTS estimated_monthly_usage,
  DROP COLUMN IF EXISTS soft_limit_reached, DROP COLUMN IF EXISTS hard_limit_reached, DROP COLUMN IF EXISTS quota_policy_version;
ALTER TABLE metric_facts
  DROP COLUMN IF EXISTS entry_price_vs_closing_fair_gap, DROP COLUMN IF EXISTS price_clv,
  DROP COLUMN IF EXISTS market_move_no_vig, DROP COLUMN IF EXISTS clv_semantics_version;
