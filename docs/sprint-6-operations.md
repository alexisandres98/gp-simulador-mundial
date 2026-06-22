# Sprint 6 — Operación

## CLI
```bash
npm run metrics:status        # flags, conteos de facts, runs recientes
npm run metrics:once          # run incremental
npm run metrics:rebuild [--epoch=...]   # full rebuild
npm run metrics:verify        # invariantes de integridad (exit 1 si falla)
npm run metrics:publish       # congela un public_metric_snapshot
npm run metrics:exclusions    # facts excluidos + razón
```
Contra Render: prefijar `DATABASE_URL=<externo> DB_SSL=true`.

## Runs y scheduler
- `metric_runs` registra cada ejecución (incremental/full_rebuild/correction_rebuild/dry_run; running/success/partial/failed). Detecta abandonadas.
- Scheduler (`METRICS_ENGINE_SCHEDULER_ENABLED`, intervalo `METRICS_ENGINE_INTERVAL_MS`) recalcula incremental con **advisory lock `metrics-engine:run`** (anti-solape). No corre sin cambios útiles.

## Reconstrucción ante correcciones (§27)
Settlement corregido / disputed / closing añadido / correction event → recalcular facts y agregados (idempotentes). **No se modifica la señal**; los snapshots públicos previos **permanecen** (se crea uno nuevo al publicar).

## Verify (§37)
Comprueba: 0 experimental/legacy en oficial, 0 ROI arb realizado, reproducibilidad de agregados (idempotency_key), no look-ahead en closing.

## Performance (§50)
10.000 señales: insert ~1.1s, settle ~0.2s, **rebuild métricas (10.041 facts) ~7s**, **verificación de cadena Sprint 5 (10.041) ~3s**. No bloquea el servidor principal (lock + corre como job).
