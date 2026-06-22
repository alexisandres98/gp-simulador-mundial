# Sprint 5 — Hashing y cadena

## Canonicalización (`canonicalize.js`)
Serialización determinística: claves ordenadas recursivamente, `undefined` omitido. **Mismo contenido lógico →
misma cadena**, aunque cambie el orden de claves JSON (verificado).

## content_hash (`hashing.contentHash`)
SHA-256 sobre el material canónico: `signal_type, schema_version, canonical ids, direction, timestamps
(event_start/market_close/source_created/published/input_cutoff), versiones (model/methodology/mapping/rules/normalizer),
prediction_edition, supersedes, signal_payload, public_payload, source_references (tipo/id/versión/hash/timestamp)`.
**No incluye**: secretos, tokens, campos mutables de proyección, hashes de cadena.

## Cadena global (§14)
```
registry_hash = SHA256( previous_registry_hash + "|" + content_hash + "|" + chain_position )
```
Genesis documentado: `genesis:gpsimulador:signal-registry:v1` (previous de la posición 1).

### Concurrencia
Inserción dentro de una transacción con `pg_advisory_xact_lock(CHAIN_ADVISORY_LOCK)`: se lee la cabeza
(max chain_position + su registry_hash), se calcula la nueva posición y el hash, se inserta. Dos señales
concurrentes **nunca** reciben la misma posición ni un previous_hash incorrecto. Probado con 8 inserts
concurrentes → posiciones únicas y contiguas, cadena válida.

## Eventos (hash-linked por señal)
`event_hash = SHA256( previous_event_hash + "|" + canonical(event_core) )`. Primer evento parte de genesis.

## Daily commitments (§15)
`root_hash = merkleRoot(registry_hash de las señales del día)` (duplica el último si nivel impar). Algoritmo
`merkle-sha256-v1`. Idempotente por `commitment_date`. Reproducible; cambia si cambia cualquier señal del día.
**No** afirma notarización externa: verifica consistencia interna diaria (root exportable a futuro).

## Verificación (`verifier.js`)
- `verifySignal`: recomputa content_hash y registry_hash; valida la cadena de eventos.
- `verifyChain`: recorre por `chain_position`; detecta hash modificado, previous incorrecto, posición faltante/duplicada.
