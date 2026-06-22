# Sprint 5 — Despliegue (por fases, gated)

**No desplegar al terminar.** Código inerte; entregar reporte primero.

## Feature flags (todos default `false`)
```
SIGNAL_REGISTRY_ENABLED
SIGNAL_REGISTRY_WRITE_ENABLED
SIGNAL_REGISTRY_PUBLIC_ENABLED
SIGNAL_REGISTRY_AUTO_MODEL_CAPTURE_ENABLED
SIGNAL_REGISTRY_AUTO_ARB_CAPTURE_ENABLED
SIGNAL_REGISTRY_EXPERIMENT_CAPTURE_ENABLED
SIGNAL_CLOSING_CAPTURE_ENABLED
SIGNAL_SETTLEMENT_ENABLED
```
Otros: `SIGNAL_REGISTRY_VERIFIED_EPOCH` (se setea al activar; no backdatear),
`SIGNAL_CLOSING_CAPTURE_INTERVAL_MS`, `SIGNAL_CLOSING_MAX_PRESTART_WINDOW_MS`, `SIGNAL_SETTLEMENT_INTERVAL_MS`.

## Migración
`npm run db:migrate` aplica `013_signal_registry.sql` (evoluciona `signals` + 6 tablas + triggers de inmutabilidad).
Rollback: `npm run db:rollback` (elimina solo lo de Sprint 5; restaura `signals` a su estado previo). Probado.

## Fases
1. **Inerte** (todo off) → app idéntica, sin rutas nuevas. Aplicar migración 013.
2. **Dry run** (`ENABLED=true`, `WRITE_ENABLED=false`) → valida y calcula hash, no persiste.
3. **Escritura manual** (`WRITE_ENABLED=true`) → setear `VERIFIED_EPOCH`; crear señales de prueba controladas; `verify-chain`.
4. **Integración Sprint 4** (`AUTO_ARB_CAPTURE_ENABLED=true`) → solo con publicaciones manuales internas.
5. **Predicciones oficiales V1** → publicar un conjunto limitado vía admin.
6. **Closing y settlement** → activar `SIGNAL_CLOSING_CAPTURE_ENABLED` y `SIGNAL_SETTLEMENT_ENABLED` uno a uno.
7. **Registro público beta** (`PUBLIC_ENABLED=true`) → solo tras verificar cadena, settlements y copy.

## Prerequisito de contenido real
Las señales arb dependen de que el motor (Sprints 2-3) produzca evaluaciones reales; hoy el matching canónico está
bloqueado (rules/participantes — ver pendiente Sprint 2). Las predicciones V1 manuales no dependen de eso.

## Flujo
commit (Co-Authored-By) → push → Manual Deploy en Render. db.json intacto, usuarios preservados.
