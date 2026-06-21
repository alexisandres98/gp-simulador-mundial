# Sprint 2 — Normalización de participantes

> `canonical-graph/participantAliases.js` + tablas `canonical_participants` / `participant_aliases`.
> Determinística, basada en alias EXACTO (NO fuzzy). Equipos distintos NO colisionan.

## Normalización
`normalizeAlias(s)` = minúsculas + sin acentos (NFD) + sin puntuación + espacios colapsados.
Ej.: `"  ESPAÑA!! "` → `espana`; `"U.S."` → `u s`.

## Resolución (prioridad)
1. **Alias específico del proveedor** validado (DB) — máxima prioridad.
2. **Alias validado global** (selección oficial + extras conocidos: USA/USMNT/U.S., South Korea/Korea Republic, etc.).
3. Desconocido o ambiguo → **`null`** (NO fuzzy, NO unión automática) → va a revisión.

## Anti-colisión
- `buildSeedTable()` detecta si dos selecciones generan el mismo alias normalizado → marca **ambiguo**
  y NO lo usa para resolver. `collisions()` los lista (verify).
- Índice DB `uq_alias_validated_global`: a lo sumo UN alias validado global por texto normalizado.
- Seed idempotente; alias ya reclamado por otro equipo → skip conservador (no se asigna a dos equipos).

## Datos
- `canonical_participants`: 48 selecciones (UUID, country_code = código FIFA, sport).
- `participant_aliases`: alias validados (oficial) + futuros alias por proveedor (FK provider).
- `canonical_event_participants.canonical_participant_id` enlaza el participante del evento al canónico.

## Reglas duras
- Mayúsculas/espacios/puntuación/diacríticos normalizados; códigos FIFA aceptados.
- Los alias **validados manualmente** tienen prioridad sobre cualquier heurística.
- NO confiar solo en similitud textual; equipos con nombres parecidos pero distintos NO se unen.
