# Sportsbook — Source Independence (Bloque F)

`sportsbook-providers/sourceCatalog.js` + seed `source-catalog-seed.js` + tablas mig 022
(`sportsbook_source_metadata` extendida + `sportsbook_source_metadata_history`).

## Estados de verificación
- `verified` — propiedad/independencia documentada públicamente → cuenta como grupo independiente.
- `duplicate_skin` — skin del mismo operador que otra casa → se pliega en su grupo, **no** añade independencia.
- `unverified` — sin evidencia suficiente → **NO** cumple el mínimo para STRONG (no se asume independiente).
- `excluded` — se descarta por completo.

`unknown`/sin catálogo se trata como `unverified` (conservador: nunca cuenta como independiente automáticamente).

## Regla de conteo (la usa STRONG, Bloque J)
`classify(bookCodes, catalog)` → `verified_independence_groups` = nº de `independence_group` DISTINTOS entre
casas `verified` (+ `duplicate_skin` que se pliegan). `máximo un voto pleno por grupo`. STRONG exige
`minIndependenceGroups` (3) **verificados**.

## Versionado y privacidad
Cambios de operador/grupo/verificación **suben `version`** y escriben `sportsbook_source_metadata_history`
(append-only) — los cambios de propiedad quedan versionados. `internal_notes` es **privado** y NUNCA sale en el
DTO público: `publicDTO(classification)` expone **solo** `{ independent_groups: <número> }`.

## Seed (sin inventar relaciones)
Solo se marcan `verified` agrupaciones de operador con propiedad **pública** (Flutter, Entain, Kindred, Betsson,
888/evoke) y los independientes documentados (Pinnacle [sharp_reference], bet365, DraftKings, BetMGM). El resto
del feed → `unverified`. `evidence` guarda el hecho público (no secretos estratégicos). **Cobertura/pendientes:**
las casas del feed no listadas en el seed quedan `unverified` y deben revisarse manualmente antes de contar para STRONG.
Tests: `tests/post-shadow-value-dryrun-db.test.js` (J: 3 grupos verificados).
