# Cableado automático end-to-end de closing y settlement (Fase H.1)

Cierra el pendiente Medium de Fase H: los schedulers ahora ejecutan closing y settlement **sin CLI**, cableados a
sus fuentes reales. Manual/CLI queda solo como recuperación administrativa. Metrics/Picks/público siguen OFF.

## Definition of Done

```
signal → canonical_event → sportsbook consensus no-vig pre-kickoff → closing snapshot   (automático)
signal → canonical_event → ESPN fixture mapping → regulation result → settlement         (automático)
```

## Closing automático (§3-4) — `closingResolver.resolveClosing`

1. **Resolución del mercado:** quotes 1X2 del `canonical_event_id` con `provider_update <= kickoff`
   (anti-look-ahead a nivel de dato) → `setAssembly.assembleSets` (sets sincronizados, no live, no suspended, skew).
2. **Closing oficial:** consenso **no-vig** (`value-engine/noVig` + `consensus.compute`, mediana por outcome,
   un voto por independence_group) **solo de grupos independientes VERIFICADOS** (`sourceCatalog`). Nunca best
   odds aislada, casa cualquiera, vig, set incompleto ni quote post-kickoff/live.
3. **Persistencia automática** (`captureClosing`, idempotente por `(signal_id, benchmark_type)`):
   `official_closing_probability/odds`, `best_closing_odds/sportsbook`, `source_group_count/set_count`,
   `last_valid_provider_updated_at`, `observed_at`, `kickoff_at`, `capture_status`, `closing_policy_version`,
   `capture_source='automatic'`, `clv_components`.
4. **Estados operativos:** `NOT_DUE | CAPTURED | UNAVAILABLE | RETRYABLE | FINAL_NO_DATA | BLOCKED`. Ventana de
   captura: `[kickoff - SIGNAL_CLOSING_MAX_PRESTART_WINDOW_MS, kickoff + SIGNAL_CLOSING_POST_KICKOFF_GRACE_MS]`,
   pero **el dato usado es siempre pre-kickoff**. Sin dato confiable pre-kickoff → `UNAVAILABLE` (no se interpola).

## Settlement automático (§5-6) — `resultResolver.resolveAndSettle`

1. **Mapping persistente** `signal_event_fixture_mappings` (canonical_event_id → fixture_id/espn_id, auditable).
   **No hay fuzzy auto-match en el momento de liquidar.** Sin mapping → `UNRESOLVED` / `missing_mapping`.
2. **Result provider** (`server.js` lo registra con un accesor a `db.results` del poller ESPN; inyectable en tests):
   estado ESPN → provisional/final, **solo marcador reglamentario** (sin prórroga ni penales; knockout con penales
   → regulation null → `UNRESOLVED`, sin inferir).
3. **Settlement versionado** (`settleFromProvider`, idempotente por `(source, source_reference)`):
   `result_outcome`, `provider_result_status`, `regulation_score`, `result_observed_at/finalized_at`,
   `provider_fixture_id`, `capture_source='automatic'`, `settlement_policy_version`. PENDING→PROVISIONAL→FINAL.
   Corrección del proveedor → **nueva versión** (no sobrescribe). Guard §12: `DATA_ERROR` bloquea auto-settle.

## Schedulers / cadencias (§10)

Jobs del orquestador: `closing_capture` (5 min), `settlement` (10 min), `signal_commitment` (**diario**:
`commitmentSweep` commitea el día UTC cerrado —ayer— una vez, gate 00:10 UTC, idempotente por fecha, retry por el
intervalo del job; `SIGNAL_COMMITMENT_INTERVAL_MS=3600000` = chequeo horario; one-shot admin vía `commitDay(date)`;
nunca root vacío; external anchoring OFF).

## Recuperación manual (§8)

Endpoints admin (scope `signal:correct`, reason obligatorio, rate-limited):
`POST /api/internal/registry/signals/:id/recover-closing` y `/recover-settlement` (el admin aporta el marcador
reglamentario como evidencia; el sistema no infiere). Persisten `capture_source='manual_recovery'`, distinguible
de `automatic` en health/UI. No sobrescriben (idempotente). El one-shot de commitment sigue disponible.

## Observabilidad (§9) y health/UI (§11)

Cada sweep devuelve métricas: closing `{eligible, not_due, captured_automatic, captured_manual, unavailable,
retryable, look_ahead_rejected, stale, provider_error, ...}`; settlement `{eligible, provisional,
finalized_automatic, finalized_manual, unresolved, missing_mapping, provider_error, blocked_data_error, ...}`.
`registryAdmin.health().lifecycle` (`sweeps.lifecycleStatus`) distingue automatic vs manual + `result_provider_wired`
+ `fixture_mappings`. UI: card admin Closing/Settlement/Commitments con auto vs manual y empty states.

## Migración 028 (aditiva, post-027)

`signal_event_fixture_mappings`; `signal_closing_snapshots` += `capture_source/best_closing_odds/
best_closing_sportsbook/source_group_count/source_set_count`; `signal_settlements` += `capture_source/
provider_fixture_id`. up/down/re-up verificados.

## Tests (§12)

- `tests/post-shadow-lifecycle-autowiring-db.test.js` — e2e con repos/servicios reales, **31/0**: closing
  automático (consenso no-vig, solo verificados, post-kickoff excluido, idempotente, UNAVAILABLE), settlement
  automático (provisional→final, versionado, idempotente, missing mapping, corrección), variantes (draw/away/
  postponed/cancelled/abandoned/ET-pens), estados admin (data_error/quarantined), manual recovery, commitment
  diario, regresión.
- Sin regresión: registry-lifecycle 41, registry-lifecycle-db 35, signal-registry-db 33, admin-db 27, value 36.
