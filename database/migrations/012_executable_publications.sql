-- 012 — Capa de producto: publicación controlada de oportunidades ejecutables. Sprint 4.
-- No toca datos previos (Sprints 0-3 intactos). Toda publicación es por aprobación humana y queda auditada.
-- Reutiliza la función set_updated_at() definida en migraciones previas.

-- ---------- arb_publications ----------
-- Una evaluación del motor NO equivale a una publicación. Esta tabla es la capa explícita de publicación.
CREATE TABLE IF NOT EXISTS arb_publications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id            UUID REFERENCES arb_opportunities(id) ON DELETE CASCADE,
  opportunity_key           TEXT NOT NULL,
  evaluation_id             UUID REFERENCES arb_evaluations(id) ON DELETE SET NULL,
  publication_status        TEXT NOT NULL DEFAULT 'draft'
                              CHECK (publication_status IN ('draft','approved','published','paused','expired','withdrawn','rejected')),
  visibility                TEXT NOT NULL DEFAULT 'internal'
                              CHECK (visibility IN ('internal','beta','public')),
  public_id                 TEXT UNIQUE,                 -- id opaco para la API pública
  reviewed_by               TEXT,
  reviewed_at               TIMESTAMPTZ,
  published_at              TIMESTAMPTZ,
  unpublished_at            TIMESTAMPTZ,
  expires_at                TIMESTAMPTZ,
  publication_reason        TEXT,
  unpublication_reason      TEXT,
  public_payload            JSONB,                       -- snapshot CONGELADO de lo mostrado al publicar
  published_mapping_version TEXT,                        -- base de equivalencia al publicar (para invalidación)
  published_rules_fingerprint TEXT,
  risk_disclosure_version   TEXT,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_arb_pub_updated ON arb_publications;
CREATE TRIGGER trg_arb_pub_updated BEFORE UPDATE ON arb_publications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_arb_pub_status      ON arb_publications(publication_status);
CREATE INDEX IF NOT EXISTS idx_arb_pub_visibility  ON arb_publications(visibility);
CREATE INDEX IF NOT EXISTS idx_arb_pub_published   ON arb_publications(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_arb_pub_expires     ON arb_publications(expires_at);
CREATE INDEX IF NOT EXISTS idx_arb_pub_opportunity ON arb_publications(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_arb_pub_evaluation  ON arb_publications(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_arb_pub_oppkey      ON arb_publications(opportunity_key);

-- ---------- arb_publication_history ----------
-- Audita TODA transición de estado / acción administrativa.
CREATE TABLE IF NOT EXISTS arb_publication_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id  UUID NOT NULL REFERENCES arb_publications(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status      TEXT,
  action          TEXT NOT NULL,            -- create | approve | publish | pause | withdraw | reject | revalidate | expire
  actor_id        TEXT,
  reason          TEXT,
  evaluation_id   UUID,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arb_pub_hist_pub     ON arb_publication_history(publication_id);
CREATE INDEX IF NOT EXISTS idx_arb_pub_hist_created ON arb_publication_history(created_at DESC);

-- ---------- provider_jurisdiction_rules ----------
-- Capa INFORMATIVA de disponibilidad por país. No es asesoría legal. Versionada, con fuente y fecha.
CREATE TABLE IF NOT EXISTS provider_jurisdiction_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code     TEXT NOT NULL,
  country_code      TEXT NOT NULL,           -- ISO-3166 alpha-2
  status            TEXT NOT NULL DEFAULT 'requires_provider_verification'
                      CHECK (status IN ('available','restricted','unknown','requires_provider_verification')),
  source_url        TEXT,
  source_checked_at TIMESTAMPTZ,
  notes             TEXT,
  version           TEXT NOT NULL DEFAULT 'jurisdiction-seed-1',
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_code, country_code, version)
);
DROP TRIGGER IF EXISTS trg_jurisdiction_updated ON provider_jurisdiction_rules;
CREATE TRIGGER trg_jurisdiction_updated BEFORE UPDATE ON provider_jurisdiction_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_jurisdiction_provider_country ON provider_jurisdiction_rules(provider_code, country_code);

-- ---------- provider_deep_link_templates ----------
-- Plantillas versionadas de deep links (override opcional del código). Allowlist de dominios en la app.
CREATE TABLE IF NOT EXISTS provider_deep_link_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code TEXT NOT NULL,
  template_type TEXT NOT NULL,               -- market | event | series
  url_template  TEXT NOT NULL,
  version       TEXT NOT NULL DEFAULT 'deeplink-1',
  verified      BOOLEAN NOT NULL DEFAULT false,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_code, template_type, version)
);
DROP TRIGGER IF EXISTS trg_deeplink_tpl_updated ON provider_deep_link_templates;
CREATE TRIGGER trg_deeplink_tpl_updated BEFORE UPDATE ON provider_deep_link_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_deeplink_tpl_provider ON provider_deep_link_templates(provider_code);

-- ---------- executable_opportunity_events ----------
-- Analítica de producto MÍNIMA. NUNCA guarda capital/bankroll/saldos (solo rangos anónimos si acaso).
CREATE TABLE IF NOT EXISTS executable_opportunity_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          TEXT NOT NULL,
  public_id           TEXT,
  provider_code       TEXT,
  jurisdiction_status TEXT,
  classification      TEXT,
  calculator_range    TEXT,                  -- '0-100' | '100-500' | '500+' (nunca el monto exacto)
  session_ref         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exec_evt_type    ON executable_opportunity_events(event_type);
CREATE INDEX IF NOT EXISTS idx_exec_evt_created ON executable_opportunity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_evt_public  ON executable_opportunity_events(public_id);

-- +migrate down
DROP TABLE IF EXISTS executable_opportunity_events;
DROP TABLE IF EXISTS provider_deep_link_templates;
DROP TABLE IF EXISTS provider_jurisdiction_rules;
DROP TABLE IF EXISTS arb_publication_history;
DROP TABLE IF EXISTS arb_publications;
