# Sprint 6 — Intervalos de incertidumbre

`confidenceIntervals.js`. No se ocultan intervalos amplios. Sin `Math.random()` (todo sembrado).

- **Hit rate / proporciones** (accuracy, closing_beat_rate): **Wilson** (z=1.96).
- **Brier / log loss / CLV**: **bootstrap** reproducible (percentiles 2.5/97.5), LCG sembrado.
  - `METRICS_BOOTSTRAP_ITERATIONS` (default 2000), `METRICS_BOOTSTRAP_SEED` (default 20260622).
  - Mismo input + misma seed → mismo intervalo (verificado).

Cada métrica pública incluye `{ estimación, intervalo {low, high}, n }`. Un intervalo nulo (n insuficiente) no se muestra como cero.
