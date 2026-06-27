-- 037 — Fase O.1: venues exactos + federation mappings + activación de noticias. ADITIVA, reversible, INERTE.
-- Catálogo canónico de estadios (coords verificadas) para clima EXACTO; mapeo team→federación oficial; columnas
-- de venue exacto en weather_snapshots (las snapshots previas con sede representativa quedan venue_exact=null →
-- NO elegibles). NO toca tablas oficiales. Reusa set_updated_at()/signal_forbid_mutation().

-- catálogo canónico de estadios (coords verificadas; clima solo con venue exacto)
CREATE TABLE IF NOT EXISTS canonical_venues (
  venue_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL UNIQUE,
  aliases         JSONB NOT NULL DEFAULT '[]'::jsonb,
  city            TEXT,
  country         TEXT,
  latitude        NUMERIC(9,5),
  longitude       NUMERIC(9,5),
  timezone        TEXT,
  source          TEXT,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_cv_updated ON canonical_venues;
CREATE TRIGGER trg_cv_updated BEFORE UPDATE ON canonical_venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- mapeo team → federación oficial (versionado, verificado; oficialidad NO se infiere por el nombre del país)
CREATE TABLE IF NOT EXISTS federation_mappings (
  mapping_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             TEXT NOT NULL,
  federation_name     TEXT,
  official_domain     TEXT,
  news_endpoint       TEXT,
  feed_endpoint       TEXT,
  verification_method TEXT,
  verified_at         TIMESTAMPTZ,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id)
);

-- venue exacto en weather (las snapshots previas con sede representativa → venue_exact null = NO elegibles)
ALTER TABLE weather_snapshots
  ADD COLUMN IF NOT EXISTS venue_id      UUID,
  ADD COLUMN IF NOT EXISTS venue_exact   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weather_status TEXT NOT NULL DEFAULT 'AVAILABLE';  -- AVAILABLE | BLOCKED_MISSING_EXACT_VENUE | STALE

-- venue resuelto por evento (mapping canonical_event → venue_id, con confianza)
CREATE TABLE IF NOT EXISTS event_venue_resolution (
  resolution_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id UUID NOT NULL,
  venue_id           UUID,
  espn_venue_name    TEXT,
  match_confidence   NUMERIC(6,4),
  match_method       TEXT,
  status             TEXT NOT NULL DEFAULT 'resolved',      -- resolved | blocked_missing_exact_venue
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canonical_event_id)
);

-- +migrate down
DROP TABLE IF EXISTS event_venue_resolution;
ALTER TABLE weather_snapshots DROP COLUMN IF EXISTS venue_id, DROP COLUMN IF EXISTS venue_exact, DROP COLUMN IF EXISTS weather_status;
DROP TABLE IF EXISTS federation_mappings;
DROP TABLE IF EXISTS canonical_venues;
