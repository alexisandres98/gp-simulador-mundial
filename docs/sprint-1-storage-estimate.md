# Sprint 1 — Estimación de almacenamiento

> Cálculo del crecimiento ANTES de activar producción. Conclusión: los **order book levels** dominan;
> con la config por defecto aplicada a todo el universo el crecimiento es alto → se recomienda **tunear**
> (menos niveles, books solo en mercados activos, intervalos más largos para mercados de larga duración)
> antes de la activación completa. No se implementa particionamiento aún (solo se documenta).

## Rendimiento de inserción (medido, fixtures)
Prueba de volumen (`tests/market-data-db.test.js`): **400 snapshots normalizados + 16.000 niveles de
order book en ~1,1 s** contra PostgreSQL 18.4. La inserción **no** es el cuello de botella; el reto es
el **volumen acumulado**. La query de timeline `(provider_id, external_market_id, received_at)` usa el
índice (`EXPLAIN` confirma Index Scan, no Seq Scan).

## Bytes por fila (estimado, incl. overhead + índices de Postgres)
| Tabla | ~bytes/fila |
|---|---|
| raw_market_snapshots (mercado) | ~1,0 KB |
| raw_market_snapshots (book) | ~0,9 KB |
| normalized_market_snapshots | ~0,75 KB |
| normalized_orderbook_levels | ~0,3 KB |

## Variables
```
mercados × snapshots/día × (raw + normalized) + mercados × snapshots/día × niveles_por_snapshot
snapshots/día @30s = 2.880   ·   niveles_por_snapshot = 2 × MAX_LEVELS
```

## Escenario A — config por defecto a TODO el universo (NO recomendado)
~150 mercados/outcomes, 30 s, 20 niveles/lado (40/snapshot), book en todos:
| Periodo | normalized | raw (mkt+book) | orderbook levels | **Total** |
|---|---|---|---|---|
| 24 h | ~0,32 GB | ~0,82 GB | ~5,2 GB (17,3 M filas) | **~6,3 GB** |
| 7 d | ~2,3 GB | ~5,7 GB | ~36 GB | **~44 GB** |
| 30 d | ~9,7 GB | ~25 GB | ~155 GB | **~190 GB** |
| 365 d | ~118 GB | ~300 GB | ~1,9 TB | **~2,3 TB** |

→ Inviable a largo plazo sin retención/particionamiento. Los niveles del book son el 80%.

## Escenario B — RECOMENDADO (tuneado para el rollout)
Snapshots de precio en ~150 mercados @30s, pero **order books solo en ~20 mercados activos** con **10
niveles/lado** (20/snapshot):
| Periodo | normalized | raw | orderbook levels | **Total** |
|---|---|---|---|---|
| 24 h | ~0,32 GB | ~0,47 GB | ~0,35 GB (1,15 M) | **~1,1 GB** |
| 7 d | ~2,3 GB | ~3,3 GB | ~2,4 GB | **~8 GB** |
| 30 d | ~9,7 GB | ~14 GB | ~10 GB | **~34 GB** |
| 365 d | ~118 GB | ~170 GB | ~126 GB | **~410 GB** |

→ Manejable a corto/medio plazo; aún requiere política de retención antes de 1 año.

## Palancas de control (ya disponibles por configuración)
- `MARKET_DATA_ORDERBOOK_MAX_LEVELS` (default 20 → bajar a 10).
- Intervalos por proveedor / live / long-dated (`*_INTERVAL_MS`): subir el de mercados de larga duración (campeón).
- Order books **solo** en mercados activos/líquidos (no en 48 longshots del campeón cada 30 s).
- Flags por proveedor para activar gradualmente.

## Cuándo considerar (estrategia futura — NO implementada en Sprint 1)
- **Particionamiento temporal mensual** de `raw_market_snapshots` y `normalized_orderbook_levels`
  (purga por `DROP PARTITION`, barata).
- **Retención**: conservar normalized; downsamplear/archivar raw y niveles viejos.
- **Compresión/archivado** de particiones frías.
- **Downsampling**: del histórico fino a velas/agregados por minuto para análisis de largo plazo.

Disparadores sugeridos: revisar al llegar a ~20–30 GB o ~30 días de datos reales, lo que ocurra antes.
