# Sprint 7 — Despliegue (por fases, gated)

**No desplegar al terminar.** Código inerte; reporte primero.

## Flags (default false)
`SPORTSBOOK_DATA_ENABLED/WRITE`, `VALUE_ENGINE_ENABLED/WRITE/SCHEDULER`, `VALUE_ADMIN_PREVIEW`, `VALUE_PUBLIC`,
`PICKS_ENABLED/ADMIN_PREVIEW/MANUAL_PUBLICATION/PUBLIC`, `PICKS_AUTO_PUBLICATION_ENABLED` (forzado false en código), `VALUE_EXPERIMENTAL_V2_ENABLED` (no alimenta picks).
Parámetros: `VALUE_WEIGHT_*`, `VALUE_*_MIN_ADJUSTED_EDGE_PP/EV`, `VALUE_STRONG_MIN_QUALITY_SCORE`, `VALUE_STRONG_MAX_UNCERTAINTY_SCORE`, `VALUE_MIN_SPORTSBOOK_SOURCES/INDEPENDENCE_GROUPS/DATA_QUALITY`, `VALUE_MINIMUM_EV`, `VALUE_MAX_*_MS`, `SPORTSBOOK_INGESTION_INTERVAL_MS`, `VALUE_ENGINE_INTERVAL_MS`.

## Migración
`015_value_engine_picks.sql`: sportsbook_quotes(+ingestion_runs), value_evaluations, value_opportunities, pick_candidates, pick_publications(+history), model_calibration_policies. Rollback solo Sprint 7. Probado.

## Fases (§74)
1. Inerte (todo off) → app idéntica. Migración 015.
2. Sportsbook ingestion shadow (requiere proveedor autorizado integrado).
3. Value dry run → 4. Value persistido (interno).
5. Admin preview (Value + Picks) → 6. Picks internas (manual, no público).
7. Beta pública gratuita (Value + Picks) — solo tras validación real, closing+settlement operativos, 0 falsas STRONG, picks/copy/deep-links/jurisdicción revisados. **Sin paywall en Sprint 7.**

## Prerequisito de validación real (§70)
≥3 grupos de sportsbooks independientes, 1X2 completos, ≥24h ingesta, ≥30 mercados evaluados, revisión manual de todas las STRONG. **Hoy falta un proveedor de sportsbooks autorizado y mercados 1X2 por partido** → estado COMPLETADO CON PENDIENTE DE VALIDACIÓN REAL.
