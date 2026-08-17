-- 045 — el panel de créditos mentía (17-ago): `updated_at` se refresca por trigger en CADA upsert del
-- estado, pero los números de cuota (`requests_*`) se conservan por COALESCE cuando la pasada no trae
-- cabeceras de cuota (p.ej. todas las competiciones fallaron o vinieron de caché). Resultado medido: fecha
-- fresca con números viejos — exactamente lo que un panel de créditos no puede hacer. La corrección es una
-- marca de tiempo PROPIA de la cuota, que solo avanza cuando llegan números reales del proveedor.

-- +migrate up
ALTER TABLE sportsbook_provider_state
  ADD COLUMN IF NOT EXISTS quota_updated_at TIMESTAMPTZ;

-- la fila existente hereda su updated_at como mejor aproximación (una sola vez, solo si está vacía)
UPDATE sportsbook_provider_state SET quota_updated_at = updated_at WHERE quota_updated_at IS NULL;

-- +migrate down
ALTER TABLE sportsbook_provider_state DROP COLUMN IF EXISTS quota_updated_at;
