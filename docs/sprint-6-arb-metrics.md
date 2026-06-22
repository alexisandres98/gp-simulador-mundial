# Sprint 6 — Métricas de arbitraje

`arbMetrics.js`. Bloque **completamente separado** de las predicciones deportivas. Solo OBSERVADO.

## Permitido
evaluations_scanned, opportunities_detected/published, pure_arb/execution_sensitive count, median published net ROI estimate, median max executable capital estimate, lifetime p25/p50/p75, expired_before_click, price_changed_before_calculation, **quoted_to_executable_conversion** (con spread matemático vs que superaron fees+profundidad+reglas), deep_link_validation_rate, structural_settlement_success.

## Prohibido (siempre `null`)
`realized_roi`, `realized_profit`, `executed_capital`. No "ganamos X con arbitraje", no beneficio acumulado — GP no ejecutó.

Copy fijo: *"Las métricas reflejan oportunidades observadas, no ejecuciones realizadas por GP."*
