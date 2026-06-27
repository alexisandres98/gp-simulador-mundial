-- 038 — Fase R.1: evidencia del gate semántico de arbitraje. ADITIVA, reversible, segura (columnas nullable,
-- sin backfill). Persiste el veredicto del semanticGate por evaluación: si la cobertura es exhaustiva + reglas
-- de settlement idénticas/no-ambiguas. Un mismatch PROBADO (semantic_fatal) degrada a rejected en el motor;
-- la capa de producto exige semantic_ok=true (sin ambigüedad) antes de mostrar una oportunidad como ejecutable.
-- No toca tablas oficiales ni la lógica de modelo/Value/Picks.

-- +migrate up
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS semantic_ok BOOLEAN;
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS semantic_fatal BOOLEAN;
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS semantic_sub_reason TEXT;
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS semantic_policy_version TEXT;
ALTER TABLE arb_evaluations ADD COLUMN IF NOT EXISTS semantic_blockers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +migrate down
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS semantic_ok;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS semantic_fatal;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS semantic_sub_reason;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS semantic_policy_version;
ALTER TABLE arb_evaluations DROP COLUMN IF EXISTS semantic_blockers;
