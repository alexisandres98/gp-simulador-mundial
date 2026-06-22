# Sprint 5 — Inmutabilidad

Registro con **evidencia de integridad y detección de modificaciones** (no "tamper-proof": la base es de GP).

## Protección a nivel PostgreSQL (migración 013)
Función `signal_forbid_mutation()` → `RAISE EXCEPTION 'registro append-only…'`. Trigger `BEFORE UPDATE OR DELETE`
en: `signals`, `signal_events`, `signal_source_references`, `signal_settlements`, `signal_closing_snapshots`,
`signal_registry_commitments`. **UPDATE y DELETE quedan bloqueados** (verificado en tests).

Solo mutable: `signal_state_projection` (proyección/caché, reconstruible desde eventos).

## Flujo de cambios (sin reescritura)
- Cambio de estado → **signal_event** nuevo (hash-linked).
- Resultado corregido → **signal_settlement versión N+1** (la versión anterior permanece visible).
- Nueva fuente → **signal_source_reference** nueva.
- Dato publicado erróneo (prob/precio/timestamp/modelo) → **NO se corrige**: se marca `disputed` y se explica.

## Sin excepciones administrativas silenciosas
No hay endpoint ni función que haga UPDATE/DELETE de una fila inmutable. Las "correcciones" son siempre
adiciones. La verificación recomputa los hashes y detecta cualquier modificación hecha por fuera (bypass de
trigger como superusuario) — probado en `test:signals-db` ("DETECCIÓN DE MANIPULACIÓN").
