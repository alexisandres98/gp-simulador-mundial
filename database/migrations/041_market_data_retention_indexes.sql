-- 041 — Índices created_at para la retención de telemetría shadow (market-data). Tras el incidente jun-28
-- (DB 14GB), se añade poda periódica por antigüedad (market-data/retention.js). Estos índices hacen que el
-- DELETE ... WHERE created_at < cutoff use index scan en vez de seq scan sobre tablas grandes. created_at es
-- monótono (append) → el índice es barato de mantener. arb_evaluations ya tiene su índice (mig 040).
-- Idempotente (IF NOT EXISTS). Aditiva y reversible. Las tablas están vacías al aplicar → build instantáneo.

-- +migrate up
CREATE INDEX IF NOT EXISTS idx_raw_market_snap_created_at ON raw_market_snapshots (created_at);
CREATE INDEX IF NOT EXISTS idx_norm_market_snap_created_at ON normalized_market_snapshots (created_at);

-- +migrate down
DROP INDEX IF EXISTS idx_raw_market_snap_created_at;
DROP INDEX IF EXISTS idx_norm_market_snap_created_at;
