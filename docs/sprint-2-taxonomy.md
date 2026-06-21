# Sprint 2 — Taxonomía canónica

> `canonical-graph/taxonomy.js`. Versionada (`taxonomy-1`). Extensible: la lógica usa constantes +
> metadata, no enums rígidos. Clasificación determinística desde título + reglas normalizadas.

## Event type
`sports_match` · `sports_tournament` · `sports_stage` · `election` · `price_event` ·
`economic_event` · `entertainment_event` · `other`. **En este sprint:** principalmente
`sports_match` y `sports_tournament`.

## Event scope
`match` · `tournament` · `stage` · `team` · `player` · `season`.

## Market family
`match_winner` · `match_1x2` · `qualify` · `tournament_winner` · `binary_event` · `total` · `btts` ·
`handicap` · `other`. **Prioritarios:** tournament_winner, match_winner, match_1x2, qualify, binary.

## Period (clave para precisión)
`regulation_90m` · `full_match_including_extra_time` · `first_half` · `second_half` · `tournament` ·
`season` · `unspecified`. **Si las reglas no lo declaran → `unspecified` (nunca se asume 90m).**

## Outcome type
`home` · `draw` · `away` · `yes` · `no` · `team` · `participant` · `over` · `under` · `other`.

## Settlement modifiers (en normalized_rules + metadata)
`includes_extra_time` · `includes_penalties` · `draw_possible` · `qualification_market` ·
`dead_heat_rule` · `void_if_postponed` · `void_if_abandoned` · `postponement_window` ·
`reschedule_policy` · `resolution_source` · `resolution_deadline`.
No se fuerzan a enums: se guardan normalizados + las reglas originales + metadata extensible.

## Clasificación (heurística determinística, conservadora)
- `qualify`: reglas `qualificationMarket` o texto "to qualify/advance/reach".
- `tournament_winner`: "win the world cup/tournament/title".
- `match_1x2`: reglas `drawPossible` o texto "1x2/match result/draw".
- `match_winner`: "moneyline/match winner/to win the match".
- `total`/`btts`/`handicap`: por palabras clave.
- Señales mixtas o insuficientes → `binary_event`/`other` (no se adivina).

## Extensibilidad futura (preparada, sin mappings automáticos aún)
- totals, BTTS, handicap, props; otros deportes; eventos no deportivos. La taxonomía ya los contempla;
  el matching automático completo de esos tipos es trabajo posterior.
