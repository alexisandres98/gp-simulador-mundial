-- 005 — Hardening de observaciones de snapshots (Sprint 0.1).
-- POLÍTICA: cada observación temporal es válida aunque el contenido (checksum) se repita.
--   17:42:00, 17:42:10, 17:42:20, 17:42:30 con el MISMO order book = 4 observaciones legítimas.
-- Por eso NO existe (ni se añade) UNIQUE(checksum): permitiría perder observaciones.
-- El checksum (índice no único, ya creado en 002) solo sirve para detectar contenido idéntico.
--
-- Índices: reemplazamos los índices (provider_id, external_market_id) por índices de TIMELINE
-- (provider_id, external_market_id, external_outcome_id, received_at DESC), que sirven a las
-- consultas de Sprint 1 ("¿cuánto tiempo estuvo disponible un precio / esta profundidad?") y
-- por prefijo cubren también los filtros (provider_id, external_market_id) → evita redundancia.

-- raw: índice de timeline por mercado/outcome
DROP INDEX IF EXISTS idx_raw_provider_market;
CREATE INDEX IF NOT EXISTS idx_raw_market_timeline
  ON raw_market_snapshots (provider_id, external_market_id, external_outcome_id, received_at DESC);

-- normalized: índice de timeline por mercado/outcome
DROP INDEX IF EXISTS idx_norm_provider_market;
CREATE INDEX IF NOT EXISTS idx_norm_market_timeline
  ON normalized_market_snapshots (provider_id, external_market_id, external_outcome_id, received_at DESC);

-- Documenta la semántica en el propio esquema (visible para quien inspeccione la DB).
COMMENT ON COLUMN raw_market_snapshots.checksum IS
  'Hash determinístico del contenido (sha256:...). NO único: múltiples observaciones del mismo contenido son válidas. Excluye received_at y secretos.';
COMMENT ON COLUMN raw_market_snapshots.received_at IS
  'Momento en que el adapter recibió el dato. Cada observación tiene el suyo: distingue observaciones de igual contenido.';

-- +migrate down
DROP INDEX IF EXISTS idx_raw_market_timeline;
CREATE INDEX IF NOT EXISTS idx_raw_provider_market ON raw_market_snapshots (provider_id, external_market_id);
DROP INDEX IF EXISTS idx_norm_market_timeline;
CREATE INDEX IF NOT EXISTS idx_norm_provider_market ON normalized_market_snapshots (provider_id, external_market_id);
COMMENT ON COLUMN raw_market_snapshots.checksum IS NULL;
COMMENT ON COLUMN raw_market_snapshots.received_at IS NULL;
