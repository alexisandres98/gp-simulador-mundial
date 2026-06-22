# Sprint 7 — Consenso de sportsbooks

`consensus.js`. **Mediana por outcome** (reduce outliers). Excluye stale / incompletos / probabilidades inválidas (exclusiones **auditadas**, no silenciosas).
**Independencia (§7)**: cada `independence_group` se colapsa a su mediana → **máximo un voto pleno por grupo**. `source_count` = books incluidos; `independence_groups` = grupos. Una sola fuente → `independence_groups=1` (no se presenta como "consenso").
Guarda: probability_by_book, median_probability (renormalizada a Σ=1), trimmed_mean, min, max, dispersion (+ por outcome), exclusions.
**Sharp reference (§16)**: roles `market_consensus/reference/sharp_candidate/sharp_validated/retail/prediction_market`. Sin fuente validada → `sharp_reference_status=unavailable`. **No se inventa una referencia sharp**; el motor funciona con consenso.
