-- 006 — Outcomes canónicos y su mapeo por proveedor (Sprint 0.1, scaffolding para Sprint 2).
-- Representa formalmente cada resultado posible de un mercado, para entender equivalencias como
--   Polymarket YES  =  Kalshi "España gana"  =  Sportsbook Home.
-- NO se construye matching automático aquí: solo esquema, constraints, repos y tests.

-- ---------- canonical_outcomes ----------
CREATE TABLE IF NOT EXISTS canonical_outcomes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_market_id  UUID NOT NULL REFERENCES canonical_markets(id) ON DELETE CASCADE,
  outcome_code         TEXT NOT NULL,                 -- home | draw | away | yes | no | over | under ...
  outcome_name         TEXT,
  outcome_type         TEXT,                          -- binary | categorical | scalar
  participant_reference TEXT,                         -- a qué participante alude (código/nombre estable)
  display_order        INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','settled','void','unknown')),
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- evita outcomes duplicados dentro del mismo mercado
  UNIQUE (canonical_market_id, outcome_code)
);
DROP TRIGGER IF EXISTS trg_canon_outcomes_updated ON canonical_outcomes;
CREATE TRIGGER trg_canon_outcomes_updated BEFORE UPDATE ON canonical_outcomes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_canon_outcomes_market ON canonical_outcomes(canonical_market_id);

-- ---------- provider_outcome_mappings ----------
CREATE TABLE IF NOT EXISTS provider_outcome_mappings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_market_id   TEXT,
  external_outcome_id  TEXT,
  canonical_outcome_id UUID REFERENCES canonical_outcomes(id) ON DELETE SET NULL,
  mapping_status       TEXT NOT NULL DEFAULT 'needs_review'
                         CHECK (mapping_status IN ('matched','conditional','rejected','needs_review')),
  equivalence_score    NUMERIC(6,4),
  mapping_method       TEXT,                          -- exact | heuristic | manual | model
  mapping_version      TEXT NOT NULL DEFAULT 'v0',
  reviewed_by          TEXT,
  reviewed_at          TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- un mapping 'matched' DEBE apuntar a un outcome canónico (no mappings matched huérfanos)
  CONSTRAINT chk_matched_has_canonical CHECK (mapping_status <> 'matched' OR canonical_outcome_id IS NOT NULL),
  -- no repetir el mismo mapeo externo en la misma versión
  UNIQUE (provider_id, external_market_id, external_outcome_id, mapping_version)
);
DROP TRIGGER IF EXISTS trg_outcome_mappings_updated ON provider_outcome_mappings;
CREATE TRIGGER trg_outcome_mappings_updated BEFORE UPDATE ON provider_outcome_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_outcome_map_canonical ON provider_outcome_mappings(canonical_outcome_id);
CREATE INDEX IF NOT EXISTS idx_outcome_map_status    ON provider_outcome_mappings(mapping_status);
-- a lo sumo UN outcome canónico 'matched' por (proveedor, mercado externo, outcome externo):
-- evita que un outcome externo quede mapeado a múltiples outcomes activos incompatibles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outcome_matched_active
  ON provider_outcome_mappings (provider_id, external_market_id, external_outcome_id)
  WHERE mapping_status = 'matched';

-- +migrate down
DROP TABLE IF EXISTS provider_outcome_mappings;
DROP TABLE IF EXISTS canonical_outcomes;
