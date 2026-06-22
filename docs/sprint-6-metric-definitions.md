# Sprint 6 — Diccionario de métricas

`metrics-engine/definitions.js` + tabla `metric_definitions`. Fuente ÚNICA de cada fórmula (no hardcodear en varios lugares).

| metric_code | versión | tipo señal | fórmula | mejor | unidad |
|---|---|---|---|---|---|
| brier_multiclass | brier_multiclass_v1 | model_prediction_v1 | Σ(p_k − y_k)² (suma, sin /clases) | menor | score |
| brier_binary | brier_binary_v1 | model_prediction_v1 | (p − y)² | menor | score |
| log_loss_multiclass | log_loss_multiclass_v1 | model_prediction_v1 | −ln(p_real) con clipping ε | menor | nats |
| accuracy_top1 | accuracy_top1_v1 | model_prediction_v1 | argmax == outcome (secundaria) | mayor | rate |
| ece_equal_width | ece_equal_width_v1 | model_prediction_v1 | Σ(n_b/N)·\|conf_b − acc_b\| | menor | gap |
| clv_probability_points | clv_probability_points_v1 | price_signal | closing − entry | mayor | prob_points |
| clv_log_odds | clv_log_odds_v1 | price_signal | logit(closing) − logit(entry) | mayor | log_odds |
| closing_beat_rate | closing_beat_rate_v1 | price_signal | fracción con CLV_pp > 0 | mayor | rate |
| arb_publication_lifetime | arb_publication_lifetime_v1 | arb_publication | p25/p50/p75 de vida | — | seconds |
| arb_quoted_to_executable | arb_quoted_to_executable_v1 | arb_publication | ejecutables / con-spread | mayor | rate |

Cada definición tiene `minimum_sample_size`, `higher_is_better`, `eligibility_policy`. Versionar = no mezclar definiciones distintas bajo el mismo nombre.
