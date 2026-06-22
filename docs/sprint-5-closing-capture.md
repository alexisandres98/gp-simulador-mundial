# Sprint 5 — Captura de benchmark de cierre

`signal_closing_snapshots` (inmutable). Captura el último estado válido **antes** del evento. **No calcula CLV**
(eso es Sprint 6): solo captura el benchmark correctamente.

## Benchmarks (§25)
`last_valid_pre_event_executable`, `last_valid_pre_event_midpoint`, `provider_reported_close`.
Campos: best_bid/best_ask/midpoint/last_trade/executable_price, snapshot_id, observed_at, event_start_at, capture_status.

## Sin look-ahead
`observed_at <= event_start_at`. Un snapshot **posterior** al inicio se rechaza (`look_ahead_rejected`) — probado.
Idempotente por `(signal_id, benchmark_type)`.

## Ausencia / casos especiales
- Sin dato válido → `capture_status='unavailable'` (no se estima ni interpola).
- Pospuesto → `postponed`; suspendido → `suspended`.

## Scheduler (§26, gated)
`SIGNAL_CLOSING_CAPTURE_ENABLED` + `SIGNAL_CLOSING_CAPTURE_INTERVAL_MS` + `SIGNAL_CLOSING_MAX_PRESTART_WINDOW_MS`.
Identifica señales próximas al inicio, captura el último snapshot válido, evita duplicados, respeta provider
timestamps, no usa datos futuros, marca `unavailable` cuando corresponde. No ejecuta más rápido que la llegada de datos.
