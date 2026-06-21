# Sprint 0 — Estrategia de identificadores

> Regla de oro: **un ID externo (del proveedor) y un ID interno (canónico) NUNCA son lo mismo y nunca
> se sobrescriben entre sí.** Los títulos, slugs y nombres pueden cambiar; los IDs no.

## 1. IDs internos (UUID, generados server-side)
Se usa **UUID v4** generado por la base de datos (`gen_random_uuid()` de `pgcrypto`) para todas las
entidades internas:

```
provider_id
snapshot_id            (raw y normalized)
ingestion_run_id
canonical_event_id
canonical_market_id
signal_id
mapping_id
```

Motivos:
- Estables y únicos sin coordinación entre procesos.
- No filtran información de orden/volumen (a diferencia de un serial).
- Permiten generar referencias antes de insertar si hiciera falta.

## 2. IDs externos (del proveedor, se guardan tal cual)
El identificador original del proveedor se conserva **sin modificar** en columnas dedicadas:

```
external_event_id      (p.ej. slug de Polymarket, event_ticker de Kalshi, fixture.id de API-Football)
external_market_id     (p.ej. condition_id / market id de Polymarket, ticker de Kalshi)
external_outcome_id    (cuando el proveedor distingue outcomes)
```

Siempre acompañados de `provider_id` (el UUID interno del proveedor). La tripleta
`(provider_id, external_market_id)` es la clave natural de un mercado de un proveedor.

### Separación obligatoria
```
internal_id   ← UUID nuestro, autoritativo
external_id   ← string del proveedor, jamás reescrito
provider_id   ← a qué proveedor pertenece el external_id
```
Nunca se usa un `external_id` como clave primaria interna. Nunca se "traduce" un `external_id`
machacándolo: si cambia, se inserta un registro nuevo y se conserva el anterior.

## 3. IDs canónicos
El `canonical_event_id` / `canonical_market_id` representa la entidad **real** (un partido, un mercado)
independientemente del proveedor que lo ofrezca.

Reglas:
- **No se derivan exclusivamente de texto mutable** (nombre, título, slug). Esos campos se guardan como
  atributos, no como identidad.
- El canonical ID se **almacena persistentemente** (es un UUID en `canonical_events`/`canonical_markets`),
  no se recalcula desde el título en cada request.
- La relación proveedor↔canónico vive en `provider_event_mappings` / `provider_market_mappings`, con
  `equivalence_score`, `mapping_method` y `mapping_version` para auditar **cómo** se decidió la
  equivalencia. (El motor de matching es Sprint 2; en Sprint 0 las tablas existen vacías.)

> Esto resuelve el riesgo R4/R5 de la auditoría (mercados sin ID estable, mapeo por nombre): el
> producto actual mapea por alias de equipo; la nueva capa mapea por UUID canónico persistente.

## 4. Checksums (deduplicación de raw payloads)
Cada `raw_market_snapshot` lleva un `checksum` = hash determinístico **del payload** (p.ej. SHA-256 del
JSON canónico del cuerpo recibido).

- Sirve para detectar que un fetch devolvió **exactamente** lo mismo que el anterior (idempotencia /
  ahorro de escrituras), no para identidad de negocio.
- **No incluye secretos** (ni API keys, ni headers de auth, ni URLs con token): solo el cuerpo de datos.
- Se indexa para búsquedas de duplicados.

## 4b. Observaciones temporales (Sprint 0.1)
El `checksum` **no deduplica observaciones**: 4 lecturas idénticas en 4 momentos = 4 filas (distinto
`id`/`received_at`). No existe `UNIQUE(checksum)`. El cómputo (`database/checksum.js`) es determinístico
sobre el contenido y **excluye** `received_at` y secretos. Ver `sprint-0-data-policies.md §8`.

## 4c. Outcomes y participantes canónicos (Sprint 0.1)
- `canonical_outcomes` (UUID) representa cada resultado posible de un `canonical_market`. Mapeo por
  proveedor en `provider_outcome_mappings` (a lo sumo un `matched` por outcome externo; un `matched`
  debe tener `canonical_outcome_id`).
- `canonical_event_participants` (UUID) generaliza los participantes (`role` es TEXT extensible:
  home/away/candidate/asset/...), preparando deportes y eventos no deportivos sin romper el
  `home_participant`/`away_participant` actual.

## 5. Versionado
Se versiona explícitamente todo lo que puede cambiar de lógica con el tiempo:
- `normalizer_version` en snapshots normalizados.
- `mapping_version` en mapeos.
- `model_version`, `mapping_version`, `rules_version` en señales.

Así una señal histórica siempre se puede reinterpretar con la lógica vigente cuando se emitió.
