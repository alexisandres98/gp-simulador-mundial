# Sprint 6 — CLV

`clv.js`. **No hay una sola definición universal** → definiciones separadas.

- **CLV puntos de probabilidad** (`clv_probability_points_v1`): `closing − entry_implied`. Positivo = el cierre dio más prob al outcome que el precio de entrada.
- **CLV log-odds** (`clv_log_odds_v1`): `logit(closing) − logit(entry)`.
- **forecast_vs_close**: `model_prob − closing`. **NO** se llama CLV (predicción sin recomendación de entrada).

## Benchmark
Prioridad: `executable_price` > `midpoint` > `provider_reported`. Se separan (no se mezclan).
**Sin look-ahead**: `observed_at ≤ event_start_at`; un snapshot posterior se rechaza (`look_ahead_rejected`).
Ausencia de dato → `benchmark_status = unavailable` (no se interpola).

## No-vig
Es Sprint 7. En Sprint 6 `no_vig_status = unavailable` salvo que el benchmark ya incluya mercado completo. No se elimina vig con fórmula incorrecta.
