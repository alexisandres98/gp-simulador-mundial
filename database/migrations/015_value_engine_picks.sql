-- 015 — Value Engine + Picks GP. Sprint 7. No modifica datos previos. Reutiliza set_updated_at().
-- Las Picks GP publicadas crean una señal inmutable en el registro (Sprint 5); aquí va el lifecycle de producto.

-- ---------- sportsbook_quotes (§8) ----------
CREATE TABLE IF NOT EXISTS sportsbook_quotes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID,
  sportsbook_code     TEXT NOT NULL,
  operator_group      TEXT,
  independence_group  TEXT,
  source_role         TEXT DEFAULT 'market_consensus',
  external_event_id   TEXT,
  external_market_id  TEXT,
  external_outcome_id TEXT,
  canonical_event_id  UUID,
  canonical_market_id UUID,
  canonical_outcome_id UUID,
  market_family       TEXT,
  period              TEXT,
  is_live             BOOLEAN NOT NULL DEFAULT false,
  odds_format         TEXT DEFAULT 'decimal',
  odds_decimal        NUMERIC(12,4),
  implied_probability NUMERIC(12,8),
  quote_status        TEXT DEFAULT 'open',
  quote_timestamp     TIMESTAMPTZ,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_url          TEXT,
  deep_link           TEXT,
  maximum_stake       NUMERIC(20,2),
  currency            TEXT,
  normalizer_version  TEXT,
  raw_snapshot_id     TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sbq_event   ON sportsbook_quotes(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_sbq_market  ON sportsbook_quotes(canonical_market_id);
CREATE INDEX IF NOT EXISTS idx_sbq_book_ts ON sportsbook_quotes(sportsbook_code, quote_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sbq_received ON sportsbook_quotes(received_at DESC);

CREATE TABLE IF NOT EXISTS sportsbook_ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID, status TEXT NOT NULL DEFAULT 'running', quotes_ingested INTEGER NOT NULL DEFAULT 0,
  books_complete INTEGER DEFAULT 0, books_incomplete INTEGER DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ, duration_ms INTEGER, metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ---------- value_evaluations (§26, inmutable por input_hash) ----------
CREATE TABLE IF NOT EXISTS value_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id UUID, canonical_market_id UUID, canonical_outcome_id TEXT,
  selection TEXT, evaluation_type TEXT DEFAULT 'value_1x2', classification TEXT,
  gp_probability NUMERIC(12,8), gp_calibrated_probability NUMERIC(12,8),
  sportsbook_consensus_probability NUMERIC(12,8), prediction_market_probability NUMERIC(12,8), sharp_reference_probability NUMERIC(12,8),
  ensemble_probability NUMERIC(12,8), conservative_probability NUMERIC(12,8),
  best_price_type TEXT, best_decimal_odds NUMERIC(12,4), best_prediction_market_price NUMERIC(12,8),
  break_even_probability NUMERIC(12,8), fair_odds NUMERIC(12,4), conservative_fair_odds NUMERIC(12,4),
  minimum_acceptable_odds NUMERIC(12,4), maximum_acceptable_price NUMERIC(12,8),
  raw_edge_pp NUMERIC(12,8), adjusted_edge_pp NUMERIC(12,8), raw_ev NUMERIC(12,8), adjusted_ev NUMERIC(12,8),
  uncertainty_score INTEGER, quality_score INTEGER, source_count INTEGER, independence_group_count INTEGER,
  input_snapshot_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  mapping_version TEXT, rules_version TEXT, model_version TEXT, ensemble_version TEXT, no_vig_version TEXT, classification_version TEXT,
  input_hash TEXT UNIQUE, rejection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb, warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  strong_blockers JSONB NOT NULL DEFAULT '[]'::jsonb, detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ve_event ON value_evaluations(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_ve_class ON value_evaluations(classification);
CREATE INDEX IF NOT EXISTS idx_ve_created ON value_evaluations(created_at DESC);

-- ---------- value_opportunities (§27, lifecycle mutable) ----------
CREATE TABLE IF NOT EXISTS value_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_key TEXT UNIQUE NOT NULL,
  canonical_event_id UUID, canonical_market_id UUID, canonical_outcome_id TEXT, selection TEXT,
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected','watch','lean','strong','aging','expired','invalidated','rejected')),
  current_evaluation_id UUID REFERENCES value_evaluations(id) ON DELETE SET NULL,
  first_detected_at TIMESTAMPTZ DEFAULT now(), last_seen_at TIMESTAMPTZ DEFAULT now(), last_validated_at TIMESTAMPTZ, expired_at TIMESTAMPTZ,
  observation_count INTEGER NOT NULL DEFAULT 1,
  best_adjusted_ev NUMERIC(12,8), best_adjusted_edge_pp NUMERIC(12,8), best_decimal_odds NUMERIC(12,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_vo_updated ON value_opportunities;
CREATE TRIGGER trg_vo_updated BEFORE UPDATE ON value_opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_vo_status ON value_opportunities(status);

-- ---------- pick_candidates (§31) ----------
CREATE TABLE IF NOT EXISTS pick_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value_evaluation_id UUID REFERENCES value_evaluations(id) ON DELETE SET NULL,
  value_opportunity_id UUID REFERENCES value_opportunities(id) ON DELETE SET NULL,
  canonical_event_id UUID, canonical_market_id UUID, canonical_outcome_id TEXT,
  candidate_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (candidate_status IN ('pending_review','eligible','rejected','expired','price_moved','approved')),
  selection TEXT, market_label TEXT,
  observed_odds NUMERIC(12,4), minimum_acceptable_odds NUMERIC(12,4), observed_price NUMERIC(12,8), maximum_acceptable_price NUMERIC(12,8),
  provider_id UUID, sportsbook_code TEXT, deep_link TEXT, signal_quality INTEGER, uncertainty_score INTEGER,
  context_status TEXT, candidate_reason JSONB NOT NULL DEFAULT '[]'::jsonb, blocking_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_pc_updated ON pick_candidates;
CREATE TRIGGER trg_pc_updated BEFORE UPDATE ON pick_candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_pc_status ON pick_candidates(candidate_status);

-- ---------- pick_publications + history (§33) ----------
CREATE TABLE IF NOT EXISTS pick_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_candidate_id UUID REFERENCES pick_candidates(id) ON DELETE SET NULL,
  value_evaluation_id UUID,
  public_id TEXT UNIQUE,
  publication_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (publication_status IN ('candidate','approved','published','price_moved','closed','settlement_pending','settled','void','withdrawn','disputed')),
  category TEXT DEFAULT 'Pick GP — Strong Value',
  selection TEXT, event_label TEXT, market_label TEXT, period TEXT,
  observed_odds NUMERIC(12,4), minimum_acceptable_odds NUMERIC(12,4), current_odds NUMERIC(12,4),
  observed_price NUMERIC(12,8), maximum_acceptable_price NUMERIC(12,8),
  provider_id UUID, sportsbook_code TEXT, deep_link TEXT,
  signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,    -- señal inmutable del registro
  public_payload JSONB, rationale TEXT,
  tracking_stake_units NUMERIC(8,2) DEFAULT 1, tracking_policy TEXT DEFAULT 'flat_1_unit_v1', executed_by_gp BOOLEAN NOT NULL DEFAULT false,
  reviewed_by TEXT, reviewed_at TIMESTAMPTZ, published_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, withdrawn_at TIMESTAMPTZ,
  unpublication_reason TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_pp_updated ON pick_publications;
CREATE TRIGGER trg_pp_updated BEFORE UPDATE ON pick_publications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_pp_status ON pick_publications(publication_status);
CREATE INDEX IF NOT EXISTS idx_pp_published ON pick_publications(published_at DESC);

CREATE TABLE IF NOT EXISTS pick_publication_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID NOT NULL REFERENCES pick_publications(id) ON DELETE CASCADE,
  previous_status TEXT, new_status TEXT, action TEXT NOT NULL, actor_id TEXT, reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pph_pub ON pick_publication_history(publication_id, created_at DESC);

-- ---------- model_calibration_policies (§19) ----------
CREATE TABLE IF NOT EXISTS model_calibration_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_version TEXT NOT NULL, market_family TEXT NOT NULL, calibration_method TEXT NOT NULL DEFAULT 'identity',
  calibration_version TEXT NOT NULL DEFAULT 'cal-1', training_cutoff TIMESTAMPTZ, sample_size INTEGER,
  out_of_sample_status TEXT, parameters JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (model_version, market_family, calibration_version)
);

-- +migrate down
DROP TABLE IF EXISTS model_calibration_policies;
DROP TABLE IF EXISTS pick_publication_history;
DROP TABLE IF EXISTS pick_publications;
DROP TABLE IF EXISTS pick_candidates;
DROP TABLE IF EXISTS value_opportunities;
DROP TABLE IF EXISTS value_evaluations;
DROP TABLE IF EXISTS sportsbook_ingestion_runs;
DROP TABLE IF EXISTS sportsbook_quotes;
