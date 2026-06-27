-- 031 — Fase K.1: conversión manual, auditada y atómica de un Candidate READY a Pick GP interna + Signal oficial.
-- Tabla internal_picks: snapshot CONGELADO de la aprobación (§5), append-only, enlazada a la Signal y al Candidate.
-- Aditiva, posterior a 030. NO auto-convierte nada; la conversión real es una acción admin explícita posterior.

CREATE TABLE IF NOT EXISTS internal_picks (
  pick_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            UUID NOT NULL REFERENCES candidate_factory(candidate_id),
  signal_id               UUID NOT NULL REFERENCES signals(id),
  value_evaluation_id     UUID,
  canonical_event_id      UUID,
  -- selección + labels en español (§2)
  selection_outcome       TEXT NOT NULL,             -- home | draw | away (código interno)
  selection_display       TEXT NOT NULL,             -- "Croacia gana" (label visible)
  event_display           TEXT,                      -- "Croacia vs Ghana"
  market                  TEXT NOT NULL DEFAULT 'Resultado del partido',
  period                  TEXT NOT NULL DEFAULT 'tiempo reglamentario (90 min, sin prórroga ni penales)',
  kickoff_at              TIMESTAMPTZ,
  -- probabilidades CONGELADAS (no se recalculan después)
  gp_probability          NUMERIC(20,8),
  gp_probability_vector   JSONB,                     -- {home,draw,away} oficial V1
  consensus_probability   NUMERIC(20,8),
  ensemble_probability    NUMERIC(20,8),
  conservative_probability NUMERIC(20,8),
  published_odds          NUMERIC(20,8),
  published_break_even_probability NUMERIC(20,8),
  minimum_odds            NUMERIC(20,8),
  sportsbook              TEXT,
  deep_link               TEXT,
  adjusted_edge_pp        NUMERIC(20,8),
  adjusted_ev             NUMERIC(20,8),
  uncertainty_score       INTEGER,
  quality_score           INTEGER,
  verified_independence_group_count INTEGER,
  edge_source_code        TEXT,
  model_version           TEXT,
  policy_version          TEXT DEFAULT 'value-1',
  official_model          TEXT NOT NULL DEFAULT 'V1',
  challenger_official_weight INTEGER NOT NULL DEFAULT 0,
  espn_fixture_id         TEXT,
  -- aprobación humana + economía teórica
  approval_timestamp      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approving_admin         TEXT NOT NULL,
  human_review_reason     TEXT NOT NULL,
  risks_displayed         JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_by_gp          BOOLEAN NOT NULL DEFAULT false,
  theoretical_stake_model TEXT NOT NULL DEFAULT 'flat_1_unit',
  -- idempotencia de la conversión (doble clic / concurrencia → una sola Pick)
  idempotency_key         TEXT NOT NULL UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id),                              -- una sola Pick por Candidate
  UNIQUE (signal_id)                                  -- una sola Pick por Signal
);
CREATE INDEX IF NOT EXISTS idx_internal_picks_event ON internal_picks(canonical_event_id);
-- append-only: la Pick no se borra ni se edita en silencio (§reglas duras).
DROP TRIGGER IF EXISTS trg_internal_picks_immutable ON internal_picks;
CREATE TRIGGER trg_internal_picks_immutable BEFORE UPDATE OR DELETE ON internal_picks
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- +migrate down
DROP TABLE IF EXISTS internal_picks;
