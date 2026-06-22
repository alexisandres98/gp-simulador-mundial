# Sprint 6 — Calibración

`calibration.js`. Reliability diagram one-vs-all: cada predicción 1X2 aporta 3 puntos (home/draw/away) `{p, y}`.

## Buckets
Equal-width (default 10), configurable (`METRICS_CALIBRATION_BUCKETS`). Equal-frequency preparado a futuro.
Por bucket: `predicted_average`, `observed_frequency`, `count`, `absolute_gap`, intervalo (Wilson).
**Buckets vacíos NO se muestran como cero** (se omiten). p=1 cae en el último bucket.

## ECE (`ece_equal_width_v1`)
`ECE = Σ (n_bucket / N) · |predicted_average − observed_frequency|`.
Validado: calibración perfecta → ECE 0; sobreconfianza (p=0.9, 50% ocurre) → ECE 0.4.
Muestras pequeñas se marcan; no usar demasiados buckets con pocos datos.

## UI
Scatter pronosticado vs observado + línea diagonal ideal; tamaño del punto ∝ muestra. ECE mostrado. Persistido en `metric_calibration_bins`.
