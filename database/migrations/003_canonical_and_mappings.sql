-- 003 — Canonical Event Graph y mapeos proveedor↔canónico (scaffolding para Sprint 2).
-- Tablas vacías en Sprint 0. NO se implementa matching automático todavía.
-- IDs canónicos = UUID persistentes (no derivados de texto mutable). Ver sprint-0-identifiers.md.

-- ---------- canonical_events ----------
CREATE TABLE IF NOT EXISTS canonical_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT NOT NULL DEFAULT 'match',       -- match | outright | future
  sport             TEXT,                                -- football | nfl | ...
  competition       TEXT,
  season            TEXT,
  home_participant  TEXT,
  away_participant  TEXT,
  scheduled_start   TIMESTAMPTZ,
  venue             TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','live','final','postponed','cancelled','unknown')),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_canon_events_updated ON canonical_events;
CREATE TRIGGER trg_canon_events_updated BEFORE UPDATE ON canonical_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_canon_events_start ON canonical_events(scheduled_start);
CREATE INDEX IF NOT EXISTS idx_canon_events_sport ON canonical_events(sport, competition);

-- ---------- canonical_markets ----------
CREATE TABLE IF NOT EXISTS canonical_markets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id   UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  market_type          TEXT NOT NULL,                    -- 1x2 | moneyline | totals | btts | winner ...
  period               TEXT DEFAULT 'full_time',
  outcome_type         TEXT,                             -- binary | categorical | scalar
  draw_possible        BOOLEAN,
  includes_extra_time  BOOLEAN,
  includes_penalties   BOOLEAN,
  qualification_market BOOLEAN NOT NULL DEFAULT false,
  resolution_source    TEXT,
  rules_fingerprint    TEXT,                             -- hash de las reglas, para detectar discrepancias
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','closed','resolved','suspended','unknown')),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_canon_markets_updated ON canonical_markets;
CREATE TRIGGER trg_canon_markets_updated BEFORE UPDATE ON canonical_markets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_canon_markets_event ON canonical_markets(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_canon_markets_type  ON canonical_markets(market_type);

-- ---------- provider_event_mappings ----------
-- Relaciona un external_event_id de un proveedor con un canonical_event_id. equivalence_score/method
-- para auditar CÓMO se decidió (el motor de equivalencia es Sprint 2). Resuelve riesgos R4/R5.
CREATE TABLE IF NOT EXISTS provider_event_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_event_id   TEXT NOT NULL,
  canonical_event_id  UUID REFERENCES canonical_events(id) ON DELETE SET NULL,
  mapping_status      TEXT NOT NULL DEFAULT 'needs_review'
                        CHECK (mapping_status IN ('matched','conditional','rejected','needs_review')),
  equivalence_score   NUMERIC(6,4),
  mapping_method      TEXT,                              -- exact | heuristic | manual | model
  mapping_version     TEXT NOT NULL DEFAULT 'v0',
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_event_id, mapping_version)
);
DROP TRIGGER IF EXISTS trg_event_mappings_updated ON provider_event_mappings;
CREATE TRIGGER trg_event_mappings_updated BEFORE UPDATE ON provider_event_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_event_map_canonical ON provider_event_mappings(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_event_map_status    ON provider_event_mappings(mapping_status);

-- ---------- provider_market_mappings ----------
CREATE TABLE IF NOT EXISTS provider_market_mappings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_market_id   TEXT NOT NULL,
  canonical_market_id  UUID REFERENCES canonical_markets(id) ON DELETE SET NULL,
  mapping_status       TEXT NOT NULL DEFAULT 'needs_review'
                         CHECK (mapping_status IN ('matched','conditional','rejected','needs_review')),
  equivalence_score    NUMERIC(6,4),
  mapping_method       TEXT,
  mapping_version      TEXT NOT NULL DEFAULT 'v0',
  rules_snapshot       JSONB,
  reviewed_by          TEXT,
  reviewed_at          TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_market_id, mapping_version)
);
DROP TRIGGER IF EXISTS trg_market_mappings_updated ON provider_market_mappings;
CREATE TRIGGER trg_market_mappings_updated BEFORE UPDATE ON provider_market_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_market_map_canonical ON provider_market_mappings(canonical_market_id);
CREATE INDEX IF NOT EXISTS idx_market_map_status    ON provider_market_mappings(mapping_status);

-- +migrate down
DROP TABLE IF EXISTS provider_market_mappings;
DROP TABLE IF EXISTS provider_event_mappings;
DROP TABLE IF EXISTS canonical_markets;
DROP TABLE IF EXISTS canonical_events;
