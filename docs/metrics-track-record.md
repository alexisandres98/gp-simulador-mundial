# Metrics internas / track record reproducible (Fase I)

Activa el motor de métricas interno reusando la matemática de Sprint 6 (Brier/log loss/calibración) y añade una
capa de **facts inmutables y versionados** que reproduce cada cálculo desde la información **congelada** en la
señal. Público/Picks/candidates siguen OFF. V1 oficial, V2 peso 0.

## Principio
Las métricas usan **exclusivamente** la información congelada en el momento de la señal: la probabilidad publicada
viene del `signal_payload` inmutable (no se re-llama a V1/V2), el closing oficial de `closing-policy-1`, y el
settlement final factual. Con muestra cero → **N/A** y `sample_size=0` (nunca ROI 0% / Brier 0).

## Metric fact inmutable (§4-5) — `metrics-engine/trackRecord.js` + tabla `metric_facts`
Por señal: probabilidades congeladas (home/draw/away + outcome), published_odds + break_even, closing oficial
(prob/odds/policy), settlement (status/result_outcome/version), y métricas. **Append-only + versionado**:
`input_hash` (idempotente) + `supersedes_metric_fact_id` + `effective`. Una corrección de settlement / cambio de
estado admin / closing genera una **nueva versión** (la anterior se preserva, `effective=false`). Trigger bloquea
DELETE y la edición del contenido; solo se permite marcar `effective=false`.

## Brier / Log loss (§6-7) — reusa Sprint 6
- **Brier 1X2** = Σ(p_k − y_k)² (suma de los 3 componentes home/draw/away vs one-hot), `brier_multiclass_v1`.
  Ej.: p={.5,.3,.2}, gana home → (.5−1)²+.3²+.2² = **0.38**.
- **Log loss** = −ln(P(outcome_real)), clamp ε versionado (`log_loss_multiclass_v1`). Ej.: P(home)=.5 → **0.6931**.
- Solo se computan con settlement **final factual**; sin él → null (no se inventa).

## Calibration / ECE (§8) — reusa Sprint 6
`calibration.reliability` (10 bins equal-width, one-vs-all para home/draw/away). Buckets vacíos omitidos. Con
muestra insuficiente → `insufficient_sample`; el sample size se muestra siempre.

## CLV (§9) — desde closing-policy-1
- `clv_probability = official_closing_probability − published_break_even_probability` (>0 = batiste el cierre).
- `clv_odds = published_odds / official_closing_odds − 1` (>0 = mejor cuota que el cierre).
- Usa **solo** el closing oficial (consenso no-vig, `closing-policy-1`), sin mezclar vig/no-vig ni best aislada.
- `closing_status ≠ AVAILABLE` (unavailable/stale/missing/mapping) → **CLV N/A** (null, nunca 0).

## ROI teórico (§10)
Etiquetado `theoretical · flat_1_unit_v1 · executed_by_gp=false` (GP no ejecuta, sin bankroll del usuario).
WON → profit = odds−1; LOST → −1; void/cancelled → 0 (stake devuelto); postponed/abandoned/unresolved/provisional
/administrative_void → null (no liquidado / fuera de primaria). Persiste profit + return; agregado da ROI/yield +
sample_size.

## Cohortes y estados administrativos (§11)
`ALL_OFFICIAL_SIGNALS · SETTLED_ELIGIBLE · OPEN · RETRACTED · QUARANTINED · CORRECTED · DATA_ERROR ·
ADMINISTRATIVE_VOID · CLV_AVAILABLE · CLV_UNAVAILABLE`. ACTIVE elegible al liquidar; QUARANTINED → held (visible);
RETRACTED → visible, fuera de primaria; DATA_ERROR / ADMINISTRATIVE_VOID → excluidos pero contados y visibles
(resultado factual preservado). **Una pérdida no puede desaparecer por una acción administrativa.**

## Aggregates / snapshots (§12-13)
`computeAggregate` (global + por cohorte) → signals/settled/won/lost, theoretical profit/ROI/yield, avg odds,
CLV avg/median/positive-rate, Brier/log loss medios, ECE, sample_size. `metric_track_snapshots` versionados,
append-only (trigger), con `source_max_sequence`/`source_max_settlement_version`. Empty → snapshot N/A.

## Scheduler (§14)
Reusa el scheduler de Sprint 6 (job `metrics_engine`, flags `METRICS_ENGINE_ENABLED/WRITE/SCHEDULER`, dependencia
`settlement`): el `tick()` corre el rebuild de Sprint 6 y, **aislado**, el `trackRecord.rebuild()`+`snapshot()`.
Idempotente; cero señales = no-op sano; un error de track no afecta Registry/closing/settlement ni Sprint 6.
One-shot admin `POST /api/internal/metrics/track-record/run`.

## Admin preview (§15) y público OFF (§16)
`GET /api/internal/metrics/track-record` (admin): estado + cards (ROI/profit/Brier/log loss/CLV/ECE/sample) con
**N/A** cuando sample=0 + cohortes. UI card en el panel admin. Público `/api/metrics/*` sigue **OFF/404**
(`METRICS_PUBLIC_ENABLED=false`). DTO público sanitizado = trabajo futuro, no implementado.

## First-signal readiness gate (§17)
`GET /api/internal/metrics/readiness?event=<id>` → verifica canonical event + sportsbook sets + **fixture mapping
ESPN** + registry/metrics operativos. **Por defecto BLOQUEA** con `MISSING_RESULT_PROVIDER_MAPPING` si falta el
mapping ESPN (salvo override manual auditado aceptado por Alexis).

## Migración 029 (aditiva, post-028)
`metric_facts` (inmutable/versionado, §4) + `metric_track_snapshots` (versionado, append-only). up/down/re-up ok.

## Tests (§19)
`tests/post-shadow-metrics-track-record-db.test.js` — **29/0** (facts congelados, Brier/logloss/CLV/ROI con números
validados, eligibility, estados admin, versionado/idempotencia/inmutabilidad, aggregates/cohortes/snapshots,
empty-N/A, readiness gate, regresión). Sin regresión: metrics-engine 53, metrics-engine-db 18.
