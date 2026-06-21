# Sprint 4 — Deep links

`exec-opportunities/deepLinks.js`. Generador **versionado** (`deeplink-1`). Botones separados por plataforma
(nunca uno ambiguo). Override opcional desde `provider_deep_link_templates`.

## Plantillas
- Polymarket: `https://polymarket.com/event/{eventSlug}/{marketSlug}` (verificado) · `…/event/{eventSlug}` (no verificado).
- Kalshi: `https://kalshi.com/markets/{seriesLower}/{ticker}` (verificado) · `…/{seriesLower}` (no verificado).

Fuentes de identificadores (ver auditoría Sprint 1/legacy): Polymarket slug = `db.matchSlugs[fixtureId]`
(patrón `fifwc-{a}-{b}-{fecha}`) + `market.slug` (catálogo); Kalshi `event_ticker`=`KXMENWORLDCUP-26`, market `ticker`.

## Validación (`validateUrl`)
- Solo **HTTPS**.
- **Allowlist** de dominios: `polymarket.com`, `kalshi.com` (host exacto o subdominio).
- Sin credenciales embebidas (`user:pass@`).
- Anti **open-redirect**: rechaza params `url/redirect/next/to/dest/return/continue`.
- Encode seguro de slugs/tickers.
- `verified=true` solo con identificador exacto del mercado; si solo hay evento → `verified=false` (no homepage).

## Comportamiento
- En el detalle, un botón por plataforma. Si una plataforma está **restringida** para el país elegido, no se entrega su URL (botón inhabilitado).
- Al pulsar: se registra `deep_link_clicked` (analítica mínima) y se advierte "Los precios pueden haber cambiado. Revisa nuevamente antes de continuar." No se bloquea la salida.
