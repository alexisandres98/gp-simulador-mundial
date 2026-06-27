-- 028 — Fase H.1: cableado automático end-to-end de closing y settlement. Aditiva, posterior a 027.
-- (a) puente persistente canonical_event → ESPN fixture (settlement no usa fuzzy match en el momento de liquidar);
-- (b) origen de captura (automatic | manual_recovery | admin_override) en closing y settlement;
-- (c) metadata de closing oficial (best price + conteos de fuentes verificadas). count(signals)=0 → nada productivo.

-- ---------- (a) mapping persistente canonical_event_id → ESPN fixture ----------
CREATE TABLE IF NOT EXISTS signal_event_fixture_mappings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  fixture_id         TEXT NOT NULL,                 -- id interno del fixture (data/tournament.js)
  espn_id            TEXT,                          -- id ESPN del scoreboard
  is_knockout        BOOLEAN NOT NULL DEFAULT false,
  home_alias         TEXT,
  away_alias         TEXT,
  mapping_source     TEXT NOT NULL DEFAULT 'manual' CHECK (mapping_source IN ('manual','catalog','heuristic')),
  resolved_by        TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canonical_event_id)
);
CREATE INDEX IF NOT EXISTS idx_fixture_map_fixture ON signal_event_fixture_mappings(fixture_id);
DROP TRIGGER IF EXISTS trg_fixture_map_updated ON signal_event_fixture_mappings;
CREATE TRIGGER trg_fixture_map_updated BEFORE UPDATE ON signal_event_fixture_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- (b)(c) closing: origen + metadata oficial ----------
ALTER TABLE signal_closing_snapshots
  ADD COLUMN IF NOT EXISTS capture_source         TEXT DEFAULT 'automatic'
                             CHECK (capture_source IN ('automatic','manual_recovery','admin_override')),
  ADD COLUMN IF NOT EXISTS best_closing_odds      NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS best_closing_sportsbook TEXT,
  ADD COLUMN IF NOT EXISTS source_group_count     INTEGER,
  ADD COLUMN IF NOT EXISTS source_set_count       INTEGER;

-- ---------- (b) settlement: origen + fixture del proveedor ----------
ALTER TABLE signal_settlements
  ADD COLUMN IF NOT EXISTS capture_source     TEXT DEFAULT 'automatic'
                             CHECK (capture_source IN ('automatic','manual_recovery','admin_override')),
  ADD COLUMN IF NOT EXISTS provider_fixture_id TEXT;

-- +migrate down
ALTER TABLE signal_settlements DROP COLUMN IF EXISTS capture_source, DROP COLUMN IF EXISTS provider_fixture_id;
ALTER TABLE signal_closing_snapshots
  DROP COLUMN IF EXISTS capture_source, DROP COLUMN IF EXISTS best_closing_odds,
  DROP COLUMN IF EXISTS best_closing_sportsbook, DROP COLUMN IF EXISTS source_group_count, DROP COLUMN IF EXISTS source_set_count;
DROP TABLE IF EXISTS signal_event_fixture_mappings;
