# Sprint 4 — Despliegue (por fases, gated)

**No desplegar al terminar.** El código se entrega inerte; la publicación pública permanece apagada hasta cumplir
la condición de validación real (§4).

## Feature flags (todos default `false`)
```
EXEC_OPPORTUNITIES_UI_ENABLED
EXEC_OPPORTUNITIES_ADMIN_PREVIEW_ENABLED
EXEC_OPPORTUNITIES_PUBLIC_ENABLED
EXEC_OPPORTUNITIES_MANUAL_PUBLICATION_ENABLED
EXEC_OPPORTUNITIES_CALCULATOR_ENABLED
EXEC_OPPORTUNITIES_DEEP_LINKS_ENABLED
EXEC_OPPORTUNITIES_GEO_FILTER_ENABLED
```
Umbrales de publicación (conservadores): `EXEC_PUBLIC_MIN_NET_ROI=0.01`, `EXEC_PUBLIC_MIN_EXECUTABLE_CAPITAL=50`,
`EXEC_PUBLIC_MAX_EVALUATION_AGE_MS=120000`, `EXEC_PUBLIC_MAX_REVALIDATION_AGE_MS=30000`,
`EXEC_PUBLIC_CACHE_TTL_MS=5000`, `EXEC_PUBLIC_ALLOW_EXECUTION_SENSITIVE=false`.

## Migración
`npm run db:migrate` aplica `012_executable_publications.sql` (tablas: arb_publications, arb_publication_history,
provider_jurisdiction_rules, provider_deep_link_templates, executable_opportunity_events). Rollback: `npm run db:rollback`.

## Fases
1. **Código inerte** (todo off) → app idéntica, sin rutas nuevas. Aplicar migración 012.
2. **Admin preview** (`UI_ENABLED=true`, `ADMIN_PREVIEW_ENABLED=true`, público off) → solo admin ve la pestaña "Ejecutables".
3. **Publicaciones internas** (`MANUAL_PUBLICATION_ENABLED=true`, público off) → aprobar/publicar con visibilidad `internal`; probar revalidación, expiración, calculadora.
4. **Beta cerrada** (`PUBLIC_ENABLED=true`, visibilidad `beta`) → solo admins/allowlist/grupo de prueba.
5. **Público** (visibilidad `public`) — solo tras: 24–72h de validación real, **cero falsos Pure Arb materiales**,
   deep links verificados, reglas revisadas, copy legal revisado, jurisdicción configurada.

## Condición de validación real (§4) — prerequisito para Fase 5
Datos reales de Sprint 1 (✅ activo en Render), mappings reales aprobados de Sprint 2, evaluaciones reales de Sprint 3,
revisión manual de cada publicación inicial, ≥24h de shadow del motor, 0 falsos Pure Arb, fees conocidas, reglas
completas, freshness válida, deep links comprobados. **Sprints 2 y 3 siguen con flags apagados** → activarlos en orden
antes de poder publicar oportunidades reales.

## Flujo (mismo de Sprints previos)
commit (Co-Authored-By) → push → Manual Deploy en Render. db.json intacto, usuarios preservados.
