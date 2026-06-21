-- 009 — Catálogo de mercados de proveedor + niveles de order book (Sprint 1).
-- provider_market_catalog: registro ligero de mercados externos DESCUBIERTOS (no es el mercado canónico).
-- normalized_orderbook_levels: niveles del book por snapshot normalizado (para tamaño ejecutable en Sprint 3).

-- ---------- provider_market_catalog ----------
CREATE TABLE IF NOT EXISTS provider_market_catalog (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_event_id   TEXT,
  external_market_id  TEXT NOT NULL,
  title               TEXT,
  description         TEXT,
  market_type_raw     TEXT,
  status              TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (status IN ('open','closed','suspended','settled','cancelled','unknown')),
  start_time          TIMESTAMPTZ,
  close_time          TIMESTAMPTZ,
  settlement_time     TIMESTAMPTZ,
  resolution_source   TEXT,
  rules_url           TEXT,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- metadatos de descubrimiento (sin secretos)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_market_id)
);
DROP TRIGGER IF EXISTS trg_market_catalog_updated ON provider_market_catalog;
CREATE TRIGGER trg_market_catalog_updated BEFORE UPDATE ON provider_market_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_catalog_provider   ON provider_market_catalog(provider_id);
CREATE INDEX IF NOT EXISTS idx_catalog_status      ON provider_market_catalog(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_catalog_last_seen   ON provider_market_catalog(last_seen_at DESC);

-- ---------- normalized_orderbook_levels ----------
-- Un nivel del book ligado a un snapshot normalizado. side bid/ask, level_index 0 = mejor nivel.
CREATE TABLE IF NOT EXISTS normalized_orderbook_levels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_snapshot_id UUID NOT NULL REFERENCES normalized_market_snapshots(id) ON DELETE CASCADE,
  provider_id           UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_market_id    TEXT,
  external_outcome_id   TEXT,
  side                  TEXT NOT NULL CHECK (side IN ('bid','ask')),
  price                 NUMERIC(20,8) NOT NULL CHECK (price >= 0),
  size                  NUMERIC(28,8) NOT NULL CHECK (size >= 0),
  level_index           INTEGER NOT NULL CHECK (level_index >= 0),
  provider_timestamp    TIMESTAMPTZ,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- no duplicar el mismo nivel/lado dentro de un snapshot
  UNIQUE (normalized_snapshot_id, side, level_index)
);
CREATE INDEX IF NOT EXISTS idx_ob_snapshot ON normalized_orderbook_levels(normalized_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ob_market    ON normalized_orderbook_levels(provider_id, external_market_id, received_at DESC);

-- +migrate down
DROP TABLE IF EXISTS normalized_orderbook_levels;
DROP TABLE IF EXISTS provider_market_catalog;
