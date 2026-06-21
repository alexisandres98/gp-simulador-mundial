# Sprint 1 — Operaciones

> Cómo operar la ingesta de mercado sin afectar la app actual. Todo gated por flags; shadow mode.

## Activar / desactivar collectors
- **Apagar todo (default):** `MARKET_DATA_PLATFORM_V2=false` o `MARKET_DATA_WRITE_ENABLED=false`.
  No se inicializa el scheduler; cero polls; cero writes; la app funciona igual.
- **Inicializar sin escribir (dry-run/health):** `MARKET_DATA_PLATFORM_V2=true`, `WRITE=false`.
- **Ingesta en shadow mode:** `PLATFORM_V2=true` + `WRITE=true` + flag por proveedor
  (`MARKET_DATA_POLYMARKET_ENABLED=true` / `MARKET_DATA_KALSHI_ENABLED=true`).

## Ejecutar una vez (sin scheduler permanente)
```bash
npm run market-data:once -- --provider=polymarket
npm run market-data:once -- --provider=kalshi
npm run market-data:once -- --provider=polymarket --force   # ignora flags (uso puntual de prueba)
```

## Revisar estado
```bash
npm run market-data:status          # runs recientes, conteos, mercados rastreados (no escribe)
```
HTTP (admin): `GET /api/internal/market-data-status` → scheduler, por proveedor (lastRun, latencia,
errorRate, freshness, snapshots última hora) y conteos de almacenamiento. **No ejecuta ingesta.**

## Revisar runs fallidas
```bash
npm run market-data:status          # muestra status de las últimas runs
npm run market-data:verify          # integridad: huérfanos, negativos, bid>ask, runs abandonadas, etc.
```
- Las `ingestion_runs` que quedaron `running` tras un crash se marcan `failed` automáticamente al
  arrancar (reaper, umbral 15 min) y vía `verify`.

## Detener la ingesta
- Inmediato: poner el flag del proveedor (o `WRITE_ENABLED`) en `false` y reiniciar. El scheduler no
  arranca. (Los timers son `unref`, no bloquean el cierre.)

## Reaccionar ante 429 (rate limit)
- El cliente ya respeta `Retry-After` y hace backoff+jitter. Si persiste: subir los `*_INTERVAL_MS`,
  bajar `MARKET_DATA_ORDERBOOK_MAX_LEVELS`, o desactivar un proveedor temporalmente. Revisar
  `rateLimited`/`errorRate` en el status.

## Reaccionar ante DB caída
- La ingesta es best-effort: un fallo de PostgreSQL **no** rompe la app actual (el flujo legacy no
  depende de la nueva capa). Los ciclos fallan y se registran; al volver la DB, se reanudan. El health
  (`/api/internal/platform-health`) reporta `unavailable`.

## Medir almacenamiento
- `market-data:status` muestra conteos. Para tamaño en disco, consultar el panel de Render Postgres o
  `pg_total_relation_size` por tabla. Ver `sprint-1-storage-estimate.md` para proyecciones.

## Rollback sin afectar la app actual
- Apagar flags → la capa queda inerte (la app sigue igual).
- Revertir esquema (si hiciera falta): `npm run db:rollback` (revierte la última migración; 009 → quita
  catálogo y order book). No afecta a `db.json` ni al flujo legacy.
