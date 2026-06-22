-- 019 — Analítica de producto + referrals (Sprint 8A §40-49). Aditivo. Privacidad: NO PII sensible, NO
-- bankroll/stakes/tarjetas. Eventos reconstruibles/retentibles según política. Gated por flags.

-- ---------- product_events (§41) ----------
CREATE TABLE IF NOT EXISTS product_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name      TEXT NOT NULL,
  event_version   TEXT NOT NULL DEFAULT 'v1',
  user_ref        TEXT,                       -- pseudónimo (hash/email), nullable
  anonymous_id    TEXT,
  session_id      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  properties      JSONB NOT NULL DEFAULT '{}'::jsonb,
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pe_name_time ON product_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pe_user ON product_events (user_ref, occurred_at DESC);

-- agregados diarios + cohortes de retención (derivados, reconstruibles)
CREATE TABLE IF NOT EXISTS analytics_daily_aggregates (
  day             DATE NOT NULL,
  event_name      TEXT NOT NULL,
  count           INTEGER NOT NULL DEFAULT 0,
  unique_users    INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (day, event_name)
);
CREATE TABLE IF NOT EXISTS analytics_retention_cohorts (
  cohort_day      DATE NOT NULL,
  cohort_type     TEXT NOT NULL DEFAULT 'organic',
  period          TEXT NOT NULL,             -- D1|D7|D14|D30
  cohort_size     INTEGER NOT NULL DEFAULT 0,
  retained        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cohort_day, cohort_type, period)
);

-- ---------- referrals (§47-49) ----------
CREATE TABLE IF NOT EXISTS referral_codes (
  code            TEXT PRIMARY KEY,           -- no secuencial, no predecible
  user_ref        TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rc_user ON referral_codes (user_ref);
CREATE TABLE IF NOT EXISTS referral_clicks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  anonymous_id    TEXT,
  ip_hash         TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rcl_code ON referral_clicks (code, occurred_at DESC);
CREATE TABLE IF NOT EXISTS referral_attributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  referrer_ref    TEXT NOT NULL,
  referred_ref    TEXT NOT NULL,
  touch_type      TEXT NOT NULL DEFAULT 'first',   -- first|last
  attributed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_ref)                            -- un registro no se atribuye dos veces (§47)
);
CREATE TABLE IF NOT EXISTS referral_rewards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref        TEXT NOT NULL,
  reward_type     TEXT NOT NULL,                   -- badge|early_access|waitlist_priority|cosmetic (NO financiero)
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'granted',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +migrate down
DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referral_attributions;
DROP TABLE IF EXISTS referral_clicks;
DROP TABLE IF EXISTS referral_codes;
DROP TABLE IF EXISTS analytics_retention_cohorts;
DROP TABLE IF EXISTS analytics_daily_aggregates;
DROP TABLE IF EXISTS product_events;
