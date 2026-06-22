-- 013 — Registro inmutable y verificable de señales. Sprint 5.
-- Evoluciona la tabla `signals` (vacía desde Sprint 0) y añade tablas hermanas append-only + triggers de
-- inmutabilidad a nivel Postgres. NO toca datos previos. Reutiliza set_updated_at() de migraciones previas.
-- Registro con EVIDENCIA DE INTEGRIDAD y detección de modificaciones (no "tamper-proof": la base es de GP).

-- ---------- función de inmutabilidad (append-only) ----------
CREATE OR REPLACE FUNCTION signal_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'registro append-only: % no permitido en %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

-- ---------- evolución de `signals` (Sprint 5) ----------
ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS public_id              TEXT,
  ADD COLUMN IF NOT EXISTS signal_schema_version  TEXT,
  ADD COLUMN IF NOT EXISTS visibility             TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS registry_status        TEXT NOT NULL DEFAULT 'registered',
  ADD COLUMN IF NOT EXISTS verification_status    TEXT NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS score_eligible         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS experimental           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy                 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_outcome_id   UUID,
  ADD COLUMN IF NOT EXISTS direction              TEXT,
  ADD COLUMN IF NOT EXISTS event_start_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS market_close_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_created_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS input_cutoff_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS methodology_version    TEXT,
  ADD COLUMN IF NOT EXISTS normalizer_version     TEXT,
  ADD COLUMN IF NOT EXISTS public_payload         JSONB,
  ADD COLUMN IF NOT EXISTS content_hash           TEXT,
  ADD COLUMN IF NOT EXISTS previous_registry_hash TEXT,
  ADD COLUMN IF NOT EXISTS registry_hash          TEXT,
  ADD COLUMN IF NOT EXISTS chain_position         BIGINT,
  ADD COLUMN IF NOT EXISTS prediction_edition     TEXT,
  ADD COLUMN IF NOT EXISTS supersedes_signal_id   UUID;

-- unicidad de public_id, posición de cadena y hash de registro
CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_public_id     ON signals(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_chain_pos     ON signals(chain_position) WHERE chain_position IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_registry_hash ON signals(registry_hash) WHERE registry_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signals_verif   ON signals(verification_status);
CREATE INDEX IF NOT EXISTS idx_signals_regstat ON signals(registry_status);
CREATE INDEX IF NOT EXISTS idx_signals_score   ON signals(score_eligible);
CREATE INDEX IF NOT EXISTS idx_signals_market   ON signals(canonical_market_id);

-- inmutabilidad de `signals` (solo INSERT; lifecycle vivo va en signal_state_projection)
DROP TRIGGER IF EXISTS trg_signals_immutable ON signals;
CREATE TRIGGER trg_signals_immutable BEFORE UPDATE OR DELETE ON signals
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- signal_events (append-only, hash-linked por señal) ----------
CREATE TABLE IF NOT EXISTS signal_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL
                        CHECK (event_type IN ('published','withdrawn','expired','settlement_pending','settled','voided','cancelled','disputed','correction_added','closing_captured','reviewed','superseded')),
  event_version       INTEGER NOT NULL DEFAULT 1,
  actor_type          TEXT NOT NULL DEFAULT 'system',   -- system | admin
  actor_id            TEXT,
  reason_code         TEXT,
  event_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash TEXT,
  event_hash          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sig_events_signal ON signal_events(signal_id, created_at);
DROP TRIGGER IF EXISTS trg_sig_events_immutable ON signal_events;
CREATE TRIGGER trg_sig_events_immutable BEFORE UPDATE OR DELETE ON signal_events
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- signal_source_references (append-only) ----------
CREATE TABLE IF NOT EXISTS signal_source_references (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id          UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  source_type        TEXT NOT NULL
                       CHECK (source_type IN ('normalized_snapshot','raw_snapshot','arb_evaluation','arb_publication','model_analysis_run','model_output','canonical_mapping','rules_snapshot','result_source')),
  source_id          TEXT,
  source_version     TEXT,
  provider_id        UUID,
  snapshot_timestamp TIMESTAMPTZ,
  content_hash       TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sig_srcref_signal ON signal_source_references(signal_id);
DROP TRIGGER IF EXISTS trg_sig_srcref_immutable ON signal_source_references;
CREATE TRIGGER trg_sig_srcref_immutable BEFORE UPDATE OR DELETE ON signal_source_references
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- signal_settlements (append-only, versionado) ----------
CREATE TABLE IF NOT EXISTS signal_settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id          UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  settlement_version INTEGER NOT NULL,
  settlement_status  TEXT NOT NULL
                       CHECK (settlement_status IN ('pending','provisional','final','void','cancelled','disputed','corrected')),
  result_type        TEXT,                              -- model_prediction | theoretical_structure_settled | not_executed | experiment
  winning_outcome_id TEXT,
  event_result       JSONB,
  settlement_source  TEXT,
  source_reference   TEXT,
  source_timestamp   TIMESTAMPTZ,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at         TIMESTAMPTZ,
  is_final           BOOLEAN NOT NULL DEFAULT false,
  void_reason        TEXT,
  correction_reason  TEXT,
  realized_roi       NUMERIC(20,8),                     -- SIEMPRE null salvo prueba real de ejecución
  settlement_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, settlement_version)
);
CREATE INDEX IF NOT EXISTS idx_sig_settle_signal ON signal_settlements(signal_id);
CREATE INDEX IF NOT EXISTS idx_sig_settle_status ON signal_settlements(settlement_status);
DROP TRIGGER IF EXISTS trg_sig_settle_immutable ON signal_settlements;
CREATE TRIGGER trg_sig_settle_immutable BEFORE UPDATE OR DELETE ON signal_settlements
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- signal_closing_snapshots (append-only) ----------
CREATE TABLE IF NOT EXISTS signal_closing_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id           UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  benchmark_type      TEXT NOT NULL
                        CHECK (benchmark_type IN ('last_valid_pre_event_executable','last_valid_pre_event_midpoint','provider_reported_close')),
  provider_id         UUID,
  external_market_id  TEXT,
  external_outcome_id TEXT,
  best_bid            NUMERIC(20,8),
  best_ask            NUMERIC(20,8),
  midpoint            NUMERIC(20,8),
  last_trade          NUMERIC(20,8),
  executable_price    NUMERIC(20,8),
  snapshot_id         TEXT,
  observed_at         TIMESTAMPTZ,
  event_start_at      TIMESTAMPTZ,
  capture_status      TEXT NOT NULL DEFAULT 'captured'
                        CHECK (capture_status IN ('captured','unavailable','postponed','suspended')),
  capture_method      TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, benchmark_type)
);
CREATE INDEX IF NOT EXISTS idx_sig_closing_signal ON signal_closing_snapshots(signal_id);
DROP TRIGGER IF EXISTS trg_sig_closing_immutable ON signal_closing_snapshots;
CREATE TRIGGER trg_sig_closing_immutable BEFORE UPDATE OR DELETE ON signal_closing_snapshots
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- signal_registry_commitments (append-only) ----------
CREATE TABLE IF NOT EXISTS signal_registry_commitments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_date      DATE NOT NULL UNIQUE,
  first_chain_position BIGINT,
  last_chain_position  BIGINT,
  signal_count         INTEGER NOT NULL DEFAULT 0,
  root_hash            TEXT NOT NULL,
  algorithm            TEXT NOT NULL DEFAULT 'merkle-sha256-v1',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sig_commit_immutable ON signal_registry_commitments;
