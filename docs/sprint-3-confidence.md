# Sprint 3 — Confianza de ejecución

> `arb-engine/confidence.js`. Score 0-100 + high/medium/low, EXPLICABLE. **NO modifica net_profit/net_roi**
> (no se restan dólares por confianza). Separada del beneficio real.

## Factores (cada uno con contribution/evidence/warning)
mapping quality · manual review · rules completeness · freshness · time skew · direct vs derived price ·
depth/levels · volatility · provider error rate/latency · fee certainty.

## Etiquetas
`high ≥ 80 · medium ≥ 55 · low < 55`. Penalizaciones ejemplo: derived ask −10, stale −25, fee uncertain −20,
high time skew −12, high volatility −12.

## Importante
La confianza informa el RIESGO de ejecución; no cambia el cálculo monetario. Una oportunidad con net
ROI alto pero confianza baja sigue teniendo ese net ROI — la confianza solo advierte la fragilidad.
