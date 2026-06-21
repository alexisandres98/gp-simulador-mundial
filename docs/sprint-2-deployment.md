# Sprint 2 — Plan de despliegue escalonado

> NO desplegar al terminar. Requiere Sprint 0/0.1/1 desplegados + PostgreSQL activo + Sprint 1 ingiriendo
> (para tener catálogo/reglas reales que mapear). Migración `010` aplicada (`npm run db:migrate`).

## Fase 1 — Dry run
```
CANONICAL_GRAPH_ENABLED=true
CANONICAL_GRAPH_WRITE_ENABLED=false
CANONICAL_AUTO_MATCH_ENABLED=false
```
`npm run canonical:discover` → analizar candidatos SIN escribir. Revisar métricas/score.

## Fase 2 — Guardar candidatos (todo a revisión)
```
CANONICAL_GRAPH_WRITE_ENABLED=true   # auto-match sigue OFF
```
`npm run db:migrate` (seed de participantes) · `npm run canonical:match` → la cola se llena; nada se aprueba.

## Fase 3 — Revisión manual
Validar el golden dataset + muestras reales en `/api/internal/canonical/review`. Aprobar/rechazar/condicionar.

## Fase 4 — Auto-match limitado (solo tras aprobación)
```
CANONICAL_AUTO_MATCH_ENABLED=true
```
Inicialmente solo mercados muy claros (campeón / ganador simple), thresholds altos, 0 hard conflicts.
**Nunca** conectar estos mappings al arbitraje público todavía (eso es Sprint 3).

## Rollback
Apagar el flag → inerte. `npm run db:rollback` revierte `010` sin tocar Sprint 1 ni db.json.

## Render
`render.yaml` no se toca (desincronizado). El cambio de Build Command (`npm ci`) y las variables
`CANONICAL_*` se ponen en el dashboard. La app arranca igual con flags off (carga perezosa de pg).
