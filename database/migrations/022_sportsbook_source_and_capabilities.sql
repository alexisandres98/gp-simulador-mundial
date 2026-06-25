-- 022 — Post-shadow Bloques E + F.
-- F: extiende sportsbook_source_metadata (mig 017) a un catálogo VERSIONADO de fuentes con estado de
--    verificación (verified/unverified/duplicate_skin/excluded), región, marca/skin, vigencia y evidencia
--    interna (privada). Regla: unverified NO cumple el mínimo para STRONG; unknown NO cuenta como
--    independiente automáticamente. El DTO público solo expone el número de grupos independientes válidos.
-- E: catálogo de capabilities por sport key (cuáles soportan h2h) para no reconsultar keys incompatibles.

-- ---------- F: extensión del catálogo de fuentes ----------
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified';
  -- verified | unverified | duplicate_skin | excluded
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS region        TEXT;
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS brand_skin    TEXT;
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS valid_from    TIMESTAMPTZ;
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS valid_to      TIMESTAMPTZ;   -- null = vigente
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS internal_notes TEXT;          -- PRIVADO, nunca en DTO público
ALTER TABLE sportsbook_source_metadata ADD COLUMN IF NOT EXISTS evidence      JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_ssm_verification ON sportsbook_source_metadata (verification_status) WHERE is_active = true;

-- historial de versiones del catálogo (cambios de propiedad/grupo se versionan, append-only)
CREATE TABLE IF NOT EXISTS sportsbook_source_metadata_history (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_provider        TEXT NOT NULL,
  sportsbook_code      TEXT NOT NULL,
  version              INTEGER NOT NULL,
  operator_group       TEXT,
  independence_group   TEXT,
  source_role          TEXT,
  verification_status  TEXT,
  region               TEXT,
  jurisdiction         TEXT,
  valid_from           TIMESTAMPTZ,
  valid_to             TIMESTAMPTZ,
  change_reason        TEXT,
  changed_by           TEXT,
  snapshot             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ssmh_book ON sportsbook_source_metadata_history (data_provider, sportsbook_code, version DESC);

-- ---------- E: capabilities por sport key ----------
CREATE TABLE IF NOT EXISTS sportsbook_provider_capabilities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_provider        TEXT NOT NULL,
  sport_key            TEXT NOT NULL,
  sport_title          TEXT,
  sport_group          TEXT,
  supports_h2h         BOOLEAN,            -- null = desconocido aún
  is_active            BOOLEAN NOT NULL DEFAULT true,   -- false = excluida de la ingesta activa
  last_status          TEXT,               -- ok | bad_request | no_h2h | error
  last_error_code      TEXT,
  last_checked_at      TIMESTAMPTZ,
  consecutive_errors   INTEGER NOT NULL DEFAULT 0,
  reason               TEXT,               -- por qué se excluyó (ej: 'sport key sin mercado h2h')
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_provider, sport_key)
);
CREATE INDEX IF NOT EXISTS idx_spc_active ON sportsbook_provider_capabilities (data_provider, is_active);
DROP TRIGGER IF EXISTS trg_spc_updated ON sportsbook_provider_capabilities;
CREATE TRIGGER trg_spc_updated BEFORE UPDATE ON sportsbook_provider_capabilities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +migrate down
DROP TABLE IF EXISTS sportsbook_provider_capabilities;
DROP TABLE IF EXISTS sportsbook_source_metadata_history;
DROP INDEX IF EXISTS idx_ssm_verification;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS evidence;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS internal_notes;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS valid_to;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS valid_from;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS brand_skin;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS region;
ALTER TABLE sportsbook_source_metadata DROP COLUMN IF EXISTS verification_status;
