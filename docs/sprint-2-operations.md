# Sprint 2 — Operaciones

> Operar el Canonical Event Graph sin afectar el producto actual. Shadow mode; gated por flags.

## Flags
```
CANONICAL_GRAPH_ENABLED=false       # inicializa la capa (dry-run/análisis)
CANONICAL_GRAPH_WRITE_ENABLED=false # permite escribir (review queue / mappings)
CANONICAL_AUTO_MATCH_ENABLED=false  # solo equivalencias muy claras se auto-aprueban
```
Validación: write requiere graph; auto-match requiere graph+write. Combinaciones inválidas se neutralizan
y se reportan en `status` (`configurationValid:false`, `warning`).

## CLI
```
npm run canonical:discover        # genera candidatos y los analiza (dry-run, no escribe)
npm run canonical:match           # evalúa y persiste (si write on; auto-match decide qué se aprueba)
npm run canonical:match -- --provider-a=polymarket --provider-b=kalshi
npm run canonical:status          # conteos + métricas (no escribe)
npm run canonical:verify          # integridad (matched con conflicto, sin canónico, sin versión, alias ambiguos...)
npm run canonical:review-summary  # cola de revisión pendiente
```

## Endpoints admin
`GET /api/internal/canonical/status` · `.../review` · `.../review/:id` · `POST .../review/:id/decision`.

## Datos de entrada
Lee del histórico de Sprint 1 (`raw_market_snapshots`, `provider_market_catalog`). NO vuelve a llamar
APIs si las reglas ya están almacenadas. (Sprint 1 está inerte en prod → activar primero la ingesta.)

## Seguridad / aislamiento
- Sin `DATABASE_URL` o flags off → inerte; el producto actual no cambia.
- Un fallo de DB o del grafo NO rompe la app (persistencia best-effort).
- Sin secrets en DB ni logs. Endpoints admin-only, parametrizados, paginados.

## Rollback
Apagar flags → inerte. Revertir esquema: `npm run db:rollback` (010). No toca datos de Sprint 1 ni db.json.
