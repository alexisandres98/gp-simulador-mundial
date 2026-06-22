# Sprint 7 — Operación

## CLI
`npm run value:status | value:candidates | value:evaluations | value:inspect [--id=] | value:verify`.
(value:once/replay y sportsbook:* requieren un feed real de sportsbooks, hoy ausente.)

## Schedulers (§52, gated)
`value-engine/scheduler.js`: Value Engine (`VALUE_ENGINE_SCHEDULER_ENABLED`, intervalo `VALUE_ENGINE_INTERVAL_MS`) + monitor de precio de picks (`pick-price-monitor`). Advisory locks `value-engine` / `pick-price-monitor` / `sportsbook-ingestion` (anti-solape). Sin feed de sportsbooks el tick no encuentra mercados completos → `no_sportsbook_quotes` (seguro). No corre más rápido que la llegada de quotes.

## Procesamiento incremental (§53)
`value_evaluations` es idempotente por `input_hash` (mismos inputs+versiones → no duplica). Nuevas quotes → nueva evaluación. Se procesan solo mercados con quotes/model outputs/mappings nuevos.

## Lifecycle de oportunidad
`value_opportunities` usa la **evaluación actual** (`current_evaluation_id`), no el estado histórico. Una señal no sigue STRONG porque lo fue.
