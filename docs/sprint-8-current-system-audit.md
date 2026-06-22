# Sprint 8 — Auditoría del sistema actual (estado real)

> Documento de auditoría previo a cualquier cambio de código (§5 del prompt de Sprint 8).
> Fecha: jun-22-2026. Regla: **no asumir que un módulo está operativo porque existe el archivo.**
> Verificado leyendo el código en vivo de `server.js`, los `*/scheduler.js`, `*/config.js` y el boot.

## 0. Resumen ejecutivo

GP Simulador es hoy un **monolito Node sin framework** (`server.js`, 1998 líneas) con `pg` como única
dependencia (carga perezosa). Sobre él se montaron 7 sprints como **carpetas-módulo independientes**,
cada una gated por feature flags y conectada al boot de forma best-effort y aislada (`try { ... } catch {}`).

El sistema **funciona** (446 usuarios, ingesta de mercados viva, pipeline de arbitraje en shadow), pero
**NO es operativo en el sentido de Sprint 8**: no hay orquestador central, no hay job registry, no hay
job runs persistidos, no hay heartbeats, no hay detección de procesos abandonados, no hay grafo de
dependencias entre jobs, no hay graceful shutdown, no hay dead letters, no hay circuit breakers, no hay
consola de operaciones, no hay proveedor real de sportsbooks, no hay alertas in-app, no hay onboarding,
no hay analítica de producto/retención, no hay entitlements ni waitlist.

**Resultado de la auditoría: el sistema está en estado `data_shadow / internal` — apto para construir
encima, NO apto para producir Picks GP reales hoy** (falta el proveedor de sportsbooks y 1X2 por partido).

## 1. Stack e infraestructura

| Capa | Estado |
|---|---|
| Runtime | Node ≥18, **sin framework**, HTTP nativo. Dep única: `pg` ^8.22 (lazy require). |
| Persistencia app | `db.json` (un archivo) en disco persistente Render `/data/db.json` (446 usuarios). |
| Persistencia plataforma V2 | PostgreSQL en Render (Oregon), pool perezoso, **migraciones 1–15 aplicadas**. |
| Hosting | Render Starter $7/mes, servicio `srv-d8krl8flk1mc73c9hbi0`, **una instancia** (relevante para locks). |
| Boot | `server.listen(PORT, ...)` arranca legacy + 4 schedulers de sprint. |

**Costes estimados actuales**: Render $7 + Resend $20 + dominio ~$1 ≈ **$28/mes**. Sprint 8 sumaría
The Odds API (gratis para empezar, $30/mes a los 20k créditos) y crecimiento de almacenamiento Postgres.

## 2. Procesos conectados al boot (`server.js:1972-1998`)

| Proceso | Tipo | Gate | Lock | Health | Notas |
|---|---|---|---|---|---|
| `fetchMarkets`/`fetchMatchMarkets` | `setInterval` 60s | ninguno (legacy) | no | no | mercados Polymarket/Kalshi legacy → `db.json` |
| `syncFromESPN` | `setInterval` 30s | ninguno (legacy) | no | no | marcadores en vivo; auto-reparable |
| SSE heartbeat | `setInterval` 25s | ninguno | n/a | n/a | mantiene túneles abiertos |
| auto-ping `/api/version` | `setInterval` 10min | `RENDER_EXTERNAL_URL` | no | no | anti-sleep (legado de plan free) |
| `marketData.initialize()` | Sprint 1 | flags `MARKET_DATA_*` | **sí** (`market-data/locks.js`) | parcial | ingesta histórica + order books |
| `canonical-graph/scheduler` | Sprint 2 | `CANONICAL_*` | **sí** (advisory) | no | matching cada 5min |
| `arb-engine/scheduler` | Sprint 3 | `ARB_ENGINE_*` | **sí** (advisory) | no | evaluación shadow |
| `metrics-engine/scheduler` | Sprint 6 | `METRICS_ENGINE_SCHEDULER_ENABLED` | reusa | no | recálculo incremental |
| `value-engine/scheduler` | Sprint 7 | `VALUE_*`/`PICKS_*` | reusa | no | value + price monitor |

### Jobs que **solo tienen `runOnce`/CLI** (sin scheduler en boot)
- **Closing capture (Sprint 5)**: flag `SIGNAL_CLOSING_CAPTURE_ENABLED` + intervalo existen, pero **el
  scheduler NO está cableado en el boot**. Hoy solo corre por CLI (`signals:capture-closing`). ⚠️
- **Settlement (Sprint 5)**: flag `SIGNAL_SETTLEMENT_ENABLED` + intervalo existen, **scheduler NO en boot**.
  Solo CLI (`signals:settle`). ⚠️
- **Daily registry commitment (Sprint 5)**: solo CLI (`signals:commit-day`). ⚠️
- **market-data discovery/ingestión por proveedor**: dentro de `marketData.initialize()`.

→ **§112 de Sprint 8 (conectar closing/settlement) es trabajo real pendiente, no cosmético.**

## 3. Patrón de scheduler actual (ej. `arb-engine/scheduler.js`)

