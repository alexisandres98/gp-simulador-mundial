# Sportsbook — Batch Ingestion (Bloque A)

**Problema (R1):** `insertQuotes` insertaba fila a fila (N+1) → ~3 min por run de ~3000 cuotas → el job
(timeout 60s) se marcaba `timed_out`, reintentaba, y corría ingestas solapadas.

**Solución:** `sportsbook-providers/persistence.js#persistCurrentBatch(rows, runId)`.
- Upsert **set-based** vía `jsonb_to_recordset` (una sola sentencia por lote, sin placeholders → sin límite de
  parámetros de Postgres). Lotes de `CHUNK=1000` filas, **una transacción por lote** (`db.withTransaction`),
  rollback consistente.
- **Happy path = sin N+1.** En caso de error de un lote: ROLLBACK + reintento **fila a fila** SOLO para aislar
  la fila culpable (errores sanitizados, sin valores crudos ni secrets); el resto del lote se preserva.
- Métricas devueltas: `{ received, validated, inserted, updated, unchanged, rejected, history_written, errors[] }`.
  `inserted` viene de `RETURNING (xmax = 0)`; `updated`/`unchanged` se derivan de la history escrita por el trigger.

**Rendimiento medido (embedded-postgres, local):** **3000 cuotas → 327 ms** (inserción); replay idéntico → 256 ms,
**0 nuevas filas de history**. Objetivo `< 10 s` ampliamente cumplido. *No es rendimiento de producción* (red +
DB remota difieren); se re-medirá p50/p95 en el 2º shadow.

**Cableado:** `ingestion.js` llama `persistCurrentBatch` por competición. La escritura del raw legacy
(`sportsbook_quotes`, snapshots completos) queda **desactivada por defecto** tras `SPORTSBOOK_RAW_LEGACY_WRITE_ENABLED`
(era la causa del bloat de ~70 MB/día). Tests: `tests/post-shadow-ingestion-db.test.js` (23/23).
