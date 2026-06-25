# Sportsbook — Current State + History (Bloque B)

Reemplaza la única tabla de snapshots completos (`sportsbook_quotes`, raw legacy) por **dos representaciones**
(mig 021, aditivas — no tocan las 283k filas existentes):

## `sportsbook_quote_current` — estado actual
Una fila por identidad natural con el **último estado conocido**. Permite leer rápido: mejor precio actual,
set 1X2 actual, freshness, suspended/open, `provider_update`, `observed_at`. Campos de procedencia:
`observation_count`, `first_seen_at`, `last_changed_at`, `last_ingestion_run_id`. Enlace canónico
(`canonical_event_id/market_id/outcome_id`) que llena el Bloque G; null hasta matchear.

## `sportsbook_quote_history` — historia material
Append-only. El trigger `sbq_write_history` inserta una fila SOLO ante cambio **material**: precio,
disponibilidad (live), o estado (open/suspended), o `new` al aparecer. Un nuevo `provider_update` sin cambio
de precio/estado **no** genera history. Guarda `prev_odds_decimal/prev_quote_status/prev_provider_update` para
auditar el cambio. Índices por identidad+`observed_at` y por evento.

## No destruir todavía el raw legacy
Las 283k filas de `sportsbook_quotes` se **conservan**. Procedimiento reversible (ver
[retención](sportsbook-retention.md)): auditar → backup/estrategia reversible → migrar/compactar
determinístico → validar conteos → conservar ventana segura → recién entonces proponer eliminación.

Tests: `tests/post-shadow-ingestion-db.test.js` (current/history/trigger), `tests/post-shadow-ops-db.test.js` (retención).
