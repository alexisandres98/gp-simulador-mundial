# Sprint 6 — Brier y log loss

## Brier (`brier.js`)
- Binario: `(p − y)²`, y ∈ {0,1}.
- Multiclase 1X2 (`brier_multiclass_v1`): **Σ (p_k − y_k)²** — SUMA, **sin** dividir entre clases. Documentado explícitamente; no se mezcla con la variante normalizada.
- Requisitos: probabilidades válidas (suma ≈ 1, todas en [0,1]), outcome final (no provisional), no experimental para el oficial.
- Agregado: promedio + intervalo bootstrap + n + (baseline cuando exista). Validado: perfecto=0, peor binario=1, uniforme 1X2=0.6667.

## Log loss (`logLoss.js`)
- Binario: `−[y·ln(p) + (1−y)·ln(1−p)]`. Multiclase: `−ln(p_outcome_real)`.
- Clipping versionado `METRICS_LOG_LOSS_EPSILON` (default 1e-12), documentado. **No oculta** predicciones extremadamente confiadas y equivocadas (una p=1 errónea → ~27.6 nats, finito, no Inf).
