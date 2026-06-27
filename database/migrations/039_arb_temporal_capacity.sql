-- 039 — Fase R.2: evidencia de contemporaneidad temporal (§9) + capacidad ejecutable honesta (§7/§11) por
-- evaluación de arbitraje. ADITIVA, reversible, segura (nullable, sin backfill). temporal_ok=false → alguna leg
-- stale/derivada-stale/suspendida o evento iniciado (la combinación nunca coexistió → no activa). capacity_status
-- UNKNOWN/CONSERVATIVE → no se inventa capacidad (R.3 baja a THEORETICAL_ONLY/PARTIAL). El JSONB guarda la
-- evidencia completa (oldest/newest/cross_leg_spread/per_leg). No toca tablas oficiales ni Value/Picks.

-- +migrate up
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS temporal_ok BOOLEAN;
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS capacity_status TEXT;
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS confirmed_executable_size NUMERIC(28,8);
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS temporal_capacity JSONB NOT NULL DEFAULT '{}'::jsonb;

-- +migrate down
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS temporal_ok;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS capacity_status;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS confirmed_executable_size;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS temporal_capacity;