```js
const state = { started:false, timer:null, running:false, lastRunAt:null };
function start(){
  if (state.started) return { started:true, alreadyRunning:true };
  if (!cfg.flags.schedulerEnabled) return { started:false, reason:'scheduler_disabled' };
  state.started = true;
  state.timer = setInterval(()=>{ tick().catch(()=>{}); }, cfg.params.intervalMs);
  return { started:true };
}
// tick() usa locks.withLock('arb-engine','evaluate', ...)
```

**Lo que YA hay**: gate por flag, `setInterval`, advisory lock anti-solape, flag de `running`.
**Lo que FALTA (Sprint 8 §17)**: no todos exponen `stop()`/`status()`/`runOnce()` de forma uniforme;
no hay `heartbeat_at` persistido; no hay detección de stale; no hay registro de cada run en tabla;
no hay grafo de dependencias (un scheduler corre aunque su dependencia upstream esté caída).

## 4. Concurrencia / locks

- Advisory locks PostgreSQL implementados en **`market-data/locks.js`** (reutilizado por arb, canonical,
  metrics, value) y en **`signal-registry/chain.js`** (inserción de cadena).
- **Render corre una sola instancia hoy** → el riesgo de doble ejecución es bajo PERO el rate limiting
  (`server.js:55`) es **en memoria**, así que no sería seguro multi-instancia (§63).
- No hay `heartbeats` ni detección de "lock huérfano tras crash" formalizada (los advisory locks de sesión
  se liberan al morir la conexión, lo cual ayuda, pero no hay registro de run abandonada).

## 5. Observabilidad

- **Health**: único endpoint `/api/internal/platform-health` (`server.js:1581`, admin). No hay
  `GET /api/health` público liviano (§25). No hay vista de freshness/quota/jobs/dead-letters.
- **Logging**: `database/logger.js` emite JSON estructurado para la capa pg; el resto de `server.js` usa
  `console.log` no estructurado. No hay `request_id` propagado (§27). No hay redacción centralizada.
- No hay métricas internas de latencia (p95) ni SLOs.

## 6. Estado de datos reales vs simulados

| Dato | Estado real |
|---|---|
| Marcadores en vivo (ESPN) | **REAL**, activo. |
| Mercados Polymarket/Kalshi (campeón) | **REAL**, ingesta activa (Sprint 1). |
| Mercados 1X2 por partido | **NO se ingieren** (collectors solo capturan `will-X-win` campeón). |
| Cuotas de sportsbooks | **NINGUNA** — solo prediction markets. `value-engine/sportsbookProvider.js` resuelve a `noneProvider` (`health: unavailable`). |
| Canonical mappings | Reales pero champion-only; matching de Spain/France/etc. score 100. Pipeline arb en shadow, 92 opportunities, 0 Pure Arb rentable (mercados champion eficientes). |
| Señales del registro (Sprint 5) | `signals = 0` (inerte; `SIGNAL_REGISTRY_VERIFIED_EPOCH` sin configurar). |
| Métricas (Sprint 6) | `signals = 0` → sin track record oficial aún. |
| Value/Picks (Sprint 7) | desplegado **inerte** hoy (flags off → rutas 404). |

→ **El bloqueante #1 de Sprint 8 (confirmado): integrar proveedor real de sportsbooks + 1X2 por partido.**

## 7. Contrato del proveedor de sportsbooks (a respetar, de Sprint 7)

`value-engine/sportsbookProvider.js` ya define el contrato provider-agnostic:

```
{ discoverEvents, fetchMarkets, fetchQuotes, normalizeEvent, normalizeMarket, normalizeQuote, health }
```

con `manualProvider` (carga desde payload documentado, para tests/admin) y `noneProvider` (estado real hoy).
`resolveProvider()` devuelve `none` sin `SPORTSBOOK_DATA_ENABLED`.

**Sprint 8 debe**: crear `sportsbook-providers/theOddsApiProvider.js` conforme a este contrato, **extendido**
con `discoverSports()`, `discoverCompetitions()`, `quotaStatus()` (§6), basándose en la **documentación
oficial de The Odds API** (no fabricar endpoints). El Value Engine **no debe acoplarse** al proveedor.

## 8. Alertas, preferencias, onboarding, analítica (estado actual)

- **Alertas (legacy)**: `user.alertPrefs` en `db.json` (`events`, `channels`, `mutedTeams`). Canales reales:
  **email** (Resend/GAS) y **Telegram** (@gpsimulador). Disparadores: código login, inicio, gol, final.
  **NO hay**: `user_alerts`/inbox in-app, `alert_delivery_attempts`, motor de dedup por
  `material_state_version`, quiet hours, timezone IANA. Endpoints `/api/alertprefs`, `/api/mute` (server.js:1410+).
- **Preferencias**: solo `alertPrefs` + `favorites`. No hay capa `user-preferences/` (idioma, país, odds format,
  competiciones, quiet hours).
