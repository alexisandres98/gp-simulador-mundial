# Ciclo de vida interno: closing, settlement, commitments (Fase H)

Construye el ciclo de vida de una señal del Registry verificable **antes** de la primera señal oficial.
Todo interno: Metrics oficiales, Picks, price monitor, alertas, Registry/Value público, billing y
auto-publicación siguen OFF. V1 = modelo oficial; V2 = challenger peso 0.

## 2.1 Audit anchor (bridge pre-026)

La acción histórica `epoch_activation` (creada en Fase G, `audit_hash=null`) quedó fuera de la cadena
administrativa de G.1. **No se modifica.** Se crea un anchor append-only en `signal_admin_chain_anchors`
(`bridgePreChainAnchors()`) que:
- referencia su `audit_event_id`;
- guarda `content_hash` = hash determinístico de su contenido inmutable;
- guarda `anchor_hash` = eslabón genesis efectivo;
- marca `bridge_kind='pre_chain_genesis'`.

`verifyChain()` ahora valida **primero los anchors** (recomputa el contenido de la fila histórica → detecta
alteración) y **luego** la cadena, encadenando desde el anchor. Así el `epoch_activation` histórico es el
primer elemento verificable. No se fabrica timestamp anterior.

## Closing (§3-7)

**Eligibilidad (§4)** — `lifecycleEligibility.closingEligible`: una futura señal recibe closing solo si pertenece
al Verified Epoch activo, es oficial (verified, no experimental/legacy), tiene canonical event + market + period +
outcome, `published_at < kickoff`, provider mapping válido, y NO es pre-epoch / internal_validation(_pre_epoch) /
shadow / v2_diagnostic / challenger / draft/candidate.

**Captura (§5)** — `closingCapture.captureClosing`, idempotente por `(signal_id, benchmark_type)`. Campos:
canonical_event/market/period/outcome, closing_odds/probability, closing_source, provider_updated_at, observed_at,
kickoff_at, closing_status, closing_reason_code, closing_policy_version, clv_components.

**Anti-look-ahead (`closingPolicy.classifyCapture`)** — `provider_updated_at <= kickoff` (estricto) y
`observed_at <= kickoff + tolerancia técnica` (default 0, solo latencia de persistencia). Estados:
`AVAILABLE · UNAVAILABLE · STALE · MARKET_SUSPENDED · EVENT_STARTED · MAPPING_ERROR · NO_EQUIVALENT_MARKET ·
PROVIDER_ERROR`. Una quote con precio pero post-kickoff se **rechaza** (`look_ahead_rejected`); sin dato confiable
pre-kickoff → `UNAVAILABLE` (no se interpola).

**Closing oficial (§6)** — `closing_policy_version='closing-policy-1'`, fuente oficial **`consensus_no_vig`**
(consenso no-vig de grupos independientes verificados, último set completo válido antes del kickoff).
best_sportsbook / por-sportsbook se conservan como referencia, no como oficial.

**CLV (§7)** — `clvComponents` persiste `entry_implied_probability = 1/published_odds`,
`closing_implied_probability = 1/closing_odds`, fuente y policy version. La **métrica CLV oficial NO se calcula ni
expone** (Metrics off); solo se guardan componentes reproducibles, sin mezclar best-price con consensus ni
vigged con no-vig sin etiquetar.

## Settlement (§8-12)

**Provider (§9)** — `settlementProvider` (auditado): fuente **ESPN scoreboard** (mismo poller del producto,
`syncFromESPN`), event mapping canonical→fixture, status mapping (post→final, in/live→provisional, pre→pending),
**solo marcador de tiempo reglamentario** (sin prórroga ni penales), latencia ~2 min. Sin resultado verificable →
`UNRESOLVED`. Resolución manual futura = acción admin auditada.

**Lifecycle (§10)** — `PENDING → PROVISIONAL → FINAL`. No se finaliza si el proveedor marca provisional. Se guardan
`provider_result_status`, `result_observed_at`, `result_finalized_at`, `regulation_score`, `result_outcome`
(home/draw/away/void/unresolved), `settlement_policy_version='settlement-policy-1'`. Estados: pending, provisional,
final, won, lost, void, push, cancelled, postponed, abandoned, unresolved, corrected.

