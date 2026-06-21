# Sprint 2 — Normalización de reglas

> `canonical-graph/ruleNormalizer.js` (`rule-normalizer-1`) + `ruleFingerprint.js` (`rule-fp-1`).
> Tabla `provider_market_rule_snapshots` (raw + normalizadas + fingerprint, versionado, append-only).

## Qué se captura (semántica, no texto)
De título + description/rules del proveedor → `normalized_rules`:
`marketPeriod` (regulation_90m / full_match_including_extra_time / first_half / second_half / tournament /
unspecified), `includesExtraTime`, `includesPenalties`, `drawPossible`, `qualificationMarket`,
`settlementTrigger` (match_result / qualification), `resolutionSource`, `postponementPolicy`,
`abandonmentPolicy`, `voidConditions`, `ambiguousTerms`.

## Conservador (no adivina)
- Negaciones: `"no penalties"`/`"no draw"`/`"two-way"` → `false` (no se confunde con `penalties`/`draw`).
- Si no puede determinar una condición material → `null` y la añade a `ambiguousTerms` (`period_unspecified`,
  `draw_unspecified`, `resolution_source_unknown`, `rules_missing`).
- **El título NO basta**: se usan reglas/description; si faltan → `rules_missing` → el mercado va a revisión.

## Fingerprint
- Determinístico sobre los campos **materiales** (periodo, prórroga, penales, empate, qualify, trigger,
  resolución, postponement). **Estable ante reformateo** (espacios/mayúsculas colapsados); **cambia** si
  cambia una condición material. Versionado (`rule-fp-1:sha256:...`).
- Si las reglas cambian → nuevo snapshot + nuevo fingerprint + nueva evaluación de equivalencia
  (no se sobreescribe la versión anterior).