- **Onboarding**: **inexistente**. El login por email es el único flujo.
- **Analítica**: solo `execOpps.analytics.record()` (Sprint 4, limitado, `server.js:1750`). **NO hay**
  `product_events`, funnels, retención, cohortes, event schema registry.
- **Referrals**: existe sistema legacy (`db.refCodes`, niveles Embajador) en `db.json`, **no en Postgres**,
  sin atribución formal multi-touch ni anti-abuso (§47-49).

## 9. Comercial / entitlements / billing

- **No existe** nada de entitlements, planes, access grants, waitlist Pro, billing abstraction.
- **No hay** Stripe ni checkout ni paywall (correcto — §56 los quiere forzados off).
- El acceso es binario: sesión por email = acceso completo. Durante el Mundial debe seguir gratis.

## 10. Seguridad (estado)

- **Auth**: token de sesión en `db.sessions`; `getUser(req)` resuelve; `isAdmin` por `ADMIN_EMAILS` env
  (server-side, **no** confía en el frontend — bien). Endpoints admin bajo `/api/internal/*` (403/404 gated).
- **Rate limiting**: en memoria (`server.js:55`) — frágil si hubiera multi-instancia (§63).
- **Secrets**: todos por `process.env`. No se imprimen. **Falta** `SPORTSBOOK_PROVIDER_API_KEY`.
- **Headers**: no auditados aún (CSP/HSTS/etc., §64). Cookies/CSRF: pendiente revisar (§65).
- 🔑 Pendientes heredados: rotar API key de API-Football (expuesta); rotar `RENDER_API_KEY` y
  `TELEGRAM_BOT_TOKEN` expuestos en chat el jun-22.

## 11. Backups / restore / retención

- **Backup**: dependemos del backup gestionado de Render Postgres (no probado/documentado por nosotros).
  `db.json` solo en disco persistente (sin export automático). **No hay restore drill** (§67).
- **Retención**: no hay políticas. Tablas crudas (snapshots/order books) crecen sin poda (§70-71).

## 12. Migraciones (estado)

15 migraciones aplicadas (`001`–`015`). Versionadas con `-- +migrate up/down`, tabla `schema_migrations`,
transacciones. Patrón sólido y reutilizable para las nuevas tablas de Sprint 8 (§92).

## 13. Riesgos de activación identificados

1. **Graceful shutdown parcial** → `database/client.js:121` (`hookShutdown`, invocado al crear el pool en
   `getPool`) escucha SIGTERM/SIGINT y cierra el pool, pero **re-emite la señal de inmediato**
   (`process.kill`) y **NO drena los jobs en vuelo** ni detiene los `setInterval`. Un deploy/restart de
   Render puede cortar un job a mitad (runs "colgadas" sin heartbeat). Sprint 8 debe añadir un shutdown
   que detenga schedulers y espere a los ticks activos antes de cerrar. **Alta prioridad.**
2. **closing/settlement no cableados** → el track record real no puede fluir aunque se active Sprint 5.
3. **Rate limit en memoria** → si algún día se escala a 2+ instancias, límites y posible doble ejecución.
4. **Sin proveedor de sportsbooks** → Value/Picks no pueden producir señales reales (bloqueante central).
5. **Sin job registry/observabilidad** → activar flags a ciegas; difícil saber si un job está sano/stale.
6. **`db.json` sin backup automático** → punto único de fallo de los 446 usuarios.

## 14. Dependencias entre jobs (grafo objetivo, hoy implícito)

```
sportsbook ingestion ─┐
polymarket/kalshi   ─┼→ canonical matching → arb evaluation (shadow)
                      └→ canonical matching → value evaluation → pick candidate
                                                   → price monitor → closing → settlement → metrics → commitment
```

Hoy estas dependencias **no se verifican**: el value scheduler corre aunque no haya consenso fresco de
sportsbooks (produciría `no_sportsbook_quotes`, que es seguro, pero no está modelado como `blocked`).

## 15. Conclusión y orden de trabajo propuesto (8A → 8B)

**8A — Operación real y gratuita** (prioridad, en este orden):
1. Orquestador + job registry + `operational_job_runs` + locks/heartbeats/stale + graceful shutdown.
2. `theOddsApiProvider` (doc oficial) + ingesta 1X2 prematch + validación + cuota/rate limit + circuit breaker.
3. Cablear closing/settlement/commitment + freshness contract + degradación segura + dead letters.
4. Observabilidad: `/api/internal/operations/*`, `/api/health`, logging estructurado + request_id, alertas operativas.
5. Alertas de usuario (in-app→email/Telegram) + preferencias + quiet hours + onboarding.
6. Analítica de producto + funnel + retención + referrals (Postgres).

**8B — Preparación comercial** (sin activar nada):
7. Entitlements + planes + access grants + waitlist Pro + billing abstraction (noop) + flags forzados off.
8. Competition registry + shadow post-Mundial.

**Restricciones globales mantenidas**: no tocar Elo/Poisson/DC/Monte Carlo/GP Intelligence/señales/hashes/
settlements previos; no auto-publicación; no billing; acceso gratis durante el Mundial; **STOP antes de
deploy, sin commit/push, reporte primero.**
```