**Correcciones (§10)** — el proveedor que corrige el marcador NO sobrescribe: `settle` crea una **nueva versión**
(idempotente por `(source, source_reference)`), preservando las previas.

**Eventos especiales (§11)** — postponed → `postponed` (no liquida); cancelled → `cancelled`/void; abandoned →
`unresolved`; changed kickoff → recapturar ventana de closing (published_at NO cambia); duplicate event → bloquear
settlement + DATA_ERROR + intervención admin.

**Estados administrativos (§12)** — ACTIVE: closing+settlement permitidos. QUARANTINED: captura factual permitida
(preservar evidencia), sin exposición. RETRACTED: closing/resultado factual se conservan. CORRECTED: vista efectiva
usa la corrección. DATA_ERROR: `settleFromProvider` **bloquea** liquidación automática (`blocked_data_error`).
ADMINISTRATIVE_VOID: settlement administrativo distinto del resultado deportivo (ambos coexisten).

## Commitments (§15-16)

`commitDay` (merkle, `signal-registry/index.js`): incluye **solo señales oficiales elegibles**
(`commitmentEligible`: excluye pre-epoch / internal_validation / v2 diagnostics / legacy / no-score-eligible).
Determinístico e idempotente (`UNIQUE(commitment_date)`), guarda root + rango de secuencias + leaf count +
algoritmo. Con 0 elegibles → `skipped: no_eligible_signals`; con 0 señales → `no_signals`. **No fabrica un root
que parezca contener señales.** Commitments previos inmutables (trigger append-only).

**Anclaje externo (§16) = OFF.** Tabla `signal_commitment_external_anchors` (status default `disabled`) define el
contrato futuro (destination, external_timestamp, transaction_ref, status, retries, proof). Sin scheduler, sin
fondos, sin transacciones.

## Schedulers (§14) — nombres reales del repo

Jobs del orquestador (`operations/jobRegistry.js`): `closing_capture` (flag `SIGNAL_CLOSING_CAPTURE_ENABLED`),
`settlement` (`SIGNAL_SETTLEMENT_ENABLED`), `signal_commitment` (`SIGNAL_REGISTRY_WRITE_ENABLED` &&
`SIGNAL_REGISTRY_ENABLED`). Para correr: flag on + job en `OPERATIONS_MANAGED_JOBS` + orquestador on. Activación
**secuencial** H-A → H-B → H-C. Con signals=0: ejecutan sanos, reportan 0 eligible, sin datos sintéticos. Los
sweeps son HONESTOS (sin fuente automática enlazada → identifican elegibles; captura/liquidación efectiva manual/CLI).

## Health (§17) y UI (§18)

`registryAdmin.health().lifecycle` (`sweeps.lifecycleStatus`): scheduler flags + closing_eligible/captured/
unavailable + settlement_pending/finalized/unresolved + commitment_count + last_commitment_root. UI: card admin con
Closing / Settlement / Commitments y empty states reales (signals=0). Sin secrets ni payloads privados.

## Migración 027 (aditiva, post-026)

`signal_closing_snapshots` += closing_status/odds/probability/source/provider_updated_at/kickoff_at/reason_code/
policy_version/clv_components/canonical/market/period/outcome; `signal_settlements` += result_outcome/
provider_result_status/result_observed_at/result_finalized_at/regulation_score/settlement_policy_version + CHECK
extendido; `signal_admin_chain_anchors`; `signal_commitment_external_anchors`. up/down/re-up verificados.

## Tests (§19)

- `tests/registry-lifecycle.test.js` — puro, 41/0 (eligibility, anti-look-ahead, resolver settlement, merkle, downstream).
- `tests/post-shadow-registry-lifecycle-db.test.js` — DB efímera, 35/0 (closing e2e, settlement lifecycle/idempotencia/
  concurrencia/correcciones, estados admin, commitments determinístico/idempotente/elegibilidad/inmutabilidad, regresión).

Sin regresión: signal-registry 34, signal-registry-db 33, registry-admin-statemachine 42, registry-admin-db 27,
registry-epoch-db 16, metrics-engine-db 18, value-engine 36.
