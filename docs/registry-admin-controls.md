# Controles administrativos por señal (Fase G.1)

Controles administrativos sobre señales del Registry verificable, **antes** de crear la primera señal oficial.
Todo interno: no activa closing/settlement/commitments/metrics/picks/público/billing/auto-publicación.

## Principio de inmutabilidad

`signals` es **INSERT-only** (trigger `signal_forbid_mutation`). Ninguna acción administrativa edita la fila
original ni su `registry_hash`/`content_hash`. El estado administrativo vive en una **proyección mutable**
(`signal_admin_state`), las correcciones en una tabla **append-only** (`signal_corrections`, vista efectiva
derivada), y cada acción deja un **audit append-only encadenado** (`signal_admin_actions`).

## Máquina de estados (§4)

Estados: `ACTIVE · QUARANTINED · RETRACTED · CORRECTED · ADMINISTRATIVE_VOID · DATA_ERROR`.

Transiciones permitidas (todo lo demás se rechaza con `invalid_transition`):

```
ACTIVE      → QUARANTINED | RETRACTED | CORRECTED | DATA_ERROR | ADMINISTRATIVE_VOID
QUARANTINED → ACTIVE (restore) | RETRACTED | CORRECTED | DATA_ERROR | ADMINISTRATIVE_VOID
RETRACTED / CORRECTED / ADMINISTRATIVE_VOID / DATA_ERROR → (terminal)
```

Los estados terminales **no** vuelven a `ACTIVE` en silencio. Una restauración excepcional futura exigirá una
acción explícita nueva y auditada. `restore` solo aplica desde `QUARANTINED` y exige referencia a la quarantine.

Visibilidad derivada: QUARANTINED/DATA_ERROR → `hidden`; ACTIVE/RETRACTED/CORRECTED/ADMINISTRATIVE_VOID → `visible`.

## Acciones (§3,§5-9)

| Acción | scope | reason codes | confirmación |
|---|---|---|---|
| QUARANTINE | `signal:quarantine` | DATA_UNDER_REVIEW, MAPPING_UNDER_REVIEW, PROVIDER_ANOMALY, PRICE_ANOMALY, DUPLICATE_SUSPECTED, SECURITY_REVIEW, OTHER | signal ID tipeado |
| RESTORE | `signal:restore` | (motivo libre + quarantine_ref) | signal ID tipeado |
| RETRACT | `signal:retract` | PRE_KICKOFF_INFORMATION_CHANGE, LINEUP_CHANGE, EVENT_RULE_CHANGE, MARKET_NO_LONGER_EQUIVALENT, MAPPING_ERROR, DATA_PROVIDER_ERROR, OPERATIONAL_ERROR, OTHER | **reforzada** `CONFIRM <id>` |
| CORRECT | `signal:correct` | (motivo libre) | **reforzada**; material → superadmin |
| DATA_ERROR | `signal:data_error` | INVERTED_OUTCOME, EVENT_MAPPING_INCORRECT, MARKET_MISMATCH, PROVIDER_QUOTE_CORRUPT, TIMESTAMP_INCORRECT, WRONG_SPORTSBOOK, TECHNICAL_DUPLICATE, INGESTION_FAILURE, OTHER | signal ID tipeado |
| ADMINISTRATIVE_VOID | `signal:void` | **permitidos:** EVENT_MAPPING_ERROR, OUTCOME_MAPPING_ERROR, WRONG_MARKET, WRONG_PERIOD, DUPLICATE_SIGNAL, PROVIDER_DATA_CORRUPTION, TECHNICAL_PUBLICATION_ERROR, EVENT_CANCELLED_OR_INVALID | **reforzada**; post-evento → superadmin |

**Void prohibido** (rechazado con `void_reason_forbidden`): `PICK_LOST, BAD_PERFORMANCE, ADMIN_DISCRETION,
MODEL_CHANGED_MIND, PRICE_MOVED_AFTER_PUBLICATION`. Nunca convertir una pérdida legítima en void.

