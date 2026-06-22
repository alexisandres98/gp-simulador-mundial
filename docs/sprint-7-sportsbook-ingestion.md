# Sprint 7 — Ingesta de sportsbooks

`value-engine/sportsbookProvider.js`. **Interfaz provider-agnostic** (`discoverEvents/fetchMarkets/fetchQuotes/normalize*/health`).
HOY: **`noneProvider`** (no hay proveedor autorizado conectado → `health: unavailable`). `manualProvider` carga cuotas desde un payload documentado (tests/admin) separando `data_provider` vs `sportsbook` vs `operator_group` vs `independence_group` (§6-7). **Nunca scraping no autorizado.**

## Almacenamiento (§8)
Tabla **`sportsbook_quotes`** (no se fuerza una cuota dentro de un esquema de order book; la semántica difiere). Campos: provider_id, sportsbook_code, operator_group, independence_group, source_role, external_* / canonical_* ids, market_family, period, is_live, odds_format, odds_decimal NUMERIC, implied_probability, quote_status, quote_timestamp, received_at, source_url, deep_link, maximum_stake (null si el proveedor no da límites → `stake_limit_status=unknown`), currency, normalizer_version, raw_snapshot_id, metadata. + `sportsbook_ingestion_runs`.

## Decisión documentada
Se reutiliza la infraestructura de Sprint 1 (ingestion runs, freshness) en patrón, pero con tabla propia por la semántica distinta (cuota 1X2 vs order book). Un agregador (p.ej. The Odds API) se modela como `data_provider` con N `sportsbook` separados, no como un solo book.
