# Sprint 6 — Política de retornos

`returns.js`. **No mostrar ROI** para una señal que no especificó selección + precio + dirección + stake + settlement + fees.

- **Predicciones V1 (solo probabilidades)**: `ROI = unavailable` (`prediction_without_price`).
- **Arbitraje**: `realized_roi = null` SIEMPRE (GP no ejecuta). Se puede mostrar `published_net_roi_estimate`, `last_valid_net_roi_estimate`, `structural_settlement` (`theoretical_structure_settled` / `not_executed`). Nunca ROI realizado.
- **Señales con precio**: simulado solo si `METRICS_SIMULATED_RETURNS_ENABLED` (apagado por defecto) + inputs completos; etiquetado `SIMULADO — NO REPRESENTA OPERACIONES REALIZADAS`. La política completa de stake es Sprint 7.
- **Picks GP**: no existen hasta Sprint 7 → la sección de yield/drawdown muestra "No disponible". No se fabrica una curva con predicciones que no fueron picks. Drawdown (cuando exista) se ordena por `published_at`, nunca por resultado.
