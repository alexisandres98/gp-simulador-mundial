# Sprint 3 — Operaciones

> Operar el motor sin afectar el producto. Shadow mode; sin publicación; sin ejecución de órdenes.

## Flags
```
ARB_ENGINE_ENABLED=false              # inicializa (dry-run)
ARB_ENGINE_WRITE_ENABLED=false        # persiste evaluaciones/oportunidades
ARB_ENGINE_SCHEDULER_ENABLED=false    # loop shadow periódico
ARB_ENGINE_ALLOW_AUTO_PUBLICATION=false  # SIEMPRE false en Sprint 3 (forzado en código)
```

## CLI
```
npm run arb:once       # una evaluación (candidatos de DB) — dry-run si write off
npm run arb:status     # flags + conteos
npm run arb:verify     # integridad (pure_arb con mapping malo, ROI fuera de rango, legs huérfanos, runs abandonadas)
npm run arb:inspect -- --evaluation=<uuid>   # desglose de una evaluación
npm run arb:replay     # (requiere histórico de Sprint 1)
```

## Endpoints admin
`GET /api/internal/arb/status` · `/arb/opportunities` · `/arb/opportunities/:id` · `/arb/evaluations/:id` ·
`POST /arb/run-once`. Todos admin-only, paginados, parametrizados, sin secretos, sin ejecución de órdenes.

## Seguridad / aislamiento
- Sin DATABASE_URL o flags off → inerte. Un fallo de DB/motor NO rompe la app (best-effort).
- No ejecuta órdenes, no conecta cuentas, no guarda bankroll, no publica al usuario.
- Locks advisory `arb-engine-evaluate` (no dos runs simultáneas). Idempotencia por input_hash.

## Rollback
Apagar flags → inerte. `npm run db:rollback` revierte 011. No toca Sprint 0/1/2 ni db.json.
