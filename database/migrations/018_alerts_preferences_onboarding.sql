-- 018 — Alertas de usuario + preferencias + onboarding (Sprint 8A §29-39). Aditivo. No toca db.json ni el
-- legacy de alertas por email (que vive en db.json). Todo gated por flags USER_ALERTS_*/USER_PREFERENCES_*.

-- ---------- user_preferences (§36) — una fila por usuario (id de usuario = email hash o ref del legacy) ----------
CREATE TABLE IF NOT EXISTS user_preferences (
  user_ref            TEXT PRIMARY KEY,
  language            TEXT DEFAULT 'es',
  timezone            TEXT DEFAULT 'UTC',          -- IANA (Europe/Madrid, America/Santo_Domingo, ...)
  country             TEXT,
  preferred_odds_format TEXT DEFAULT 'decimal',     -- decimal|american|fractional|probability (solo presentación)
  competitions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  teams               JSONB NOT NULL DEFAULT '[]'::jsonb,
  providers           JSONB NOT NULL DEFAULT '[]'::jsonb,
  signal_filters      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {min_edge, min_ev, only_strong, only_picks, arb}
  alert_preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {types, channels:{in_app,email,telegram}, quiet_hours:{start,end}}
  accessibility       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_up_updated ON user_preferences;
CREATE TRIGGER trg_up_updated BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- user_onboarding_state (§38) ----------
CREATE TABLE IF NOT EXISTS user_onboarding_state (
  user_ref            TEXT PRIMARY KEY,
  version             TEXT NOT NULL DEFAULT 'onboarding-v1',
  status              TEXT NOT NULL DEFAULT 'not_started',  -- not_started|started|completed|skipped
  current_step        INTEGER NOT NULL DEFAULT 0,
  steps_completed     JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_uos_updated ON user_onboarding_state;
CREATE TRIGGER trg_uos_updated BEFORE UPDATE ON user_onboarding_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- user_alerts (§30) — generadas server-side; el frontend nunca crea alerts ----------
CREATE TABLE IF NOT EXISTS user_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref            TEXT NOT NULL,
  alert_type          TEXT NOT NULL,               -- new_pick_gp|pick_price_moved|pick_closed|pick_settled|new_strong_signal|new_executable_arb|arb_expiring|followed_match_update
  entity_type         TEXT,
  entity_id           TEXT,
  dedup_key           TEXT NOT NULL,               -- user+type+entity+material_state_version → idempotencia (§31)
  title               TEXT NOT NULL,
  body                TEXT,
  severity            TEXT NOT NULL DEFAULT 'info', -- info|important|critical
  status              TEXT NOT NULL DEFAULT 'pending', -- pending|delivered|partially_delivered|failed|expired|cancelled|read
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at             TIMESTAMPTZ,
  expired_at          TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);
-- dedup: una alerta por (usuario, dedup_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ua_dedup ON user_alerts (user_ref, dedup_key);
CREATE INDEX IF NOT EXISTS idx_ua_user_created ON user_alerts (user_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ua_unread ON user_alerts (user_ref) WHERE read_at IS NULL AND status <> 'cancelled';

-- ---------- alert_delivery_attempts (§30) ----------
CREATE TABLE IF NOT EXISTS alert_delivery_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id            UUID NOT NULL REFERENCES user_alerts(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,               -- in_app|email|telegram
  attempt             INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending|delivered|failed|skipped
  provider_message_id TEXT,
  safe_error          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ada_alert ON alert_delivery_attempts (alert_id);

-- +migrate down
DROP TABLE IF EXISTS alert_delivery_attempts;
DROP TABLE IF EXISTS user_alerts;
DROP TABLE IF EXISTS user_onboarding_state;
DROP TABLE IF EXISTS user_preferences;
