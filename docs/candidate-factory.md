# Value operativo continuo + Candidate Factory + readiness (Fase J)

Activa Value en modo operativo continuo y la generación interna de **candidates** (no Picks) desde oportunidades
STRONG reales. **NO se tocan** modelos/Elo/Poisson/MC/ensemble/no-vig/thresholds/reglas STRONG/Quality. V1 oficial,
V2 peso 0. La conversión a Pick sigue **deshabilitada**. Si no aparece un STRONG real → `candidates=0` es correcto.

## §2 Parche semántico de CLV (clv-semantics-2)
La fórmula previa NO es "no-vig vs no-vig": compara entry price (1/best published odds) contra el precio justo del
cierre (consenso no-vig). En `metric_facts` (0 facts → sin reescritura):
- `entry_price_vs_closing_fair_gap = official_closing_probability − published_break_even_probability` (>0 = la cuota tomada era mejor que el precio justo del cierre).
- `price_clv = published_odds / (1/official_closing_probability) − 1`.
- `market_move_no_vig = closing_no_vig − publication_no_vig` **solo** si se congeló el consenso al publicar (hoy null, no se inventa).
- `clv_probability`/`clv_odds` quedan como **aliases DEPRECADOS** (clv-semantics-1), mismos valores. Elegibilidad y ROI sin cambios.

## §3 Value operativo (internal_operational)
`valueDryRun.runOperational` — `evaluation_mode='internal_operational'`, `registry_eligible=false`,
`public_eligible=false`, V1 oficial, V2 peso 0. **No evalúa sobre datos stale/failed** (gate de frescura por
`sportsbook_provider_state.last_success_at`). Tras evaluar, marca `pick_candidate_eligible=true` solo en STRONG
sin blockers (no cambia thresholds ni clasificación).

## §4 Orden del pipeline
ingesta exitosa → canonical mapping → set assembly → Value evaluation → opportunity state → candidate eligibility →
candidate price refresh. El `value` scheduler (lock anti-solape) corre `candidateFactory.run()` cada ciclo
(refresh de price-state/lifecycle), **aislado**: una falla de la factory no rompe Value; una de Value no rompe ingesta.

## §5 Ingesta 10 min + quota guard
`SPORTSBOOK_INGESTION_INTERVAL_MS=600000`. **Consumo estimado** (`quotaGuard.cadenceEstimate`): 144 runs/día ×
~2 req/run = ~288/día = ~8.640/mes ≈ **43% del plan 20k** → sostenible. Soft limit (warning, reducir agresividad)
al 30% remaining; hard limit (detener no esenciales, preservar lifecycle/Registry) en la reserva (15%). El hard real
ya lo aplica `quotaCritical`/circuit breaker. No cambia closing/settlement cadence.

## §6 Value scheduler
Flags `VALUE_ENGINE_ENABLED/WRITE/SCHEDULER`, `VALUE_INTERNAL_PREVIEW_ENABLED`, `VALUE_PUBLIC_ENABLED=false`,
`VALUE_AUTO_PUBLICATION_ENABLED=false`. Una sola evaluación por estado material (idempotente por `input_hash`); no
crea fila por polling sin cambios.