**Correcciones (§7):** no editan la fila original. Crean fila en `signal_corrections` con `corrected_fields`
(`{campo:{old,new}}`), `is_material`, razón, admin, timestamp, policy/schema version, enlazada al `audit_event_id`.
Campos sensibles: `event, selection, market, period, odds, minimum_odds, sportsbook, published_at`. Campos
**materiales** (`event, selection, market, period, published_at`) → superadmin + confirmación reforzada. La vista
efectiva aplica las correcciones sobre una copia (`effectiveView`), el original queda intacto.

## Doble confirmación (§10)

Toda acción exige: (1) acción, (2) reason code, (3) explicación obligatoria, (4) **signal ID tipeado manualmente**
(`confirm_signal_id` == id de la ruta), (5) advertencia. Las críticas (RETRACT/CORRECT/ADMINISTRATIVE_VOID),
toda corrección material y todo void post-evento exigen además `confirmation_phrase == "CONFIRM <signal_id>"`.

## Autorización (§11)

Roles → scopes (`signal-registry/authz.js`):
- **viewer:** `registry:read, audit:read`
- **operator:** + `registry:pause, signal:{quarantine,restore,retract,correct,data_error,void}`
- **superadmin:** todos (necesario para corrección material y void post-evento)

`401` sin sesión · `403` usuario no admin · `403` admin sin scope · `403` falta superadmin en acción material/post-evento.
Superadmin se resuelve por `REGISTRY_SUPERADMIN_EMAILS` (default `ADMIN_EMAILS`). Auth por token Bearer (sin
cookies → CSRF no aplica). Rate limit admin: 30 acciones/min por admin.

## Audit log encadenado (§12)

`signal_admin_actions` (append-only, UPDATE/DELETE bloqueados por trigger). Campos: `audit_event_id, admin_id,
action, target_type, target_id, reason_code, reason_text, previous_state, new_state, changed_fields, request_id,
session_metadata, created_at_utc` + cadena `previous_audit_hash`/`audit_hash`. `auditChain.verifyChain()` recomputa
los hashes y detecta cualquier manipulación (probado vía bypass del trigger). No guarda secrets ni notas privadas.

## Contrato downstream (§13) — definido, NO activado

`stateMachine.downstreamPolicy(status)` describe el comportamiento futuro de public/alerts/promotion/closing/
settlement/metrics por estado. En esta fase es solo contrato: ningún scheduler de closing/settlement/metrics se activa.

## Endpoints (internos, no públicos · §15)

```
GET  /api/internal/registry/overview                         (registry:read)
GET  /api/internal/registry/signals                          (registry:read)
GET  /api/internal/registry/signals/:id                      (registry:read)
GET  /api/internal/registry/audit                            (audit:read)
POST /api/internal/registry/controls                         (registry:pause)  body.control = pause_writes|resume_writes|hide_public|show_public|kill_switch_on|kill_switch_off
POST /api/internal/registry/signals/:id/quarantine|restore|retract|correct|data-error|administrative-void
```

Gated por `SIGNAL_REGISTRY_ENABLED` (404 si off). Idempotencia por header `Idempotency-Key` (o `idempotency_key`).
Transacción + advisory lock por señal (serializa concurrentes; conflicto → error seguro).

## Migración 026 (aditiva, post-025)

- `signal_admin_state` (proyección mutable; CHECK de estados/visibilidad; `set_updated_at`).
- `signal_corrections` (append-only + trigger de inmutabilidad).
- `signal_admin_actions` += `changed_fields, session_metadata, idempotency_key, previous_audit_hash, audit_hash`
  + índices únicos (idempotency_key, audit_hash) + índice de timeline.

up/down/re-up verificados. `count(signals)=0` → ninguna señal productiva afectada.

## Tests (§17)

- `tests/registry-admin-statemachine.test.js` — puro, 42/0 (state machine, reason codes, doble confirmación, authz, downstream).
- `tests/post-shadow-registry-admin-db.test.js` — DB efímera, 27/0 (acciones e2e, inmutabilidad del original, audit append-only + chain + detección de tamper, idempotencia, concurrencia, regresión).
- `tests/post-shadow-registry-admin-http.test.js` — e2e HTTP, 16/0 (401/403/422, doble confirmación, controles, públicos en 404, audit chain).

Sin regresión: signal-registry 34, signal-registry-db 33, post-shadow-registry-epoch-db 16.
