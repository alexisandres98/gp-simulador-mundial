# Sprint 3 — Golden execution dataset

> `arb-engine/fixtures/golden.js`: 61 casos (10 pure_arb, 10 fee-killed, 10 depth-killed, 10 conditional,
> 10 price_discrepancy, 11 rejected). Evaluado por `tests/arb-engine.test.js`.

## Resultados (medidos)
```
pure arb detectados: 10/10   ·   falsos Pure Arb materiales: 0
clasificación correcta: 61/61
```
- **0 falsos Pure Arb** (condición crítica): nada se aprueba como pure_arb donde no debe.
- fee-killed → price_discrepancy (las fees de Kalshi eliminan el gap bruto).
- depth-killed → execution_sensitive (arb solo en 1 nivel diminuto; capital ejecutable < mínimo).
- conditional → conditional. rejected (stale/fee unknown/currency/closed/hard conflict/time skew/...) → rejected.

## Métricas de calidad
classification precision 100%; false Pure Arb rate 0; net ROI/max size exactos (aritmética decimal).
Un caso dudoso se DEGRADA (execution_sensitive / price_discrepancy), no se aprueba.

## Pendiente de validación real
El histórico de Sprint 1 y los mappings de Sprint 2 están inertes en prod → estos casos son **fixtures
validados**, no datos reales. Al activar la ingesta, repetir contra datos reales antes de cualquier auto-match.
