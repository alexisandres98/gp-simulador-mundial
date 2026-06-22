# Sprint 5 — Auditoría del estado de señales (antes de construir)

## Qué existe hoy
| Pieza | Estado | Notas |
|---|---|---|
| Tabla `signals` (mig. 004) | **vacía (0 filas)** | Scaffolding. Columnas: id, signal_type, canonical_event_id, canonical_market_id, status(draft/published/expired/superseded/corrected), model_version, mapping_version, rules_version, created_at, published_at, expired_at, snapshot_ids[], signal_payload, result_payload, metadata. **Se evoluciona (ALTER), no se duplica.** |
| Tabla `model_analysis_runs` (mig. 008) | vacía | Experimentos GP Intelligence V2 (control vs challenger, input_hash, random_seed, factor_policy_version). |
| `arb_evaluations` / `arb_publications` (mig. 011/012) | vacías | Fuente de señales tipo `arb_publication` (Sprint 4). Evaluaciones ya inmutables por `input_hash`. |
| Settlement de partidos | `db.json → db.results[matchId]` | `{hg, ag, status:'final', minute, source:'espn', [home, away, pensHome]}`. Final = ESPN `state='post'`. |
| Track record V1 | `/api/aciertos`, **recalculado en vivo** | Brier/avgProb se computan replayando Elos previos en cada request. **No hay predicción congelada con published_at.** |
| Closing line | `db.json → db.marketSnapshots[matchId]` | `{home, draw, away, ts}` = última prob Polymarket pre-kickoff (no-vig). Lo único que se congela hoy. |
| Versiones disponibles | código | `gp-core-1.4.0`, `gp-intelligence-0.2.0`, `factor-policy-1`, `normalizer v0` (gpIntelligence.VERSIONS); `arb-engine-1`, `fee-1`, `cls-1`, `conf-1` (arb-engine.VERSIONS). engine.js no tiene constante de versión explícita → se define `methodology_version` para V1 en Sprint 5. |

## Qué se puede modificar / qué se pierde al reiniciar
- `db.json` se persiste a disco (Render `/data`), pero `db.history` (timeline de probs) guarda **solo en memoria** (últimas 1000) → se reconstruye al reiniciar (no es histórico fiable).
- Las **probabilidades V1 se recalculan** en cada arranque (Elo desde base + resultados). No están congeladas con timestamp.
- `db.results` es editable por admin (corrige resultados); recálculo de Elo replica todo desde base.

## Timestamps existentes
- fixture `datetime` (kickoff planeado, ISO). `db.marketSnapshots[].ts` (ms, captura del closing). `db.history[].ts` (ms, sim). `model_analysis_runs.created_at/completed_at` (TIMESTAMPTZ). `signals.created_at/published_at/expired_at` (TIMESTAMPTZ, sin uso hoy). `normalized_market_snapshots.provider_timestamp/received_at`.
- **NO existe** `published_at` real de predicciones, ni `input_cutoff_at`, ni `locked_at`, ni hash de contenido.

## Resultados / settlement
- Solo estados `live`/`final` (ESPN). **No hay manejo de postponed/cancelled/void** a nivel evento (aunque `canonical_events.status` admite esos valores en el esquema). Riesgo: un partido anulado que ESPN marque `post` se guardaría como `final`. → Sprint 5 captura settlement con versión + estado `void/cancelled/disputed` y fuente, sin reescribir.

## Qué es verificable / qué NO (honesto)
- **NO verificable retroactivamente**: ninguna predicción V1 previa puede presentarse como "señal verificada" — no se congeló contenido, ni precio/prob con `published_at`, ni hashes, ni inputs originales enlazados. Cualquier histórico anterior se marca `legacy_unverified`, `score_eligible=false`.
- **Verificable a partir del epoch**: solo señales registradas por el nuevo sistema tras `SIGNAL_REGISTRY_VERIFIED_EPOCH`, con published_at server-side, versiones, source references y hash chain.
- `db.marketSnapshots` (closing lines) y `db.results` pueden servir como **source references** y fuente de settlement, pero los timestamps son `ts` capturados, no firmados.

## Decisiones de diseño derivadas
1. Evolucionar `signals` con columnas Sprint 5; lifecycle frozen en la fila (immutable), estado vivo en `signal_state_projection`.
2. Registro 100% en **PostgreSQL** (no en db.json) → necesario para inmutabilidad (triggers) y hash chain.
3. `realized_roi` de arb = **siempre null** (GP no ejecuta). Settlement de arb = `theoretical_structure_settled` / `not_executed`.
4. V2 (GP Intelligence) → `experimental=true`, `score_eligible=false`, separado del track record.
5. No mezclar legacy con verified; epoch explícito; no backdatear.
