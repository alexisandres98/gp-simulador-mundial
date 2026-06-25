# Value — Dry-run desacoplado de write (Bloques H, I, J, K)

`sportsbook-providers/valueDryRun.js#runDryRun()`. Ejecuta el **pipeline completo** de Value con
`VALUE_ENGINE_WRITE_ENABLED=false` y **sin** escribir ninguna tabla oficial.

## Desacople (R11)
`value-engine/config.js`: `valueScheduler = veEnabled && SCHEDULER` (antes `veWrite && ...`). Con
`VALUE_ENGINE_ENABLED=true` + `VALUE_ENGINE_SCHEDULER_ENABLED=true` + `WRITE=false` → corre en **dry-run**.

## Pipeline
```
linkedEvents (canonical_event_id != null)
 → H assembleSets (sets 1X2 sincronizados: mismo book/evento/mercado/periodo, skew ≤ 60s, no stale/suspended/live)
 → I detectOutliers (outlier semántico / inversión Bosnia → excluye + hasUnresolved)
 → J sourceCatalog.classify (verified_independence_groups)
 → evaluate.evaluateMarket (no-vig proporcional → consenso mediana por grupo → ensemble logit → clasificación)
 → registros SHADOW
```
Entradas a `evaluateMarket`: `verifiedIndependenceGroups` (J) y `criticalContradiction = hasUnresolved` (I).

## Garantía de no-escritura oficial
`runDryRun` **nunca** escribe `value_evaluations`, `value_opportunities`, `pick_candidates`, señales, métricas
públicas ni alertas. Solo escribe (gateado por `VALUE_SHADOW_RUNS_ENABLED`) las tablas **semánticamente
separadas** `sportsbook_value_shadow_runs` / `_evaluations` (mig 023, retención propia, nunca consumidas por
endpoints públicos). Verificado: tras el dry-run, las 4 tablas oficiales quedan en **0 filas**.

## Reporte por evaluación
`evaluated, BLOCKED, PASS, WATCH, LEAN, STRONG` + por outcome: clasificación, reason codes, source count,
verified independence groups, consensus completeness, no-vig methods, ensemble, uncertainty, quality, best price,
minimum odds / maximum price, freshness, blockers, policy versions. **Sin secrets ni payloads completos.**
Tests: `tests/post-shadow-value-dryrun-db.test.js` (20/20). V2 sigue con **peso 0** en el ensemble oficial.
