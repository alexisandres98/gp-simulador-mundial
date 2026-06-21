# Sprint 0 — Auditoría del estado actual

> Fotografía técnica de cómo fluyen HOY los datos en GP Simulador, antes de construir la nueva
> infraestructura de oportunidades. **No describe lo que se va a construir** (eso está en
> `sprint-0-platform-architecture.md`), sino lo que existe a la fecha de este sprint.

Fecha: jun-2026 · Commit base: rama `main` · Stack: Node puro (sin dependencias npm), HTTP nativo.

---

## 1. Arquitectura actual

### Punto de entrada
- **`server.js`** (~1.575 líneas) — un único servidor `http.createServer` nativo. No hay framework.
- `loadDotEnv()` (IIFE al inicio): lee `.env` manualmente línea a línea y rellena `process.env`
  solo si la variable no está ya definida. Nunca lanza (no debe impedir el arranque).
- `PORT = process.env.PORT || 3000`. `N_SIMS = process.env.SIMS || 10000`.

### Módulos (todos server-side, sin build step)
| Archivo | Responsabilidad |
|---|---|
| `server.js` | HTTP, rutas API, jobs (timers), mercados, arbitraje, auth, alertas, SSE |
| `engine.js` | Modelo: Elo → Poisson → Dixon-Coles → calibración → Monte Carlo. **NO se toca.** |
| `data/tournament.js`, `data/fixtures-real.json` | Equipos, grupos, fixtures, KO |
| `mailer.js` | Email (Resend Pro + fallback relay Google Apps Script) |
| `telegram.js` | Publicación al canal `@gpsimulador` |
| `data-providers/` | Capa contextual: API-Football → ESPN → manual (providers + cache + normalizer + gpTake + gpIntelligence) |
| `public/` | Frontend vanilla (`index.html`, `app.js`, `style.css`) — SSE + fallback polling |

### Rutas API (todas en `server.js`)
`/api/state`, `/api/stream` (SSE), `/api/ticker`, `/api/version`, `/api/arbitrage`,
`/api/aciertos`, `/api/h2h`, `/api/h2h/deep`, `/api/match/:id`, `/api/team/:id`,
`/api/teamdetail/:id`, `/api/me`, `/api/favorite`, `/api/mute`, `/api/alerts`,
`/api/alertprefs`, `/api/auth/request`, `/api/auth/verify`,
`/api/admin/*` (result, users, broadcast, refresh-markets, telegram-test, telegram-daily).

### Jobs automáticos (timers en `server.listen`)
| Job | Frecuencia | Efecto |
|---|---|---|
| SSE heartbeat | 25 s | mantiene viva la conexión `/api/stream` |
| `fetchMarkets(true)` + `fetchMatchMarkets(true)` | 60 s | refresca mercados Polymarket/Kalshi → `broadcast('markets')` → `tgTick()` |
| `syncFromESPN()` | 30 s | marcador en vivo → escribe `db.results`, dispara alertas |
| keep-alive ping a `/api/version` | 10 min | evita que Render free duerma (solo si `RENDER_EXTERNAL_URL`) |

### WebSockets
**No existen.** El tiempo real es **SSE** (server→cliente vía `/api/stream`), con fallback a polling
cada 10 s en el frontend. Polymarket/Kalshi se consultan por **REST con polling**, no por WS.

### Integraciones externas
| Fuente | Uso | Endpoint |
|---|---|---|
| **Polymarket (Gamma)** | precio campeón + por partido | `gamma-api.polymarket.com/events?slug=...`, `/public-search` |
| **Kalshi** | precio campeón | `api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXMENWORLDCUP-26` |
| **API-Football** | contexto (alineaciones, forma, lesiones, plantilla) | `v3.football.api-sports.io` (key en env) |
| **ESPN** | marcadores en vivo + noticias | `site.api.espn.com/.../fifa.world/scoreboard` |
| **Manual** | último fallback | `data/manual/*.json` |

### Auth
- `getUser(req)`: lee `Authorization: Bearer <token>` → `db.sessions[token]` → email →
  `{ email, ...db.users[email], isAdmin }`. Sin token = solo teaser.
