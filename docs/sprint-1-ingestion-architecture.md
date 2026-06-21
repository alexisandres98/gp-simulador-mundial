# Sprint 1 — Arquitectura de ingesta (decisión)

> Decisión sobre cómo capturar los datos para el histórico, tras auditar el código real.

## Opciones evaluadas
- **A — Collectors independientes:** la nueva capa hace sus propias requests. Ventaja: desacoplamiento total. Riesgo: duplicación de requests.
- **B — Captura secundaria del response actual:** `fetchMarkets`/`fetchMatchMarkets` entregan una copia best-effort a la nueva capa. Ventaja: menos requests. Riesgo: acoplamiento; un fallo de escritura podría tocar la ruta crítica.

## Decisión: **Opción A (collectors independientes)** — con un matiz
Se eligen collectors independientes por estos criterios (en orden de peso):

1. **Cero regresión / aislamiento (no negociable).** El requisito dice: *"un fallo de PostgreSQL o del collector V2 no debe romper el flujo existente"*. Con A, los collectors viven en `market-data/` y **nunca** tocan `fetchMarkets`/`arbitrage`. La opción B obliga a insertar un dual-write dentro de la ruta crítica de producción.
2. **Los order books REQUIEREN requests nuevas de todas formas.** El flujo actual no consulta CLOB `/book` ni Kalshi `/orderbook`; B no ahorraría esas requests. El ahorro de B se limitaría al snapshot de precio, que es una fracción.
3. **Universo pequeño → duplicación marginal.** 1 mercado de campeón + un puñado de partidos rastreados + sus order books, cada 30–60 s, está muy por debajo de los rate limits (ver provider-audit). El coste de duplicar el snapshot de precio es bajo y acotado.
4. **Futuro WebSocket más limpio.** Con A, el collector es dueño del ciclo de vida del dato; migrar a WS (Sprint futuro) no toca el flujo legacy.
5. **Auditabilidad.** Cada request de la nueva capa queda en `ingestion_runs` con su latencia/errores, sin mezclarse con el polling legacy.

**Matiz aceptado:** se reutiliza el **universo** que el sistema actual ya conoce (slug `world-cup-winner`, `db.matchSlugs`, `KXMENWORLDCUP-26`) como semilla del **catálogo** (`provider_market_catalog`), pero las **requests de datos** las hace la nueva capa. No se lee `marketCache` para datos (evita acoplar estados en RAM).

## Shadow mode
```
[Flujo legacy]  fetchMarkets/arbitrage → marketCache (RAM) → oportunidades/SSE/Telegram/email   (INTACTO)

[Capa V2]  scheduler → collector (REST) → raw_snapshot → normalizer(vN) → normalized_snapshot
                              → orderbook levels → ingestion_run → freshness → metrics            (SOLO ALMACENA)
```
- La V2 **solo** consulta/almacena/normaliza/mide. **No** alimenta endpoints públicos, **no** cambia oportunidades, **no** hace dual-write en funciones críticas.
- Todo gated por flags (`MARKET_DATA_PLATFORM_V2` + `MARKET_DATA_WRITE_ENABLED` + flags por proveedor). Con escritura apagada: cero writes. Sin `DATABASE_URL`: la capa ni se inicializa.
- Cualquier excepción de la V2 se captura y registra; **nunca** se propaga al proceso principal.

## Estructura de módulos
```
market-data/
  index.js          # orquestación + arranque condicional por flags
  config.js         # flags por proveedor, intervalos, límites, profundidad de book
  scheduler.js      # start/stop/runOnce/status, anti-solape
  locks.js          # advisory locks de Postgres por (provider+job)
  freshness.js      # fresh/aging/stale/unknown
  metrics.js        # contadores en memoria + cálculo de tasas
  pipeline.js       # request→raw→normalize→orderbook→run→freshness→metrics
  providers/
    polymarketCollector.js   # discoverMarkets/fetchMarketSnapshot/fetchOrderBook/health
    kalshiCollector.js
  normalizers/
    polymarketNormalizer.js   # versión 'polymarket-normalizer-1'
    kalshiNormalizer.js       # versión 'kalshi-normalizer-1'
  repositories/
    catalogRepository.js
    orderbookRepository.js
  fixtures/         # respuestas sanitizadas (sin tokens) para tests/volumen
```
Reutiliza `database/` de Sprint 0/0.1 (client, checksum, repositorios de raw/normalized/ingestion_runs).
