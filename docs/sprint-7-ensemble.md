# Sprint 7 — Ensemble

`ensemble.js`. **Weighted logit pooling**: `logit(p_ens)=Σ w_i·logit(p_i)` → `logistic` → renormalizado a Σ=1. Clipping documentado antes de logit.
Pesos VERSIONADOS (`ensemble-logit-1`), centralizados en config (no hardcode): sportsbook consensus (dominante 0.55), GP (0.20), prediction markets (0.25), sharp (0.0 hasta validar). Fuentes faltantes → reponderación al subconjunto disponible.
**Política conservadora**: GP con muestra `insufficient/early` o calibración `insufficient_data` → peso capado a `VALUE_MAX_GP_WEIGHT_WITH_INSUFFICIENT_SAMPLE` (0.10).
**Invariante**: GP Intelligence **V2 nunca** entra al ensemble oficial (peso 0). Doble conteo evitado: si una fuente ya está en el consenso no se añade de nuevo. Sin look-ahead (no pesos entrenados con resultados futuros).
