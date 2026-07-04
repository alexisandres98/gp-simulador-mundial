-- 042 — Ensancha las columnas de score del matcher canónico. Eran NUMERIC(6,4) (máx 99.9999) y los matches
-- PERFECTOS de eventos nuevos puntúan 100.0000 → desde el 26-jun TODOS los INSERT a mapping_review_queue y
-- mapping_decision_history fallaban con "numeric field overflow" (22003) — los candidatos nuevos (R16+) nunca
-- entraban a la cola canónica y el Value engine se quedó sin eventos nuevos que evaluar. Detectado por el log
-- "db: error de datos (no transitorio)" añadido el 3-jul. Se ensancha también equivalence_score de los
-- mappings por si el matcher escribe escala 0-100 en el futuro (hoy 0-1; el cambio es inocuo).
-- Subir precisión con la misma escala NO reescribe la tabla (metadata-only en PG >= 9.2). Reversible.

-- +migrate up
ALTER TABLE mapping_review_queue      ALTER COLUMN score           TYPE NUMERIC(8,4);
ALTER TABLE mapping_decision_history  ALTER COLUMN previous_score  TYPE NUMERIC(8,4);
ALTER TABLE mapping_decision_history  ALTER COLUMN new_score       TYPE NUMERIC(8,4);
ALTER TABLE provider_event_mappings   ALTER COLUMN equivalence_score TYPE NUMERIC(8,4);
ALTER TABLE provider_market_mappings  ALTER COLUMN equivalence_score TYPE NUMERIC(8,4);
ALTER TABLE provider_outcome_mappings ALTER COLUMN equivalence_score TYPE NUMERIC(8,4);

-- +migrate down
-- Volver a (6,4) exigiría que no existan valores >= 100 (fallaría con los scores nuevos). Se baja solo si
-- se limpian antes; el down existe para simetría del framework.
ALTER TABLE mapping_review_queue      ALTER COLUMN score           TYPE NUMERIC(6,4);
ALTER TABLE mapping_decision_history  ALTER COLUMN previous_score  TYPE NUMERIC(6,4);
ALTER TABLE mapping_decision_history  ALTER COLUMN new_score       TYPE NUMERIC(6,4);
ALTER TABLE provider_event_mappings   ALTER COLUMN equivalence_score TYPE NUMERIC(6,4);
ALTER TABLE provider_market_mappings  ALTER COLUMN equivalence_score TYPE NUMERIC(6,4);
ALTER TABLE provider_outcome_mappings ALTER COLUMN equivalence_score TYPE NUMERIC(6,4);
