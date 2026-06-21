# Sprint 0 — Políticas de datos

> Reglas de conservación, inmutabilidad, timestamps, frescura y tratamiento de precios para la nueva
> plataforma. Definidas en Sprint 0; los thresholds finales y la aplicación efectiva llegan con los
> collectors (Sprint 1+). Todo lo configurable se expone vía variables de entorno.

## 1. Raw data
- Se conserva el **payload original exacto** (`raw_market_snapshots.payload`, JSONB).
- **Inmutable** tras insertarse: no se modifica el contenido original.
- Se permite **añadir metadatos** (columna `metadata`), nunca reescribir el payload.
- **Retención configurable.** Default documentado: **365 días** (`RAW_RETENTION_DAYS=365`), sujeto a
  costes de almacenamiento futuros. La purga real se implementa más adelante (job de mantenimiento).

## 2. Normalized data
- Se conserva **históricamente**: cada normalización es un registro nuevo, **no** sobrescribe los
  anteriores (`normalized_market_snapshots` es append-only).
- Cada registro incluye `normalizer_version` para poder reinterpretarlo.
- Apunta a su `raw_snapshot_id` de origen (trazabilidad raw↔normalized).

## 3. Signals (Sprint 5, scaffolding aquí)
- Serán **inmutables**: una vez publicada, una señal no se edita.
- Una corrección genera una **nueva versión** o un evento de corrección referenciado, nunca una
  edición silenciosa.
- **Nunca** se borra una pérdida ni un resultado adverso: el historial es completo y honesto (es la
  base de la credibilidad del track record).

## 4. Timestamps (cuatro distintos, jamás se mezclan)
| Campo | Significado |
|---|---|
| `provider_timestamp` | cuándo el **proveedor** dice que el dato es válido (si lo aporta) |
| `received_at` | cuándo **nuestro adapter** recibió la respuesta |
| `processed_at` | cuándo se **normalizó/procesó** (capa de normalización) |
| `created_at` | cuándo se **insertó la fila** en la base de datos |

Regla: **nunca se reemplaza un timestamp por otro.** Si falta el `provider_timestamp`, queda `NULL`
(no se rellena con `received_at`). Esto resuelve el riesgo R2 de la auditoría.

## 5. Datos stale (frescura)
Estados conceptuales (los umbrales finales por deporte se definen en sprints siguientes; aquí solo la
política y su configurabilidad):

| Estado | Significado |
|---|---|
| `fresh` | dentro de la ventana esperada para ese mercado/deporte |
| `aging` | más viejo de lo ideal, aún utilizable con advertencia |
| `stale` | demasiado viejo para decidir; no debe presentarse como vigente |
| `unknown` | sin `provider_timestamp` ni base para evaluar frescura |

Configurable vía entorno (defaults orientativos, no finales):
`FRESHNESS_AGING_MS`, `FRESHNESS_STALE_MS`. Resuelve el riesgo R3 (stale silencioso): un dato viejo
nunca se mostrará como fresco sin marca.

## 6. Precios (nunca se confunden entre sí)
Cuatro magnitudes **distintas**, almacenadas por separado en `NUMERIC(20,8)` (no FLOAT):

| Campo | Qué es |
|---|---|
| `last_trade` | precio de la **última operación** ejecutada |
| `best_bid` | mejor precio de **compra** disponible |
| `best_ask` | mejor precio de **venta** disponible |
| `midpoint` | punto medio `(best_bid + best_ask) / 2` — **derivado**, no un precio real de mercado |

- `spread = best_ask − best_bid`.
- **Nunca** se trata `last_trade`, `midpoint`, `best_bid` o `best_ask` como el mismo valor (el código
  actual usa `price` como proxy de varios — riesgo R7; la nueva capa los separa).
- Todo en `NUMERIC` para evitar pérdida de precisión en dinero y probabilidades (riesgo R7).

## 7. Auditoría de ingesta
Cada ejecución de un collector futuro registra una fila en `ingestion_runs`
(`records_received/written/rejected`, `error_count`, `error_summary`, duración). Resuelve el riesgo R9
(sin auditoría). En Sprint 0 la tabla existe; los collectors que la llenan son Sprint 1.

## 8. Observaciones temporales y checksum (Sprint 0.1)
- **Cada observación es válida** aunque el contenido se repita: 4 lecturas del mismo order book en
  4 momentos = 4 filas (distinto `id`/`received_at`). **No hay `UNIQUE(checksum)`** (perdería datos).
- El `checksum` (`database/checksum.js`) es un hash determinístico del **contenido** (claves
  ordenadas), que **excluye** `received_at`/`fetched_at`/`processed_at`/`created_at`,
  `request_latency_ms` y cualquier secreto/token/header. Sirve para *detectar contenido idéntico*,
  no para borrar observaciones.
- Permite medir luego: cuánto duró un precio, cuántas veces se confirmó, cuándo desapareció.

## 9. Índices (Sprint 0.1) — qué acelera cada uno
| Índice | Tabla | Consulta que acelera | ¿Sprint 1? |
|---|---|---|---|
| `idx_raw_market_timeline (provider_id, external_market_id, external_outcome_id, received_at DESC)` | raw | timeline de un mercado/outcome ("¿cuánto duró el precio?"); por prefijo cubre filtros provider+market | **sí** |
| `idx_raw_received_at` | raw | barridos globales por tiempo / retención | sí |
| `idx_raw_provider_ts` | raw | ordenar por timestamp del proveedor | medio |
| `idx_raw_checksum` | raw | detectar contenido idéntico | medio |
| `idx_raw_ingestion_run` | raw | auditar lo escrito por una ejecución | sí |
| `idx_norm_market_timeline` | normalized | timeline normalizado por mercado/outcome | **sí** |
| `idx_norm_received_at`, `idx_norm_provider_ts`, `idx_norm_raw` | normalized | tiempo / timestamp proveedor / trazabilidad a raw | medio |
| mappings/canónicos: `*_canonical`, `*_status`, `uq_*` | varias | resolución de equivalencias y unicidad | Sprint 2 |

> Se **eliminaron** los índices 2-columnas `(provider_id, external_market_id)` de raw/normalized por
> ser **redundantes** con el prefijo del índice de timeline (migración 005). No hay índices duplicados.

## 10. Retención / particionamiento / archivado (estrategia futura — NO implementada aún)
Antes de almacenar millones de snapshots (Sprint 1+), se evaluará:
- **Particionamiento temporal** de `raw_market_snapshots` y `normalized_market_snapshots` por rango de
  `received_at` (p.ej. mensual) para que la purga sea `DROP PARTITION` (barata) en vez de `DELETE`.
- **Retención**: `RAW_RETENTION_DAYS=365` configurable; job de mantenimiento que purga/archiva
  particiones vencidas. Lo normalizado puede retenerse más (es más compacto y valioso).
- **Compresión/archivado**: exportar particiones frías a almacenamiento barato (p.ej. dump comprimido)
  antes de purgar, si el dato sigue teniendo valor para backtesting.
- **No se implementa en Sprint 0.1**: solo queda documentado y el esquema preparado (timestamps e
  índices adecuados para particionar después sin reescribir).
