-- 027 — Fase H: ciclo de vida interno (closing + settlement + commitments) + anchor de audit pre-026 +
-- contrato de anclaje externo (OFF). Aditiva, posterior a 026. NO toca señales (signals INSERT-only) ni la
-- cadena de registro ni el epoch. count(signals)=0 → ninguna señal productiva afectada. Reutiliza
-- set_updated_at() (001) y signal_forbid_mutation() (013).

-- ---------- closing: campos §5-7 (additivos sobre signal_closing_snapshots) ----------
ALTER TABLE signal_closing_snapshots
  ADD COLUMN IF NOT EXISTS canonical_event_id     UUID,
  ADD COLUMN IF NOT EXISTS market                 TEXT,
  ADD COLUMN IF NOT EXISTS period                 TEXT,
  ADD COLUMN IF NOT EXISTS outcome                TEXT,
  ADD COLUMN IF NOT EXISTS closing_odds           NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS closing_probability    NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS closing_source         TEXT,   -- consensus_no_vig | best_sportsbook | sportsbook:<code>
  ADD COLUMN IF NOT EXISTS provider_updated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kickoff_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closing_status         TEXT,   -- §5: AVAILABLE|UNAVAILABLE|STALE|MARKET_SUSPENDED|EVENT_STARTED|MAPPING_ERROR|NO_EQUIVALENT_MARKET|PROVIDER_ERROR
  ADD COLUMN IF NOT EXISTS closing_reason_code    TEXT,
  ADD COLUMN IF NOT EXISTS closing_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS clv_components         JSONB;  -- §7: componentes para reproducir el CLV
ALTER TABLE signal_closing_snapshots DROP CONSTRAINT IF EXISTS chk_closing_status;
ALTER TABLE signal_closing_snapshots ADD CONSTRAINT chk_closing_status CHECK (
  closing_status IS NULL OR closing_status IN
  ('AVAILABLE','UNAVAILABLE','STALE','MARKET_SUSPENDED','EVENT_STARTED','MAPPING_ERROR','NO_EQUIVALENT_MARKET','PROVIDER_ERROR'));

-- ---------- settlement: estados + finalidad + correcciones de proveedor §8-12 (additivos) ----------
ALTER TABLE signal_settlements
  ADD COLUMN IF NOT EXISTS result_outcome         TEXT,   -- §8: home|draw|away|won|lost|void|push|none|unresolved
  ADD COLUMN IF NOT EXISTS provider_result_status TEXT,   -- §10: in_progress|provisional|final|postponed|abandoned|...
  ADD COLUMN IF NOT EXISTS result_observed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_finalized_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS regulation_score       JSONB,  -- {home_goals, away_goals} SOLO tiempo reglamentario
  ADD COLUMN IF NOT EXISTS settlement_policy_version TEXT;
-- extiende el set de estados de lifecycle (preserva los previos que lee metrics-engine: final/void/cancelled).
ALTER TABLE signal_settlements DROP CONSTRAINT IF EXISTS signal_settlements_settlement_status_check;
ALTER TABLE signal_settlements ADD CONSTRAINT signal_settlements_settlement_status_check CHECK (
  settlement_status IN ('pending','provisional','final','won','lost','void','push','cancelled','postponed','abandoned','unresolved','disputed','corrected'));

-- ---------- 2.1 anchor de audit pre-026 (bridge append-only) ----------
-- La fila histórica epoch_activation (audit_hash=null) NO se modifica. El anchor referencia su audit_event_id,
-- guarda un hash determinístico de su contenido inmutable, y se convierte en el primer eslabón verificable de
-- la cadena administrativa. No fabrica timestamps anteriores.
CREATE TABLE IF NOT EXISTS signal_admin_chain_anchors (
  anchor_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anchored_audit_event_id UUID NOT NULL REFERENCES signal_admin_actions(audit_event_id),
  bridge_kind             TEXT NOT NULL DEFAULT 'pre_chain_genesis',
  content_hash            TEXT NOT NULL,   -- hash determinístico del contenido de la fila histórica
  anchor_hash             TEXT NOT NULL,   -- eslabón que ancla la cadena (genesis efectivo)
  note                    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (anchored_audit_event_id)
);
DROP TRIGGER IF EXISTS trg_admin_anchor_immutable ON signal_admin_chain_anchors;
CREATE TRIGGER trg_admin_anchor_immutable BEFORE UPDATE OR DELETE ON signal_admin_chain_anchors
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- 2/§16 contrato de anclaje externo del commitment (OFF; sin scheduler, sin fondos) ----------
CREATE TABLE IF NOT EXISTS signal_commitment_external_anchors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_date    DATE NOT NULL,
  destination        TEXT NOT NULL DEFAULT 'none',           -- none | opentimestamps | chain:<x> (futuro)
  external_timestamp TIMESTAMPTZ,
  transaction_ref    TEXT,
  status             TEXT NOT NULL DEFAULT 'disabled'
                       CHECK (status IN ('disabled','pending','submitted','confirmed','failed')),
  retries            INTEGER NOT NULL DEFAULT 0,
  proof              JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commitment_date, destination)
);
DROP TRIGGER IF EXISTS trg_ext_anchor_updated ON signal_commitment_external_anchors;
CREATE TRIGGER trg_ext_anchor_updated BEFORE UPDATE ON signal_commitment_external_anchors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +migrate down
DROP TABLE IF EXISTS signal_commitment_external_anchors;
DROP TABLE IF EXISTS signal_admin_chain_anchors;
ALTER TABLE signal_settlements DROP CONSTRAINT IF EXISTS signal_settlements_settlement_status_check;
ALTER TABLE signal_settlements ADD CONSTRAINT signal_settlements_settlement_status_check CHECK (
  settlement_status IN ('pending','provisional','final','void','cancelled','disputed','corrected'));
ALTER TABLE signal_settlements
  DROP COLUMN IF EXISTS result_outcome, DROP COLUMN IF EXISTS provider_result_status,
  DROP COLUMN IF EXISTS result_observed_at, DROP COLUMN IF EXISTS result_finalized_at,
  DROP COLUMN IF EXISTS regulation_score, DROP COLUMN IF EXISTS settlement_policy_version;
ALTER TABLE signal_closing_snapshots DROP CONSTRAINT IF EXISTS chk_closing_status;
ALTER TABLE signal_closing_snapshots
  DROP COLUMN IF EXISTS canonical_event_id, DROP COLUMN IF EXISTS market, DROP COLUMN IF EXISTS period,
  DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS closing_odds, DROP COLUMN IF EXISTS closing_probability,
  DROP COLUMN IF EXISTS closing_source, DROP COLUMN IF EXISTS provider_updated_at, DROP COLUMN IF EXISTS kickoff_at,
  DROP COLUMN IF EXISTS closing_status, DROP COLUMN IF EXISTS closing_reason_code,
  DROP COLUMN IF EXISTS closing_policy_version, DROP COLUMN IF EXISTS clv_components;
