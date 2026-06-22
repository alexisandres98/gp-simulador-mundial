# Sprint 5 — Política de settlement

`signal_settlements` (inmutable, versionado por `(signal_id, settlement_version)`).

## Estados
`pending → provisional → final`; `void`, `cancelled`, `disputed`, `corrected`.

## Idempotencia
Misma `settlement_source` + `source_reference` no se duplica (`settlements.exists`). Una corrección crea una
**nueva versión**; las versiones previas permanecen visibles.

## Por tipo de señal (§24)
- **model_prediction_v1**: se liquida según el resultado oficial del evento (`winning_outcome_id`, `event_result`).
  Queda preparado para calcular después Brier/log loss/hit rate (Sprint 6) — **no se calculan agregados aquí**.
- **arb_publication**: **NO** se afirma ROI realizado (GP no ejecutó). `result_type` =
  `theoretical_structure_settled` | `not_executed`; `realized_roi` permanece **null** (invariante). Se registra el
  outcome del evento, si ambos contratos liquidaron como se esperaba, precios publicados y vida de la oportunidad.
- **gp_intelligence_experiment**: se puede liquidar para investigación interna; **no** entra al track record oficial.

## Correcciones (§22)
Ejemplo: resultado 2-1 luego corregido a 2-0 por la fuente oficial → `settlement v1` + `correction event` +
`settlement v2`. Ambas visibles. **No** se permite corregir prob/precio/timestamp/modelo publicados (solo `disputed`).

## Fuentes
Prioriza fuentes oficiales/documentadas. **No** inferir settlement solo porque un mercado desapareció. Conflicto de
fuentes → `disputed` (a revisión).

## Scheduler (§27, gated)
`SIGNAL_SETTLEMENT_ENABLED` + `SIGNAL_SETTLEMENT_INTERVAL_MS`. Busca señales pendientes con eventos finalizados,
consulta resultado persistido (`db.results`) o proveedor autorizado, crea settlement provisional/final, registra
evento, **no** reescribe datos, manda conflictos a revisión. Usa locks; sin ciclos solapados.
