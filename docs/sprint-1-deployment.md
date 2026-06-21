# Sprint 1 — Plan de despliegue escalonado

> NO se despliega al terminar el sprint. Tras aprobación, activar por fases observando cada una.
> Requiere la fundación de Sprint 0/0.1 desplegada y PostgreSQL activo con migraciones (incluida la 009).

## Prerrequisitos
- PostgreSQL en Render activo; `DATABASE_URL` + `DB_SSL=true` en el web service.
- Migraciones al día: `npm run db:migrate` (debe incluir `009`). `npm run db:status` → AL DÍA.
- Build con `npm ci` (pg instalado). `npm run platform:health` → connected/up_to_date.

## Fase 1 — Inicializar sin escribir
```env
MARKET_DATA_PLATFORM_V2=true
MARKET_DATA_WRITE_ENABLED=false
```
- Verificar que la capa inicializa, el scheduler **no** arranca, **cero writes**.
- `GET /api/internal/market-data-status` → `enabled:true, writeEnabled:false, schedulerRunning:false`.

## Fase 2 — Activar escritura SOLO Polymarket
```env
MARKET_DATA_WRITE_ENABLED=true
MARKET_DATA_POLYMARKET_ENABLED=true
MARKET_DATA_KALSHI_ENABLED=false
```
- Observar **30–60 min**: runs (success/partial), errores, latencia, crecimiento, locks, freshness, health.
- Recomendado tunear antes: `MARKET_DATA_ORDERBOOK_MAX_LEVELS=10`, intervalos según rate limits
  (ver storage-estimate). Order books solo en mercados activos.

## Fase 3 — Activar Kalshi
```env
MARKET_DATA_KALSHI_ENABLED=true
```
- Misma observación de 30–60 min.

## Fase 4 — Shadow mode ≥ 24 h
- Mantener ambos en shadow mode al menos 24 h. **No** cambiar frontend ni oportunidades públicas.
- Vigilar almacenamiento contra la estimación; ajustar palancas si crece más rápido de lo previsto.

## Flags por proveedor (resumen)
```env
MARKET_DATA_POLYMARKET_ENABLED=false
MARKET_DATA_KALSHI_ENABLED=false
```
Ambos requieren `PLATFORM_V2=true` **y** `WRITE_ENABLED=true` para escribir.

## Rollback
- Apagar el flag del proveedor (o `WRITE_ENABLED`) → ingesta detenida, app intacta.
- Si se requiere revertir esquema: `npm run db:rollback` (009). No toca `db.json` ni el flujo legacy.

## Build command en Render
- Cambiar a `npm ci` (instala `pg`). **No** se modifica `render.yaml` desde el repo (está desincronizado
  con el plan real); el cambio se hace en el dashboard. La app arranca igual aunque `pg` no esté
  instalado y los flags estén apagados (carga perezosa de `pg`).
