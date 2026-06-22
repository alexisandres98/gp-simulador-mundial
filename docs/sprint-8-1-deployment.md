# Sprint 8.1 — Despliegue (por fases, gated). No desplegar al terminar; reporte primero.

## Fase 1 — Inerte
Todos los `UI_*` off → UI byte-idéntica (verificado: 0 elementos nuevos, 0 errores consola).

## Fase 2 — Admin preview
`UI_ADMIN_PREVIEW_ENABLED=true` + áreas a probar → solo admins ven la nueva UI. Revisar screenshots reales.

## Fase 3 — Rendimiento
`UI_VERIFIED_PERFORMANCE_ENABLED=true` (público o tras preview). Legacy y verificable separados.

## Fase 4 — Etiquetas GP Intelligence
`UI_GP_INTELLIGENCE_LABELS_ENABLED=true`. V2 sigue protagonista.

## Fase 5 — Navegación
`UI_NAVIGATION_CLEANUP_ENABLED=true`. Más agrupado + Transparencia + avatar reducido.

## Fase 6 — Oportunidades (tabs)
`UI_OPPORTUNITY_TABS_ENABLED=true` SOLO cuando el backend correspondiente esté disponible
(picks/value públicos o admin preview) y los DTOs estén sanitizados. Con backends off, las sub-tabs
Picks/Value muestran estados de preparación (correcto), Arbitraje muestra arb real.

## Fase 7 — Alert defaults (PENDIENTE de implementar)
`UI_ALERT_DEFAULTS_V2_ENABLED=true` SOLO para usuarios nuevos/sin prefs.

## Fase 8 — Público gradual
admins → internos → 10–20 → 50 → todos. Para exponer al público, encender `UI_INTEGRATION_V2_ENABLED`.

## Master kill-switch
`UI_INTEGRATION_V2_ENABLED=false` (o cada área) revierte a la UI actual sin redeploy.
