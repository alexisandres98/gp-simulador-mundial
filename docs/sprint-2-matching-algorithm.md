# Sprint 2 — Algoritmo de matching

> Pipeline: extraer descriptores → generar candidatos → match EVENTO → MERCADO → OUTCOME.
> **Precisión-primero: un hard conflict SIEMPRE prevalece sobre el score textual.**

## Arquitectura
```
catálogo + reglas → semanticExtractor → candidateGenerator → eventMatcher → marketMatcher → outcomeMatcher → review/mappings
```
Módulos en `canonical-graph/`: taxonomy, participantAliases, semanticExtractor, ruleNormalizer,
ruleFingerprint, candidateGenerator, scoring, conflicts, eventMatcher, marketMatcher, outcomeMatcher,
review, metrics, config. Versionado: taxonomy-1, alias-1, rule-normalizer-1, rule-fp-1, event/market/outcome-matcher-1.

## Candidate generation (anti O(n²))
Bucket por evento: torneo = `sport|competition|season|category`; partido = `+participantes|día`.
Solo se comparan descriptores del mismo bucket (entre proveedores). 48×48 campeón → ~19 ms.

## Scoring (pesos centralizados en config)
- **Evento partido (suma 100):** participantes 55 + competición 20 + proximidad kickoff 20 + temporada 5.
- **Evento torneo:** competición 60 + temporada 40.
- **Mercado:** familia 40 + periodo 25 + fingerprint de reglas 25 + fuente de resolución 10.
- Devuelve `{ score, evidence[] }`. Nunca caja negra.

## Hard conflicts (conflicts.js)
- **Rejecting (→ rejected):** SPORT, CATEGORY (género/edad), TOURNAMENT_VS_MATCH, COMPETITION, SEASON,
  PARTICIPANTS_INCOMPATIBLE (solo si ambos completos), STAGE, DATE_TOO_FAR, FAMILY_MISMATCH,
  DRAW_MISMATCH (empate sí/no), PERIOD_HALF_MISMATCH (mitad vs completo), OUTCOME_PARTICIPANT_MISMATCH,
  MARKET_STATUS_CONFLICT (cerrado vs abierto).
- **Differencing (→ conditional):** PERIOD_MISMATCH (90m vs prórroga), OUTCOME_WIN_VS_QUALIFY,
  PENALTIES_MISMATCH, CANCELLATION_MISMATCH (postponement). Misma exposición, diferencia material.

## Decisión (scoring.decide)
1. Hay rejecting hard conflict → **rejected**.
2. Faltan datos críticos (participantes en evento / reglas en mercado) → **needs_review**.
3. Hay differencing hard conflict → **conditional** (nunca matched).
4. `score ≥ matchThreshold` (95) → **matched**.
5. `score ≥ reviewThreshold` (75) → **needs_review**.
6. Si no → **rejected**.

## Outcome matching
NO asume `YES = home`. El YES se deriva del **outcomeParticipant** del contrato. YES↔YES = mismo
participante → matched; participantes distintos → rejected (OUTCOME_PARTICIPANT_MISMATCH).

## Explicabilidad
Cada resultado devuelve `{ status, score, conflicts[], evidence[], version, explanation }`.
