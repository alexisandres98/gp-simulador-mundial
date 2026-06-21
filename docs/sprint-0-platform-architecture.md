# Sprint 0 — Arquitectura objetivo de la plataforma de datos

> Diseño de la nueva infraestructura de oportunidades de GP Simulador. **En el Sprint 0 solo se
> implementa la fundación y el scaffolding** (PostgreSQL, esquema, repositorios, feature flags,
> health check). Los motores (arbitraje ejecutable, Canonical Event Graph, Value Engine, métricas)
> se construyen en los Sprints 1-6 **encima** de esta base, sin reescribir el producto actual.

## Principio rector
La nueva plataforma corre **aislada detrás de feature flags** (`MARKET_DATA_PLATFORM_V2`,
`MARKET_DATA_WRITE_ENABLED`). Con ambas en `false` (default), el producto actual funciona
**exactamente igual**: ninguna ruta pública cambia, ninguna oportunidad se altera, no se escribe nada.

## Diagrama de capas

```
External Providers          Polymarket · Kalshi · API-Football · ESPN · sportsbooks futuros
        ↓
Provider Adapters           auth · requests · WebSockets · rate limits · retries · timestamps
        ↓
Raw Data Storage            payload original EXACTO (JSONB) + checksum + timestamps + latencia
        ↓
Normalization Layer         heterogéneo → formato interno consistente (NUMERIC, versión de normalizador)
        ↓
Canonical Event Graph       conecta eventos/mercados equivalentes entre proveedores (IDs canónicos)
        ↓
Opportunity Engine          arbitraje · fees · slippage · profundidad · tamaño máx · value · confianza
        ↓
Immutable Signal History    congela cada señal publicada (versionada, nunca se borra)
        ↓
Internal API                lectura server-side, admin-only en Sprint 0
        ↓
UI / Email / Telegram / Webhooks
```

## Responsabilidades por capa

### 1. External providers
Fuentes externas de datos **sin transformar**: Polymarket, Kalshi, API-Football, ESPN, sportsbooks
futuros. No es código nuestro; es el origen.

### 2. Provider adapters (`database/` + futuros `collectors/`)
Responsables de **obtener** datos crudos: autenticación, requests REST/WebSocket, rate limits,
retries con backoff, traducción mínima (no normalización de negocio), captura de `provider_timestamp`
y metadatos del proveedor. **Sprint 0**: se define la *configuración* por proveedor (timeout, retries,
backoff, rate limit, TTL) y la tabla `providers`. Los collectors reales son Sprint 1.

### 3. Raw storage (`raw_market_snapshots`)
Almacena **exactamente lo recibido**, en `JSONB`, con `checksum` para detección de duplicados,
`provider_timestamp` + `received_at` + `request_latency_ms` y referencia al `ingestion_run`.
**El payload original nunca se pierde por haber sido normalizado.** Inmutable tras insertarse.

### 4. Normalization layer (`normalized_market_snapshots`)
Convierte datos heterogéneos (Polymarket vs Kalshi vs sportsbook) a un formato interno consistente:
`best_bid`, `best_ask`, `midpoint`, `last_trade`, `spread`, `volume`, `open_interest`,
`available_depth`, todos en `NUMERIC(20,8)`. Cada registro lleva `normalizer_version` y apunta a su
`raw_snapshot_id`. **No sobrescribe** snapshots anteriores: es un historial.

### 5. Canonical Event Graph (`canonical_events`, `canonical_markets`, `provider_*_mappings`)
Más adelante (Sprint 2) conectará eventos y mercados **equivalentes** entre proveedores mediante IDs
canónicos estables y tablas de mapeo con `equivalence_score` y `mapping_status`. **Sprint 0 solo crea
las tablas vacías.** No se implementa matching automático todavía.

### 6. Opportunity Engine (Sprint 3-4, 6)
Más adelante calculará arbitraje neto (con fees/slippage/profundidad), tamaño máximo ejecutable, value
contra consenso no-vig y confianza. **No se implementa en Sprint 0.**

### 7. Immutable Signal History (`signals`, Sprint 5)
Más adelante congelará cada señal publicada con `model_version`/`mapping_version`/`rules_version` y los
`snapshot_ids` que la respaldan. Una corrección genera una **nueva versión**, nunca un borrado.
**Sprint 0 solo crea la tabla.**

### 8. Internal API
Capa de lectura server-side. En Sprint 0 se expone únicamente
`GET /api/internal/platform-health` (admin-only). El resto llega en sprints posteriores.

## Qué entrega el Sprint 0 (scaffolding, no motores)
- ✅ PostgreSQL persistente + pool + SSL + graceful shutdown.
- ✅ Migraciones versionadas con tabla de control.
- ✅ Esquema fundacional (10 tablas) vacío pero extensible.
- ✅ Repositorios server-side parametrizados (sin SQL disperso).
- ✅ Feature flags centralizados.
- ✅ Configuración de resiliencia por proveedor.
- ✅ Logging estructurado + health check admin-only.
- ✅ App actual intacta con flags en `false` y sin `DATABASE_URL`.

## Qué NO entrega (sprints siguientes)
- ❌ Polling continuo / WebSocket collectors (Sprint 1).
- ❌ Snapshots históricos reales (Sprint 1).
- ❌ Matching automático / Canonical Event Graph (Sprint 2).
- ❌ Arbitraje neto, slippage, calculadora de stakes (Sprint 3-4).
- ❌ CLV / ROI / métricas públicas (Sprint 5).
- ❌ Value Engine de consenso no-vig (Sprint 6).

## Hardening Sprint 0.1 (añadido)
- Migraciones nuevas: `005` (observaciones temporales + índices de timeline), `006`
  (`canonical_outcomes` + `provider_outcome_mappings`), `007` (`canonical_event_participants`),
  `008` (`model_analysis_runs`). Total: **12 tablas**.
- `migrate.status()` y el health check son **read-only** (no crean esquema).
- Validación central de feature flags (`V2=false`+`WRITE=true` es inválida → write forzado a false).
- Checksum determinístico que **no** deduplica observaciones temporales.
- GP Intelligence (V2 challenger) endurecido: breakdown por factor, caps por grupo (anti
  double-counting), frescura/procedencia, data quality ≠ model confidence, seed reproducible,
  sanity matemático, versionado y logging experimental aislado. Ver `docs/gp-intelligence-*.md`.

## Convivencia con lo actual
La capa actual (`marketCache`, `arbitrage()`, `data-providers/`) **sigue siendo la fuente de verdad del
producto** durante toda esta fase. La nueva plataforma se construye al lado y solo cuando esté
validada (sprints futuros) se considerará migrar lectura. El Sprint 0 **no** reemplaza nada.
