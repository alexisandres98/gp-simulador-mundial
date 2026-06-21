-- 002 — Snapshots de mercado (scaffolding para Sprint 1). Tablas vacías en Sprint 0.
-- Precios/cantidades en NUMERIC(20,8) (NUNCA float). Payload original en JSONB. Timestamps separados.

-- ---------- raw_market_snapshots ----------
-- Almacena EXACTAMENTE lo recibido del proveedor. Inmutable. checksum para deduplicar (riesgos R6/R8).
CREATE TABLE IF NOT EXISTS raw_market_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_event_id   TEXT,
  external_market_id  TEXT,
  external_outcome_id TEXT,
  payload             JSONB NOT NULL,                    -- cuerpo original sin transformar
  provider_timestamp  TIMESTAMPTZ,                        -- lo que dice el proveedor (NULL si no lo aporta)
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(), -- cuándo lo recibió nuestro adapter
  request_latency_ms  INTEGER,
  ingestion_run_id    UUID REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  checksum            TEXT,                               -- hash determinístico del payload (sin secretos)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_raw_provider_market ON raw_market_snapshots(provider_id, external_market_id);
CREATE INDEX IF NOT EXISTS idx_raw_received_at     ON raw_market_snapshots(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_provider_ts     ON raw_market_snapshots(provider_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_raw_checksum        ON raw_market_snapshots(checksum);
CREATE INDEX IF NOT EXISTS idx_raw_ingestion_run   ON raw_market_snapshots(ingestion_run_id);

-- ---------- normalized_market_snapshots ----------
-- Forma interna consistente. Append-only (no sobreescribe). last_trade/bid/ask/midpoint son DISTINTOS.
CREATE TABLE IF NOT EXISTS normalized_market_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_snapshot_id     UUID REFERENCES raw_market_snapshots(id) ON DELETE SET NULL,
  provider_id         UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_event_id   TEXT,
  external_market_id  TEXT,
  external_outcome_id TEXT,
  market_status       TEXT,                               -- open | closed | resolved | suspended | unknown
  side                TEXT,                               -- yes | no | home | draw | away | over | under ...
  best_bid            NUMERIC(20,8),
  best_ask            NUMERIC(20,8),
  midpoint            NUMERIC(20,8),                       -- derivado (best_bid+best_ask)/2
  last_trade          NUMERIC(20,8),
  spread              NUMERIC(20,8),
  volume              NUMERIC(20,8),
  open_interest       NUMERIC(20,8),
  available_depth     NUMERIC(20,8),
  currency            TEXT DEFAULT 'USD',
  is_live             BOOLEAN NOT NULL DEFAULT false,
  provider_timestamp  TIMESTAMPTZ,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- cuándo se normalizó
  normalizer_version  TEXT NOT NULL DEFAULT 'v0',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_norm_provider_market ON normalized_market_snapshots(provider_id, external_market_id);
CREATE INDEX IF NOT EXISTS idx_norm_received_at     ON normalized_market_snapshots(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_norm_provider_ts     ON normalized_market_snapshots(provider_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_norm_raw             ON normalized_market_snapshots(raw_snapshot_id);

-- +migrate down
DROP TABLE IF EXISTS normalized_market_snapshots;
DROP TABLE IF EXISTS raw_market_snapshots;