## §7,§11,§12,§13 Candidate Factory
`value-engine/candidateFactory.js` + tabla `candidate_factory`. Un candidate = oportunidad STRONG que pasó TODOS los
gates técnicos del Value Engine y está lista para revisión humana. **NO es** Pick/señal/Registry/recomendación pública.
- **Eligibility (§7):** solo `classification='strong'` + `evaluation_mode='internal_operational'` + `pick_candidate_eligible=true`. PASS/WATCH/LEAN y V2 (que vive en `value_v2_diagnostics`) **nunca** crean candidate.
- **Dedup (§13):** identidad natural `canonical_event|market|period|outcome|model_version|value_policy_version` (UNIQUE). Una oportunidad NO crea candidate nuevo por ciclo: actualiza precio/sportsbook/freshness/status/blockers + historial. Nueva versión solo si cambia identidad material.
- **Price state (§12):** `AVAILABLE/ABOVE_MINIMUM/AT_MINIMUM/BELOW_MINIMUM/STALE/SUSPENDED/UNAVAILABLE/EVENT_STARTED`, refrescado con cada ingesta; **no cambia la probabilidad original**. Si cae bajo la mínima → deja de estar READY; si recupera antes del kickoff → vuelve a revisión (sin duplicar).
- **Lifecycle (§11):** `DETECTED/READY_FOR_REVIEW/BLOCKED/PRICE_BELOW_MINIMUM/STALE/SUSPENDED/EXPIRED/REJECTED/CONVERTED_TO_PICK`. En esta fase **nunca** llega a CONVERTED_TO_PICK. No se borran expirados/rechazados (historial + reason codes).

## §8 Readiness gate
Un candidate solo alcanza `READY_FOR_REVIEW` si pasa: canonical event, sets 1X2 frescos, grupos verificados,
best sportsbook/price, mínima, deep link (o homepage segura), **ESPN fixture mapping aprobado**, closing/settlement
readiness, Registry health, Metrics health, kickoff suficientemente futuro. Si falta algo → `BLOCKED_*`
(`MISSING_ESPN_MAPPING/MISSING_DEEP_LINK/STALE_PRICE/PRICE_BELOW_MINIMUM/EVENT_STARTED/INSUFFICIENT_GROUPS/REGISTRY_UNHEALTHY/METRICS_UNHEALTHY/KICKOFF_TOO_SOON`).
Sin override silencioso.

## §9 ESPN fixture pre-flight
`signal_event_fixture_mappings.review_status` (proposed|approved|rejected). El admin aprueba mappings ANTES de que
exista un STRONG; el readiness exige `review_status='approved'`. No fuzzy match al liquidar.

## §10 Deep links
`sportsbook-providers/deepLinks.js`. **Auditoría: The Odds API v4 NO entrega deep links** → el resolver cae a la
homepage segura del sportsbook o a null (orden outcome→market→event→homepage→null). Valida correspondencia de host;
sin parámetros de afiliado (no hay config aprobada). Analytics de clics preparado, no activado.

## §14-16 Admin UI
`GET /api/internal/value/candidates` (cola: event/selection/probs/odds/min/sportsbook/price-status/edge/EV/quality/
grupos/edge-source/ESPN/readiness/status). Acciones permitidas: **VIEW/REJECT/NOTE/REFRESH** (`POST .../candidates/:id/{reject,note,refresh}`).
**No** approve/publish/register (botón "Aprobar como Pick" deshabilitado: "se habilitará en la siguiente fase").
Product preview simplificado (estilo usuario, sin tecnicismos ni source notes) + explicación determinística
(edge_source_code: desacuerdo del modelo / precio favorable / híbrido) + riesgos reales. Sin "apuesta segura".

## §17 No forzar la primera oportunidad
Si no aparece STRONG → `0 candidates` + "No apareció ninguna oportunidad que cumpliera los gates actuales." No se
bajan thresholds, no se quita uncertainty penalty, no se promueve LEAN, no se usa V2.

## Migración 030 (aditiva, post-029)
`candidate_factory` (lifecycle/price-state/readiness/dedup) + CLV semantics en `metric_facts` + quota cols en
`sportsbook_provider_state` + `review_status` en `signal_event_fixture_mappings`. up/down/re-up ok.

## Tests (§18-19)
`tests/post-shadow-candidate-factory-db.test.js` — **33/0** (STRONG→READY, PASS/WATCH/LEAN/V2 excluidos, blockers
ESPN/grupos/precio/deep-link/event-started/stale, dedup, price recovery, concurrent, deep links, quota cadence,
CLV semantics, Metrics-unhealthy, reject, regresión). Sin regresión: value 36, value-db 15, sportsbook 28, metrics 29.
