# Sprint 6 — Auditoría de datos para métricas

## De dónde salen las métricas (Sprint 5)
| Fuente | Campos usados |
|---|---|
| `signals` | `signal_payload.probabilities`, `signal_type`, `model_version`, `methodology_version`, `published_at`, `event_start_at`, `market_close_at`, `verification_status`, `score_eligible`, `experimental`, `legacy`, `canonical_event_id`, `direction` |
| `signal_settlements` | `settlement_status` (final/void/...), `winning_outcome_id`, `event_result`, `is_final`, `settlement_version` (última) |
| `signal_closing_snapshots` | `executable_price`, `midpoint`, `provider_reported`, `benchmark_type`, `capture_status` (para CLV) |
| `signal_state_projection` | `settlement_status`, `current_status` (lectura rápida) |

## Métricas calculables HOY (cuando existan señales elegibles)
- **Predicciones probabilísticas** (model_prediction_v1): Brier (binario + multiclase 1X2), log loss, calibración + ECE, accuracy secundaria (argmax), por rango de probabilidad, intervalos (Wilson/bootstrap), tamaño de muestra.
- **Señales con precio**: CLV en puntos de probabilidad y log-odds, forecast-vs-close (separado), closing-beat-rate — **solo si hay closing benchmark `captured`**.
- **Arbitraje**: oportunidades publicadas, margen neto estimado, tamaño ejecutable estimado, lifetime, expiración, deterioro de precio, quoted-to-executable, settlement estructural (métricas OBSERVADAS, nunca ROI realizado).
- **Experimental V1 vs V2**: Brier/log loss/accuracy/calibración de GP Intelligence, separado, `public_track_record=false`.

## Métricas NO calculables (honesto)
- **ROI realizado / beneficio / capital ejecutado**: GP no ejecuta → `unavailable`/`null` siempre (arb) o `unavailable` (predicciones sin precio).
- **Picks GP (ROI/yield/drawdown)**: no existen Picks GP oficiales hasta Sprint 7 → sección "No disponible".
- **No-vig consensus multi-proveedor**: es Sprint 7. Solo no-vig si el benchmark ya incluye mercado completo; si no → `no_vig_status=unavailable`.

## Tamaño de muestra ACTUAL (honesto)
- **`signals` en prod = 0** (Sprint 5 está **inerte**: `SIGNAL_REGISTRY_WRITE_ENABLED=false`, no se ha publicado ninguna señal).
- Por tanto **no hay track record oficial todavía**: el motor de métricas se construye y se valida con **fixtures (golden dataset)**; producirá métricas reales cuando se activen Sprints 5/6 y se publiquen señales con settlement.
- `verified_epoch` aún no configurado en prod (`SIGNAL_REGISTRY_VERIFIED_EPOCH` vacío) → toda señal sería `legacy_unverified` hasta setearlo. Las métricas oficiales requieren epoch configurado.

## Versiones disponibles
`gp-core-1.4.0` (V1 oficial), `gp-intelligence-0.2.0` (V2 experimental), `arb-engine-1` (arb). El diccionario de métricas versiona cada definición (`*_v1`).

## Limitaciones metodológicas (documentadas)
- Brier multiclase: se define como **Σ(p_k − y_k)²** (suma, sin dividir entre clases) — versionado `brier_multiclass_v1`; no se mezcla con la variante normalizada.
- Log loss: clipping `METRICS_LOG_LOSS_EPSILON` (default 1e-12) documentado; no oculta predicciones extremas equivocadas.
- ECE: equal-width inicial; equal-frequency preparado. Buckets vacíos NO se muestran como cero.
- CLV: requiere benchmark identificado, sin look-ahead (`observed_at ≤ event_start_at`); ausencia → `unavailable` (no se interpola).
- Closing market y per-match (1X2): hoy los collectors solo ingieren mercados **champion** → el benchmark de closing por partido puede no existir → CLV mayormente `unavailable` hasta ampliar ingesta.

## Principio
No se fabrican métricas para llenar el dashboard. Si la muestra es pequeña, se dice; si un benchmark no existe, se marca `unavailable`; las señales excluidas siguen visibles con su razón.
