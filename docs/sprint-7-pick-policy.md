# Sprint 7 — Política de Picks GP

`picks.js`. Categoría inicial **"Pick GP — Strong Value"**. NO se crean Pick GP Modelo/Experimental/opinión/combinadas.
Flujo (§33): `STRONG → candidate → review → approve → revalidate → publish → monitor price → close → settlement`. Estados: candidate/approved/published/price_moved/closed/settlement_pending/settled/void/withdrawn/disputed. Auditado en `pick_publication_history`.
**INVARIANTES**:
- `pick_candidate` se crea **solo** desde STRONG elegible (PASS/WATCH/LEAN → nada).
- `PICKS_AUTO_PUBLICATION_ENABLED` **forzado a false en código** (`picksAutoPublicationBlocked=true`). Nunca auto-publica.
- "No registry signal → no Pick GP" (publish exige registro habilitado).
- Publicar exige flag manual + revalidación (sigue STRONG + cuota ≥ mínima + evento no iniciado).
**Cuota mínima / price moved (§37)**: se publica "Cuota observada: X · Válida desde: Y". Si `current_odds < minimum_acceptable_odds` → estado `price_moved` (NO se borra la pick; no revive sola). Prediction market (§38): "Precio observado / No comprar por encima de" (no wording de cuota mínima para 0–1).
**Días sin picks (§49)**: "Hoy no hay Picks GP" es válido; no se degrada LEAN→STRONG para llenar la página.
