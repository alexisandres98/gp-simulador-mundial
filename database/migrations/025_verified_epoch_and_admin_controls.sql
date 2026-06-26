-- 025 — Fase G: Verified Epoch PERSISTENTE + control administrativo de emergencia. Aditiva.
-- El epoch deja de depender solo de una env var mutable: queda en signal_registry_epochs (auditable, sin
-- backdating, inmutable hacia atrás). Controles admin globales (pausar/reanudar writes, ocultar público) en
-- registry_controls (mutables sin deploy). Audit append-only en signal_admin_actions.

-- ---------- epoch persistente (§3) ----------
CREATE TABLE IF NOT EXISTS signal_registry_epochs (
  epoch_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epoch_started_at_utc   TIMESTAMPTZ NOT NULL,
  registry_policy_version TEXT NOT NULL,
  signal_schema_version  TEXT NOT NULL,
  created_by_admin_id    TEXT,
  activation_reason      TEXT,
  previous_epoch_id      UUID REFERENCES signal_registry_epochs(epoch_id),
  status                 TEXT NOT NULL DEFAULT 'active',  -- active | retired
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- a lo sumo un epoch 'active' a la vez
CREATE UNIQUE INDEX IF NOT EXISTS uq_epoch_active ON signal_registry_epochs (status) WHERE status = 'active';
-- inmutable: un epoch no se puede mover hacia atrás ni reescribir su timestamp (solo status active→retired)
CREATE OR REPLACE FUNCTION sig_epoch_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'signal_registry_epochs es append-only (no DELETE)'; END IF;
  IF NEW.epoch_started_at_utc <> OLD.epoch_started_at_utc OR NEW.epoch_id <> OLD.epoch_id
     OR NEW.created_at <> OLD.created_at THEN RAISE EXCEPTION 'epoch inmutable: no se puede reescribir timestamp/id'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_epoch_guard ON signal_registry_epochs;
CREATE TRIGGER trg_epoch_guard BEFORE UPDATE OR DELETE ON signal_registry_epochs FOR EACH ROW EXECUTE FUNCTION sig_epoch_guard();

-- ---------- controles admin globales mutables (§6) ----------
CREATE TABLE IF NOT EXISTS registry_controls (
  control_key  TEXT PRIMARY KEY,   -- registry_writes_paused | registry_public_hidden | product_kill_switch
  enabled      BOOLEAN NOT NULL DEFAULT false,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO registry_controls (control_key, enabled) VALUES
  ('registry_writes_paused', false), ('registry_public_hidden', true), ('product_kill_switch', false)
ON CONFLICT (control_key) DO NOTHING;

-- ---------- audit append-only de acciones admin (§8) ----------
CREATE TABLE IF NOT EXISTS signal_admin_actions (
  audit_event_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        TEXT,
  action          TEXT NOT NULL,   -- epoch_activation|pause_writes|resume_writes|hide_public|show_public|quarantine|retract|correct|administrative_void|data_error|emergency_shutdown
  target_type     TEXT,
  target_id       TEXT,
  reason_code     TEXT,
  reason_text     TEXT,
  previous_state  JSONB,
  new_state       JSONB,
  request_id      TEXT,
  created_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- append-only: bloquea UPDATE/DELETE (reusa el patrón de inmutabilidad de Sprint 5)
DROP TRIGGER IF EXISTS trg_admin_actions_immutable ON signal_admin_actions;
CREATE TRIGGER trg_admin_actions_immutable BEFORE UPDATE OR DELETE ON signal_admin_actions
  FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- +migrate down
DROP TABLE IF EXISTS signal_admin_actions;
DROP TABLE IF EXISTS registry_controls;
DROP TRIGGER IF EXISTS trg_epoch_guard ON signal_registry_epochs;
DROP FUNCTION IF EXISTS sig_epoch_guard();
DROP TABLE IF EXISTS signal_registry_epochs;
