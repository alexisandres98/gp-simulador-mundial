-- 026 — Fase G.1: controles administrativos POR SEÑAL. Aditiva, posterior a 024/025.
-- NO toca `signals` (INSERT-only) ni la cadena de registro (signals.registry_hash). count(signals)=0 →
-- ninguna señal productiva afectada. Añade:
--   1) signal_admin_state    — proyección MUTABLE del estado administrativo por señal (reconstruible desde el audit).
--   2) signal_corrections    — append-only: una corrección NUNCA edita el original; crea la representación efectiva.
--   3) columnas en signal_admin_actions: changed_fields, session_metadata, idempotency_key,
--      previous_audit_hash + audit_hash → cadena administrativa append-only (evidencia de no-alteración §12).
-- Reutiliza set_updated_at() (001) y signal_forbid_mutation() (013).

-- ---------- 1) estado administrativo por señal (proyección mutable; máquina de estados §4) ----------
CREATE TABLE IF NOT EXISTS signal_admin_state (
  signal_id        UUID PRIMARY KEY REFERENCES signals(id) ON DELETE CASCADE,
  admin_status     TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (admin_status IN ('ACTIVE','QUARANTINED','RETRACTED','CORRECTED','ADMINISTRATIVE_VOID','DATA_ERROR')),
  visibility       TEXT NOT NULL DEFAULT 'visible'
                     CHECK (visibility IN ('visible','hidden')),
  last_action      TEXT,
  last_action_id   UUID,            -- audit_event_id de la última acción
  last_reason_code TEXT,
  quarantine_ref   UUID,            -- audit_event_id de la quarantine activa (referencia obligatoria para RESTORE §5)
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_state_status ON signal_admin_state(admin_status);
DROP TRIGGER IF EXISTS trg_admin_state_updated ON signal_admin_state;
CREATE TRIGGER trg_admin_state_updated BEFORE UPDATE ON signal_admin_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 2) correcciones (append-only; §7 — original intacto, vista efectiva derivada) ----------
CREATE TABLE IF NOT EXISTS signal_corrections (
  correction_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id        UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  audit_event_id   UUID REFERENCES signal_admin_actions(audit_event_id),
  corrected_fields JSONB NOT NULL,          -- { campo: { old: <valor anterior>, new: <valor nuevo> } }
  is_material      BOOLEAN NOT NULL DEFAULT false,  -- toca event/selection/market/period/published_at
  reason_code      TEXT,
  reason_text      TEXT,
  policy_version   TEXT,
  schema_version   TEXT,
  admin_id         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corrections_signal ON signal_corrections(signal_id, created_at);
DROP TRIGGER IF EXISTS trg_corrections_immutable ON signal_corrections;
CREATE TRIGGER trg_corrections_immutable BEFORE UPDATE OR DELETE ON signal_corrections
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- ---------- 3) extensión de signal_admin_actions (audit append-only §12) ----------
ALTER TABLE signal_admin_actions
  ADD COLUMN IF NOT EXISTS changed_fields      JSONB,
  ADD COLUMN IF NOT EXISTS session_metadata    JSONB,
  ADD COLUMN IF NOT EXISTS idempotency_key     TEXT,
  ADD COLUMN IF NOT EXISTS previous_audit_hash TEXT,
  ADD COLUMN IF NOT EXISTS audit_hash          TEXT;
-- idempotencia: una misma idempotency_key no repite la acción (§15).
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_actions_idem ON signal_admin_actions(idempotency_key) WHERE idempotency_key IS NOT NULL;
-- cadena administrativa: audit_hash único (evidencia de no-alteración del audit log §12).
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_actions_audit_hash ON signal_admin_actions(audit_hash) WHERE audit_hash IS NOT NULL;
-- timeline por señal (detalle §14).
CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON signal_admin_actions(target_type, target_id, created_at_utc);

-- +migrate down
DROP TABLE IF EXISTS signal_corrections;
DROP TRIGGER IF EXISTS trg_admin_state_updated ON signal_admin_state;
DROP TABLE IF EXISTS signal_admin_state;
DROP INDEX IF EXISTS uq_admin_actions_idem;
DROP INDEX IF EXISTS uq_admin_actions_audit_hash;
DROP INDEX IF EXISTS idx_admin_actions_target;
ALTER TABLE signal_admin_actions
  DROP COLUMN IF EXISTS changed_fields,
  DROP COLUMN IF EXISTS session_metadata,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS previous_audit_hash,
  DROP COLUMN IF EXISTS audit_hash;
