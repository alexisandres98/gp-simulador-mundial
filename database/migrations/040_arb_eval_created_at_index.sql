-- 040 — Fase Q.1.1 §1: formaliza el índice idx_arb_eval_created_at en arb_evaluations(created_at DESC).
-- CONTEXTO: el índice ya fue creado en producción con CREATE INDEX CONCURRENTLY (no bloqueante) para acelerar
-- las queries de ventana del Observatory de arbitraje (admin), que filtran por created_at sobre una tabla de
-- alto volumen (~1.37M filas y creciendo). Esta migración lo FORMALIZA en el control de versiones.
-- POR QUÉ NO CONCURRENTLY AQUÍ: el runner ejecuta cada migración dentro de una transacción (BEGIN/COMMIT) y
-- CREATE INDEX CONCURRENTLY no puede correr en una transacción. Se usa CREATE INDEX IF NOT EXISTS, que es:
--   · en PRODUCCIÓN → no-op instantáneo (el índice ya existe; no re-escanea ni bloquea la tabla grande);
--   · en entornos FRESCOS → arb_evaluations está vacía, así que el build no-concurrente es trivial y sin lock real.
-- No crea un índice duplicado (mismo nombre y definición que el existente). Aditiva y reversible.

-- +migrate up
CREATE INDEX IF NOT EXISTS idx_arb_eval_created_at ON arb_evaluations (created_at DESC);

-- +migrate down
DROP INDEX IF EXISTS idx_arb_eval_created_at;
