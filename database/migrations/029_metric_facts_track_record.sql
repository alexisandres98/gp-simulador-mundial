-- 029 — Fase I: Metrics internas / track record reproducible. Capa de FACTS INMUTABLE y VERSIONADA (distinta de
-- los facts upsert de Sprint 6): congela la probabilidad publicada de la señal + closing oficial (closing-policy-1)
-- + settlement final → Brier/log loss/CLV/ROI teórico. Append-only, supersedes chain. Aditiva, posterior a 028.
-- count(signals)=0 → 0 facts (estado correcto: N/A, sin ceros engañosos). NO toca señales/closing/settlement/epoch.

CREATE TABLE IF NOT EXISTS metric_facts (
  metric_fact_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id                 UUID NOT NULL REFERENCES signals(id),
  registry_sequence         BIGINT,
  canonical_event_id        UUID,
  market                    TEXT,
  period                    TEXT,
  outcome                   TEXT,
  published_at              TIMESTAMPTZ,
  kickoff_at                TIMESTAMPTZ,
  -- modelo oficial congelado (V1; V2 peso 0 NUNCA entra)
  official_model            TEXT DEFAULT 'V1',
  model_version             TEXT,
  policy_version            TEXT,
  -- probabilidades CONGELADAS en la publicación (del payload inmutable; no se recalcula el modelo)
  published_probability_home    NUMERIC(20,8),
  published_probability_draw    NUMERIC(20,8),
  published_probability_away    NUMERIC(20,8),
  published_outcome_probability NUMERIC(20,8),
  published_odds                NUMERIC(20,8),
  published_break_even_probability NUMERIC(20,8),
  published_sportsbook          TEXT,
  -- closing oficial (closing-policy-1)
  closing_status            TEXT,
  official_closing_probability NUMERIC(20,8),
  official_closing_odds        NUMERIC(20,8),
  closing_policy_version    TEXT,
  closing_snapshot_id       UUID,
  -- settlement factual
  settlement_status         TEXT,
  result_outcome            TEXT,
  settlement_result         TEXT,
  settlement_version        INTEGER,
  settlement_policy_version TEXT,
  -- métricas (reusan brier/log_loss/calibration de Sprint 6 + CLV/ROI Fase I)
  brier_score               NUMERIC(20,8),
  log_loss                  NUMERIC(20,8),
  clv_probability           NUMERIC(20,8),
  clv_odds                  NUMERIC(20,8),
  flat_unit_profit          NUMERIC(20,8),
  flat_unit_return          NUMERIC(20,8),
  -- estado / elegibilidad / política
  administrative_status     TEXT,
  metrics_eligibility       TEXT NOT NULL DEFAULT 'excluded'
                              CHECK (metrics_eligibility IN ('eligible','excluded','held')),
  exclusion_reason          TEXT,
  metrics_policy_version    TEXT NOT NULL DEFAULT 'metrics-track-1',
  -- versionado / idempotencia
  input_hash                TEXT NOT NULL,
  supersedes_metric_fact_id UUID REFERENCES metric_facts(metric_fact_id),
  effective                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (input_hash)
);
CREATE INDEX IF NOT EXISTS idx_metric_facts_signal ON metric_facts(signal_id);
CREATE INDEX IF NOT EXISTS idx_metric_facts_effective ON metric_facts(effective) WHERE effective = true;
CREATE INDEX IF NOT EXISTS idx_metric_facts_elig ON metric_facts(metrics_eligibility);
-- append-only: una fila de fact NO se borra ni se edita su contenido. La única mutación permitida es marcar
-- effective=false al ser superseded (lo hace la capa con un UPDATE controlado de esa única columna).
CREATE OR REPLACE FUNCTION metric_facts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'metric_facts es append-only: DELETE no permitido'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.metric_fact_id <> OLD.metric_fact_id OR NEW.input_hash <> OLD.input_hash
       OR NEW.brier_score IS DISTINCT FROM OLD.brier_score OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'metric_facts es append-only: solo se permite marcar effective=false';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_metric_facts_guard ON metric_facts;
CREATE TRIGGER trg_metric_facts_guard BEFORE UPDATE OR DELETE ON metric_facts
  FOR EACH ROW EXECUTE FUNCTION metric_facts_guard();

-- snapshots de agregados (track record) versionados + append-only
CREATE TABLE IF NOT EXISTS metric_track_snapshots (
  snapshot_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                     TEXT NOT NULL,            -- global | competition | market | outcome | window | ...
  scope_key                 TEXT NOT NULL DEFAULT 'all',
  window_start              TIMESTAMPTZ,
  window_end                TIMESTAMPTZ,
  metrics_policy_version    TEXT NOT NULL DEFAULT 'metrics-track-1',
  sample_size               INTEGER NOT NULL DEFAULT 0,
  metrics_payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_max_sequence       BIGINT,
  source_max_settlement_version INTEGER,
  supersedes_snapshot_id    UUID REFERENCES metric_track_snapshots(snapshot_id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_track_snap_scope ON metric_track_snapshots(scope, scope_key, created_at DESC);
DROP TRIGGER IF EXISTS trg_track_snap_immutable ON metric_track_snapshots;
CREATE TRIGGER trg_track_snap_immutable BEFORE UPDATE OR DELETE ON metric_track_snapshots
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- +migrate down
DROP TABLE IF EXISTS metric_track_snapshots;
DROP TABLE IF EXISTS metric_facts;
DROP FUNCTION IF EXISTS metric_facts_guard();