- `isAdmin(email)`: compara contra `ADMIN_EMAILS` (env, CSV).
- Login por email + código de 6 dígitos (`/api/auth/request` → `/api/auth/verify`).

### Alertas
- **Email** (`mailer.js`): código de login, resultado final, inicio de partido, gol. Gated por
  `alertPrefs`, dedup en `db.sentAlerts`.
- **Telegram** (`telegram.js`): resumen diario, oportunidades fuertes, resultados. Dedup en `db.sentTg`.

### Track record
- `/api/aciertos` (público): `trackRecord()` calcula aciertos con Elo pre-partido + closing line desde
  `db.marketSnapshots`. Se computa **al vuelo** en cada request.

---

## 2. Almacenamiento actual: qué sobrevive y qué no

### Persistente — `db.json` (un solo archivo)
`DB_FILE = process.env.DB_FILE || ./db.json`. En Render Starter apunta a **`/data/db.json`** (disco
persistente 1 GB). Carga al boot con `JSON.parse(fs.readFileSync)`. Escritura: `save()` con debounce
de 200 ms (`setTimeout` → `fs.writeFileSync`). Claves:

| Clave | Contenido | Crítico |
|---|---|---|
| `users` | base de usuarios (email, favoritos, alertPrefs) | **Sí** |
| `sessions` | token → email | **Sí** (sesiones activas) |
| `codes` | códigos de login pendientes | medio |
| `results` | marcadores por partido | recuperable de ESPN |
| `elos` | Elos recomputados | recuperable (determinístico) |
| `history` | historial de simulaciones | bajo |
| `matchSlugs` | fixtureId → slug Polymarket (descubrimiento cacheado) | medio |
| `marketSnapshots` | **closing line** (probs implícitas sin vig pre-kickoff) | **Sí** (CLV/track record) |
| `sentAlerts`, `sentTg` | dedup de alertas | medio |
| `refCodes` | code → email (referidos) | medio |

### Solo en memoria (RAM) — se pierde en cada reinicio
| Variable | Contenido | Recuperación |
|---|---|---|
| `marketCache` | `{ ts, polymarket{}, kalshi{}, errors }` (precio campeón) | se re-fetcha en ≤60 s |
| `matchMktCache` | `{ ts, matches[] }` (mercados por partido) | se re-fetcha en ≤60 s |
| `simCache` | resultados Monte Carlo por equipo | se re-simula al boot |
| `sseClients` | conexiones SSE abiertas | clientes reconectan |
| `data-providers/cache.js` | TTL Map en memoria (API-Football/ESPN) | se re-fetcha por TTL |

### Qué se pierde si falla el disco / en plan free
Todo `db.json`. Mitigación actual: `results`/`elos` se auto-recuperan de ESPN; pero **users,
sessions, marketSnapshots, refCodes NO se recuperan**. No hay backup automático.

---

## 3. Flujo de datos de mercado (Polymarket / Kalshi)

```
Proveedor (REST) → fetch (polling 60s) → parser inline → normalización inline
  → marketCache (RAM) → arbitrage()/edges (al vuelo) → endpoint /api/arbitrage
  → frontend (SSE 'markets') → Telegram (tgTick) / email
```
**No hay WebSocket, no hay raw storage, no hay historial.** Cada fetch sobrescribe el cache.

### Polymarket — campeón (`fetchMarkets`)
| Aspecto | Valor actual |
|---|---|
| endpoint | `GET gamma-api.polymarket.com/events?slug=world-cup-winner` |
| frecuencia | 60 s (timer) + TTL 60 s |
| timestamp proveedor | ❌ no se captura (solo `marketCache.ts` = hora de nuestro fetch) |
| bid / ask | `bestBid` / `bestAsk` (fallback a `price`) |
| last trade | `outcomePrices[0]` (tratado como "price") |
| spread | ❌ no se calcula |
| volumen | `volumeNum`/`volume` + `volume24hr` |
| open interest | ❌ (no aplica en Polymarket) |
| liquidez | `liquidityNum`/`liquidity` |
| order book | ❌ no se consulta |
| market ID | ❌ no se guarda (se mapea por **nombre** `groupItemTitle`) |
| event ID | implícito en slug |
| resolución / reglas | ❌ no se capturan |
| cache TTL | 60 s |
| fallback | si fetch falla → se mantiene el cache viejo (sin marcar stale) |
| manejo de errores | `try/catch` → `next.errors.push('Polymarket: ...')` |

