-- 004 — Historial de señales (scaffolding para Sprint 5). Tabla vacía en Sprint 0.
-- En sprints futuros será INMUTABLE: una corrección genera nueva versión, nunca un borrado.
-- Todavía NO se generan señales desde aquí; es solo la base persistente.

CREATE TABLE IF NOT EXISTS signals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type         TEXT NOT NULL,                     -- arbitrage | value | mover ...
  canonical_event_id  UUID REFERENCES canonical_events(id) ON DELETE SET NULL,
  canonical_market_id UUID REFERENCES canonical_markets(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','expired','superseded','corrected')),
  model_version       TEXT,
  mapping_version     TEXT,
  rules_version       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at        TIMESTAMPTZ,
  expired_at          TIMESTAMPTZ,
  snapshot_ids        UUID[] NOT NULL DEFAULT '{}',       -- snapshots normalizados que respaldan la señal
  signal_payload      JSONB NOT NULL DEFAULT '{}'::jsonb, -- la señal congelada (edge, precios, tamaños...)
  result_payload      JSONB,                              -- resolución posterior (para CLV/ROI en Sprint 5)
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_signals_type        ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_status      ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_event       ON signals(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_signals_published   ON signals(published_at DESC);

-- +migrate down
DROP TABLE IF EXISTS signals;
