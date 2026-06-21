# Sprint 3 — Plan de despliegue escalonado

> NO desplegar al terminar. Requiere Sprint 0/1/2 + PostgreSQL + (idealmente) datos reales de Sprint 1/2.
> Migración `011` aplicada. No hay publicación pública (eso es Sprint 4).

## Fase 1 — Código inerte
`ARB_ENGINE_ENABLED=false` (+ write/scheduler/auto-publication false). App igual.

## Fase 2 — Dry run manual
`ARB_ENGINE_ENABLED=true` (write off). `npm run arb:once` → evalúa sin persistir. Revisar clasificación.

## Fase 3 — Persistencia manual
`ARB_ENGINE_WRITE_ENABLED=true` (scheduler off). `npm run arb:once` → persiste evaluaciones/oportunidades.

## Fase 4 — Scheduler shadow
`ARB_ENGINE_SCHEDULER_ENABLED=true`. Observar ≥ 24 h. Revisar manualmente TODOS los Pure Arb detectados.
`ALLOW_AUTO_PUBLICATION` permanece false (forzado). NO conectar a la UI.

## Fase 5
No existe publicación pública en Sprint 3. La conexión a la UI pertenece al Sprint 4.

## Rollback
Apagar flag → inerte. `npm run db:rollback` (011). Sin impacto en datos previos.