### Kalshi — campeón (`fetchMarkets`)
| Aspecto | Valor actual |
|---|---|
| endpoint | `GET api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXMENWORLDCUP-26&limit=100&cursor=...` (≤5 páginas) |
| timestamp proveedor | ❌ no se captura |
| bid / ask | `yes_bid_dollars` / `yes_ask_dollars` (fallback desde `no_*`) |
| last trade | `last_price_dollars` |
| volumen | `volume_fp` + `volume_24h_fp` |
| open interest | `open_interest_fp` ✅ |
| liquidez | ❌ |
| order book | ❌ |
| market ID | `ticker` se guarda en el objeto, pero la **clave de mapeo es el nombre** (`no_sub_title`) |
| cache TTL / fallback / errores | igual que Polymarket |

### Polymarket — por partido (`fetchMatchMarkets`)
- Descubre el slug `fifwc-*` por `public-search` de nombres → **cachea permanentemente en `db.matchSlugs`**.
- `GET events?slug=<slug>` → outcomes `home/draw/away` con `price/bid/ask/volume/url`.
- **Closing line**: si la suma de precios > 0.5 y aún no es kickoff, guarda
  `db.marketSnapshots[fixtureId] = { home, draw, away (no-vig), ts }` y `save()`. Se sobrescribe hasta
  el kickoff → queda la última pre-partido. **Es el único dato de mercado que se persiste.**

---

## 4. Riesgos técnicos actuales (explícitos)

| # | Riesgo | Evidencia | Impacto |
|---|---|---|---|
| R1 | **Datos solo en RAM** | `marketCache`, `matchMktCache`, `simCache` | sin historial; nada antes del último fetch |
| R2 | **Falta de timestamps de proveedor** | solo se guarda `ts` propio | imposible medir latencia/edad real del dato |
| R3 | **Datos stale silenciosos** | si el fetch falla se sirve cache viejo sin marca | el usuario puede ver precios viejos como frescos |
| R4 | **Mercados sin ID estable** | clave = alias normalizado del equipo | colisiones / pérdida al cambiar el título |
| R5 | **Mappings por nombre** | `aliasToId[normName(...)]`, `teamTokens` | frágil (histórico: "DR Congo → U17") |
| R6 | **Posibles duplicados / sin idempotencia** | cada fetch sobreescribe, sin checksum | no se puede deduplicar ni reconstruir |
| R7 | **Precios como floats** | `Number(...)` en todo el pipeline | pérdida de precisión en dinero/probabilidades |
| R8 | **Sin raw payload** | se parsea y se descarta el original | no se puede reprocesar ni auditar |
| R9 | **Sin auditoría de ingesta** | no hay log de qué/cuándo se trajo ni historial de errores | no hay trazabilidad |
| R10 | **Posible pérdida de datos** | `db.json` único; `marketSnapshots` (CLV) en el mismo archivo | sin backup automático |
| R11 | **Acoplamiento UI↔cómputo** | `/api/arbitrage`, `buildMatchDetail` calculan al vuelo por request | sin capa de almacenamiento intermedia |

> Estos 11 riesgos son exactamente lo que la nueva plataforma de datos (Sprints 1-6) viene a
> resolver: raw storage con payload + checksum, timestamps separados, IDs canónicos estables,
> NUMERIC para dinero, historial inmutable y auditoría de ingesta.

---

## 5. Conclusión de la auditoría
El producto actual funciona y es robusto **para su alcance** (Mundial, ~435 usuarios), pero su capa de
mercados es **efímera, sin historial, sin IDs estables y sin auditoría**. La fundación del Sprint 0
(PostgreSQL + esquema + repositorios + feature flags) se construye **en paralelo y aislada**, sin tocar
nada de lo anterior, para habilitar los motores de los próximos sprints.