CREATE TRIGGER trg_sig_commit_immutable BEFORE UPDATE OR DELETE ON signal_registry_commitments
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- signal_state_projection (MUTABLE; reconstruible desde eventos) ----------
CREATE TABLE IF NOT EXISTS signal_state_projection (
  signal_id              UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  current_status         TEXT DEFAULT 'published',
  verification_status    TEXT,
  score_eligible         BOOLEAN NOT NULL DEFAULT false,
  settlement_status      TEXT,
  latest_settlement_version INTEGER,
  closing_captured       BOOLEAN NOT NULL DEFAULT false,
  last_event_type        TEXT,
  last_event_at          TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_sig_proj_updated ON signal_state_projection;
CREATE TRIGGER trg_sig_proj_updated BEFORE UPDATE ON signal_state_projection FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_sig_proj_status   ON signal_state_projection(current_status);
CREATE INDEX IF NOT EXISTS idx_sig_proj_settle   ON signal_state_projection(settlement_status);

-- +migrate down
DROP TABLE IF EXISTS signal_state_projection;
DROP TABLE IF EXISTS signal_registry_commitments;
DROP TABLE IF EXISTS signal_closing_snapshots;
DROP TABLE IF EXISTS signal_settlements;
DROP TABLE IF EXISTS signal_source_references;
DROP TABLE IF EXISTS signal_events;
DROP TRIGGER IF EXISTS trg_signals_immutable ON signals;
ALTER TABLE signals
  DROP COLUMN IF EXISTS public_id, DROP COLUMN IF EXISTS signal_schema_version, DROP COLUMN IF EXISTS visibility,
  DROP COLUMN IF EXISTS registry_status, DROP COLUMN IF EXISTS verification_status, DROP COLUMN IF EXISTS score_eligible,
  DROP COLUMN IF EXISTS experimental, DROP COLUMN IF EXISTS legacy, DROP COLUMN IF EXISTS canonical_outcome_id,
  DROP COLUMN IF EXISTS direction, DROP COLUMN IF EXISTS event_start_at, DROP COLUMN IF EXISTS market_close_at,
  DROP COLUMN IF EXISTS source_created_at, DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS input_cutoff_at,
  DROP COLUMN IF EXISTS methodology_version, DROP COLUMN IF EXISTS normalizer_version, DROP COLUMN IF EXISTS public_payload,
  DROP COLUMN IF EXISTS content_hash, DROP COLUMN IF EXISTS previous_registry_hash, DROP COLUMN IF EXISTS registry_hash,
  DROP COLUMN IF EXISTS chain_position, DROP COLUMN IF EXISTS prediction_edition, DROP COLUMN IF EXISTS supersedes_signal_id;
DROP FUNCTION IF EXISTS signal_forbid_mutation();
