# Sprint 6 — Despliegue (por fases, gated)

**No desplegar al terminar.** Código inerte; reporte primero.

## Flags (default `false`)
```
METRICS_ENGINE_ENABLED
METRICS_ENGINE_WRITE_ENABLED
METRICS_ENGINE_SCHEDULER_ENABLED
METRICS_PUBLIC_ENABLED
METRICS_ADMIN_PREVIEW_ENABLED
METRICS_EXPERIMENTAL_ENABLED
METRICS_SIMULATED_RETURNS_ENABLED   ← apagado hasta política válida de señales con precio
```
Parámetros: `METRICS_LOG_LOSS_EPSILON`, `METRICS_BOOTSTRAP_ITERATIONS/SEED`, `METRICS_SAMPLE_*_MAX`, `METRICS_CALIBRATION_BUCKETS`, `METRICS_ENGINE_INTERVAL_MS`.

## Migración
`npm run db:migrate` aplica `014_metrics_engine.sql` (metric_definitions, metric_runs, signal_metric_facts, metric_aggregates, metric_calibration_bins, public_metric_snapshots). Rollback `db:rollback` (solo Sprint 6). Probado.

## Fases
1. **Inerte** (todo off) → página actual intacta, cero writes. Aplicar migración 014.
2. **Dry run** (`ENABLED=true`, `WRITE_ENABLED=false`) → valida y calcula, no persiste.
3. **Facts internos** (`WRITE_ENABLED=true`) → facts + agregados internos; revisar muestra/metodología.
4. **Admin preview** (`ADMIN_PREVIEW_ENABLED=true`) → dashboard solo admin.
5. **Snapshot público interno** → `metrics:publish`.
6. **Público beta** (`PUBLIC_ENABLED=true`) — solo tras: verified epoch configurado, settlements correctos, cadena válida, métricas verificadas, copy revisado, muestra claramente comunicada.

## Prerequisito de datos
Las métricas oficiales requieren **señales verificadas con settlement** (Sprint 5 con write on + epoch configurado). Hoy `signals=0` en prod → el motor está listo pero el track record se llena cuando se activen Sprints 5/6 y se publiquen/liquiden señales.

## Flujo
commit (Co-Authored-By) → push → Manual Deploy en Render. db.json intacto.
