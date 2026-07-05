-- 043 — Índice por canonical_event_id en sportsbook_goal_quote_current.
-- CONTEXTO: buildDailyPicks (picks diarias) y evaluateGoalPicks (picks de goles shadow) contaban casas con un
-- subquery correlacionado `WHERE canonical_event_id=X [AND market_family=...]` sobre esta tabla, que creció a
-- ~400K filas SIN índice por canonical_event_id (solo existía por external_event_id) → full scan por fila del
-- query externo → statement timeout (30s) → EL MOTOR DE PICKS ESTUVO MUDO del 1-jul 03:28 al 5-jul (todas las
-- corridas fallaban; el feed quedó congelado con las últimas picks publicadas). El índice ya fue creado en
-- producción el 5-jul con CREATE INDEX CONCURRENTLY (no bloqueante, 2.5s, indisvalid=true); esta migración lo
-- FORMALIZA en el control de versiones (mismo patrón que la 040).
-- POR QUÉ NO CONCURRENTLY AQUÍ: el runner ejecuta cada migración en transacción y CONCURRENTLY no puede.
-- IF NOT EXISTS → no-op en producción; en entornos frescos la tabla está vacía y el build es trivial.

-- +migrate up
CREATE INDEX IF NOT EXISTS idx_sbgoal_canon_family_book ON sportsbook_goal_quote_current (canonical_event_id, market_family, sportsbook_code);

-- +migrate down
DROP INDEX IF EXISTS idx_sbgoal_canon_family_book;
