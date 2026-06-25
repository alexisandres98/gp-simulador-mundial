# Sportsbook → Canonical Event Graph (Bloque G)

`sportsbook-providers/sportsbookCanonical.js`. Conecta `sportsbook_quote_current` al Canonical Event Graph.
**`CANONICAL_AUTO_MATCH_ENABLED=false` en esta fase:** se generan candidates y se llena la review queue, pero
**no se aprueba automáticamente** (`generateCandidates({autoMatch:true})` lanza `auto_match_forbidden`).

## Pre-requisito (R10): sembrar participantes
`graphRepo.seedParticipants()` **nunca se había invocado** → `participants:0, aliases:0` → matching 0.
`sportsbookCanonical.seedParticipants()` lo ejecuta (48 selecciones + alias validados, idempotente).

## Flujo
```
current state (por evento) → buildSportsbookEvents → validateEvent → review queue (needs_review)  [auto-match OFF]
                                                                  ↘ rechazo (hard) → decision 'rejected'
APROBACIÓN MANUAL (auditoría §18) → approveEvent → canonical_event + provider_event_mappings(matched) + enlaza quotes
```

## Validaciones (`validateEvent`)
- **Hard reject:** `not_1x2`, `not_regulation`, `live`, `event_started`, `participants_identical`.
- **A review (blando):** `competition_unknown`, `kickoff_unknown`, `home_unresolved`, `away_unresolved` (alias no
  sembrado → revisión, no rechazo automático).
El normalizer ya excluye prórroga / "to qualify" / doble oportunidad / moneyline de 2 vías aguas arriba.

## Persistencia
La review queue usa `entity_type='event'` con `provider_a='the_odds_api'` (el `entity_type` del grafo está acotado
a event|market|outcome; el origen sportsbook se marca por `provider_a` y metadata). Cada decisión se registra en
`mapping_decision_history`. **Una quote sin `canonical_event_id` (no matched) no llega a consenso ni Value.**
`approveEvent` crea el `canonical_event`, enlaza `canonical_event_id` en current+history y registra
`provider_event_mappings` (`mapping_status='matched'`, `mapping_method='manual'`). Tests:
`tests/post-shadow-canonical-db.test.js` (15/15).

> **No aprobar mappings masivamente durante la construcción** — la auditoría manual de ≥30 eventos
> (`second-shadow-plan.md` §auditoría) entrega una lista para revisión humana.
