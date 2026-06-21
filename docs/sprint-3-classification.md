# Sprint 3 — Clasificación

> `arb-engine/classifier.js`. Conservador: 0 falsos Pure Arb. Un hard conflict / fee unknown / stale /
> book inválido / time skew NUNCA es Pure Arb.

## Clases
- **pure_arb**: mapping matched, 0 hard conflicts, reglas completas, fresh, time skew OK, full fill,
  fees conocidas, net profit > 0, net ROI ≥ umbral, payout/currency compatibles, capital ejecutable suficiente.
- **execution_sensitive**: estructura válida pero riesgo: derived ask, capital ejecutable fino,
  alta volatilidad, cerca del límite de skew, margen fino. No se presenta como garantizada.
- **conditional**: el Canonical Graph lo marcó conditional → se guarda, no pasa a Pure Arb.
- **price_discrepancy**: elegible y hay gap bruto, pero fees/profundidad/buffer eliminan el arb neto
  (o no full fill). No es Pure Arb.
- **rejected**: hard conflict, mapping inválido, stale, fee unknown, book inválido, market closed,
  payout incompatible, currency, time skew excesivo, sin gap bruto.

## Orden de decisión (precisión-primero)
1. mapping conditional → conditional.
2. cualquier motivo de elegibilidad/skew → **rejected** (no se degrada a discrepancy).
3. sin gap bruto → rejected; fee unknown → rejected.
4. elegible pero no full fill / net ≤ 0 / ROI < umbral → price_discrepancy.
5. válido + neto positivo: pure_arb, o execution_sensitive si hay warnings de ejecución.
