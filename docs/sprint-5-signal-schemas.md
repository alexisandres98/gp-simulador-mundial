# Sprint 5 — Esquemas de señal

`schemas.validate(signal_type, payload)`. Versiones en `config.SCHEMA_VERSIONS`.

## A. model_prediction_v1 (`model_prediction_v1-1`)
Payload: `probabilities`, `predicted_outcome`, `expected_goals`, `market_type`, `simulation_count`,
`market_comparison_at_publication`, `data_quality`, `input_data_versions`.
Validación: 1X2 → `home/draw/away` en [0,1] y `home+draw+away ≈ 1` (±0.01). Otros mercados → cada probabilidad en [0,1].
`model_version` se valida a nivel señal (eligibility), no en el payload.

## B. arb_publication (`arb_publication-1`)
Payload: `arb_publication_id`, `arb_evaluation_id`, `classification`, `legs[]`, `prices/vwap/fees`, `net_roi`,
`net_profit`, `max_executable_capital`, `mapping_version`, `rules_fingerprints`, `snapshot_ids`, `last_validated_at`.
Validación: campos requeridos presentes; ≥2 legs; **`realized_roi` debe ser null** (GP no ejecuta) → rechazo si viene poblado.

## C. gp_intelligence_experiment (`gp_intelligence_experiment-1`)
Payload: `model_analysis_run_id`, `control_output`, `challenger_output`, `delta`, `factor_policy_version`,
`random_seed`, `data_quality`. Siempre `experimental=true`, `score_eligible=false` (forzado por publisher/eligibility).

## D. Contratos futuros (no implementados en Sprint 5)
`value_signal`, `editorial_pick`, `sportsbook_signal`, `prediction_market_signal` → aceptados como tipo pero
`schemas.validate` devuelve `signal_type_not_implemented_yet` (sus motores son de sprints posteriores).

## Edición de predicciones (§17)
`prediction_edition` + `supersedes_signal_id`. No se registra cada recálculo automáticamente
(`SIGNAL_REGISTRY_AUTO_MODEL_CAPTURE_ENABLED=false` inicialmente). Una edición nueva **no** sobrescribe la
anterior: ambas quedan visibles; la nueva puede declarar `supersedes`.
