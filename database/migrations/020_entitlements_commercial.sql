-- 020 — Preparación comercial (Sprint 8B §50-58). Entitlements + waitlist + competition registry. Aditivo.
-- BILLING FORZADO OFF: estas tablas NO cobran; solo preparan acceso. Durante el Mundial todo es gratis.

-- ---------- planes / features / entitlements (§52) ----------
CREATE TABLE IF NOT EXISTS plans (
  code            TEXT PRIMARY KEY,            -- free|pro|trader|admin|beta|world_cup_all_access
  display_name    TEXT NOT NULL,
  is_draft        BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS features (
  code            TEXT PRIMARY KEY,            -- value_full|picks_gp|fast_alerts|arbitrage|history|filters|...
  display_name    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plan_features (
  plan_code       TEXT NOT NULL REFERENCES plans(code) ON DELETE CASCADE,
  feature_code    TEXT NOT NULL REFERENCES features(code) ON DELETE CASCADE,
  PRIMARY KEY (plan_code, feature_code)
);
-- grants de acceso (§54): de dónde viene el acceso, vigencia, motivo
CREATE TABLE IF NOT EXISTS user_access_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref        TEXT NOT NULL,
  plan_code       TEXT NOT NULL REFERENCES plans(code),
  source          TEXT NOT NULL,               -- world_cup|beta|admin|referral|future_billing|promotion|b2b
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  reason          TEXT,
  created_by      TEXT,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uag_user ON user_access_grants (user_ref) WHERE revoked_at IS NULL;
-- overrides puntuales de feature (staff/pruebas)
CREATE TABLE IF NOT EXISTS entitlement_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref        TEXT NOT NULL,
  feature_code    TEXT NOT NULL,
  allowed         BOOLEAN NOT NULL DEFAULT true,
  reason          TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eo_user ON entitlement_overrides (user_ref);

-- ---------- waitlist GP Pro (§50) — sin tarjeta, sin checkout, sin depósito ----------
CREATE TABLE IF NOT EXISTS pro_waitlist (
  user_ref        TEXT PRIMARY KEY,
  email           TEXT,
  country         TEXT,
  preferred_plan  TEXT,
  primary_use_case TEXT,                       -- picks|value|arbitrage|alerts|best_odds|history|api|b2b
  desired_features JSONB NOT NULL DEFAULT '[]'::jsonb,
  acceptable_price_range TEXT,
  contact_consent BOOLEAN NOT NULL DEFAULT false,
  source          TEXT,
  status          TEXT NOT NULL DEFAULT 'joined',
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- competition_registry (§57) — cobertura post-Mundial ----------
CREATE TABLE IF NOT EXISTS competition_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport           TEXT NOT NULL,
  country         TEXT,
  competition_code TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  provider_keys   JSONB NOT NULL DEFAULT '[]'::jsonb,
  season          TEXT,
  start_at        TIMESTAMPTZ,
  end_at          TIMESTAMPTZ,
  data_status     TEXT NOT NULL DEFAULT 'unsupported',  -- unsupported|discovery|data_shadow|mapping_review|model_shadow|value_shadow|internal|public|paused
  model_status    TEXT NOT NULL DEFAULT 'unsupported',
  canonical_status TEXT NOT NULL DEFAULT 'unsupported',
  value_status    TEXT NOT NULL DEFAULT 'unsupported',
  pick_status     TEXT NOT NULL DEFAULT 'unsupported',
  public_status   TEXT NOT NULL DEFAULT 'unsupported',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, competition_code, season)
);
DROP TRIGGER IF EXISTS trg_cr_updated ON competition_registry;
CREATE TRIGGER trg_cr_updated BEFORE UPDATE ON competition_registry FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +migrate down
DROP TABLE IF EXISTS competition_registry;
DROP TABLE IF EXISTS pro_waitlist;
DROP TABLE IF EXISTS entitlement_overrides;
DROP TABLE IF EXISTS user_access_grants;
DROP TABLE IF EXISTS plan_features;
DROP TABLE IF EXISTS features;
DROP TABLE IF EXISTS plans;
