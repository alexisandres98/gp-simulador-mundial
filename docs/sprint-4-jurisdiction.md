# Sprint 4 — Disponibilidad por jurisdicción

`exec-opportunities/jurisdiction.js` + tabla `provider_jurisdiction_rules`. **Capa informativa, no legal.**

## Estados
`available | restricted | unknown | requires_provider_verification`. Sin regla para un par
proveedor/país → `requires_provider_verification` (no asumir acceso).

## Combinado por oportunidad (§21)
- Ambas `available` → **available** (mostrar deep links; verificar igualmente con la plataforma).
- Alguna `restricted` → **restricted** ("una de las plataformas puede no estar disponible en tu jurisdicción"; no ejecutable personalizado; deep link restringido inhabilitado).
- Si no, → **requires_provider_verification** ("verifica tu elegibilidad directamente con la plataforma").
- País no elegido → **unknown** (pide seleccionar país).

## Reglas
- Versionadas (`version`), con `source_url` y `source_checked_at` cuando exista.
- **No** afirma "legal" como certeza absoluta. **No** sugiere VPN. **No** infiere país solo por IP.
- V1: **selector manual de país** (no geolocalización precisa). El país elegido se guarda en `localStorage`.

## Seed
`SEED_RULES` es un punto de partida informativo y conservador (p.ej. Polymarket/US restringido, Kalshi/US
disponible — verificar con la plataforma). Las reglas reales se mantienen en DB con fuente y fecha.
**Nada aquí es asesoría legal.**
