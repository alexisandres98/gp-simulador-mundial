# Sprint 1 — Auditoría de providers (Polymarket / Kalshi)

> Qué consume HOY GP y qué hace falta para la ingesta persistente. Se distingue siempre:
> **[P] campo del proveedor · [G] calculado por GP · [—] no disponible**. No se inventan campos.
> Integración actual: `server.js` (`fetchMarkets`, `fetchMatchMarkets`, `arbitrage`).

## Resumen de lo que existe hoy
- Polling REST cada **60 s** (`setInterval`) → parseo inline → `marketCache`/`matchMktCache` (RAM) → `arbitrage()` al vuelo.
- **No** se guarda histórico, **no** se capturan order books, **no** se persisten timestamps del proveedor, los mercados se mapean **por nombre de equipo** (no por ID estable). (Riesgos R1-R11 del Sprint 0.)

---

## POLYMARKET

### Base URLs
- Gamma (datos de mercado): `https://gamma-api.polymarket.com`
- CLOB (order book / precios): `https://clob.polymarket.com`
- Auth: **pública** para lectura (no requiere key para order book ni gamma).

### Endpoints actualmente usados
| Uso | Endpoint |
|---|---|
| Campeón del Mundial | `GET /events?slug=world-cup-winner` |
| Descubrir slug de partido | `GET /public-search?q={nombres}&limit_per_type=6` → cache `db.matchSlugs` |
| Mercado de partido | `GET /events?slug={fifwc-...}` |

### Endpoint NUEVO requerido (Sprint 1)
| Uso | Endpoint |
|---|---|
| **Order book** | `GET https://clob.polymarket.com/book?token_id={tokenId}` |
- `tokenId` proviene de `market.clobTokenIds` (array JSON de 2 token IDs, uno por outcome) en la data de gamma. **No se usa hoy.**

### Campos por mercado (gamma)
| Campo | Origen | Nota |
|---|---|---|
| `outcomePrices[0]` (precio) | **[P]** | JSON string; tratado hoy como "price" (en realidad last/mid según mercado) |
| `bestBid` / `bestAsk` | **[P]** | fallback a price si faltan |
| `volumeNum` / `volume`, `volume24hr` | **[P]** | USD |
| `liquidityNum` / `liquidity` | **[P]** | USD |
| `oneDayPriceChange` | **[P]** | |
| `groupItemTitle` / `question` | **[P]** | usado HOY para mapear por nombre (frágil) |
| `clobTokenIds` | **[P]** | **necesario para order book**; no usado hoy |
| `conditionId` / market `id` | **[P]** | ID estable real; **no usado como clave hoy** |
| spread | **[G]** | `bestAsk − bestBid` (hoy no se calcula) |
| midpoint | **[G]** | `(bestBid+bestAsk)/2` (CLOB también ofrece `/midpoint`) |
| open interest | **[—]** | no aplica en Polymarket |
| `provider_timestamp` | **[P]** (CLOB `book.timestamp`) | gamma no lo da; **CLOB sí** lo trae en el book |

### Order book (CLOB)
Respuesta `book`: `{ market, asset_id, bids:[{price,size}], asks:[{price,size}], timestamp, hash, min_order_size, tick_size, neg_risk, last_trade_price }`. Hay **bids y asks explícitos**. `tick_size` y `min_order_size` son [P].

### Estado de mercado
Gamma trae `active`, `closed`, `archived`, `acceptingOrders`. → normalizar a open/closed/suspended/settled/unknown.

### Rate limits / resiliencia
- No documentado un límite duro estricto para gamma público; CLOB tiene límites por endpoint. **Estrategia conservadora**: timeout 15s, ≤2 retries con backoff+jitter, respetar 429 `Retry-After`. El universo es pequeño (1 campeón + pocos partidos), así que el consumo es bajo.

### Fallos conocidos (hoy)
- Mapeo por nombre (`groupItemTitle`) → colisiones; slugs `fifwc-*` con códigos arbitrarios (descubrimiento por búsqueda). Sin order book. Sin timestamp persistido.

---

## KALSHI

### Base URL
- `https://api.elections.kalshi.com/trade-api/v2`
- Auth: **pública** para market data (order book y markets no requieren auth).

### Endpoints actualmente usados
| Uso | Endpoint |
|---|---|
| Campeón del Mundial | `GET /markets?event_ticker=KXMENWORLDCUP-26&limit=100&cursor={c}` (paginado ≤5) |

### Endpoint NUEVO requerido (Sprint 1)
| Uso | Endpoint |
|---|---|
| **Order book** | `GET /markets/{ticker}/orderbook` |
- Devuelve **solo bids** `yes` y `no` (`orderbook_fp.yes_dollars` / `no_dollars`, cada nivel `[price_dollars, count_fp]`). Un `no` bid a X = `yes` ask a (1−X) → **el lado ask del YES se DERIVA [G]**.

### Campos por mercado
| Campo | Origen | Nota |
|---|---|---|
| `last_price_dollars` | **[P]** | last trade |
| `yes_bid_dollars` / `yes_ask_dollars` | **[P]** | en dólares (no centavos) |
| `no_bid_dollars` / `no_ask_dollars` | **[P]** | para derivar el lado contrario |
| `volume_fp`, `volume_24h_fp` | **[P]** | contratos (fixed-point string) |
| `open_interest_fp` | **[P]** | ✅ disponible |
| `previous_price_dollars` | **[P]** | para change 24h **[G]** |
| `ticker` | **[P]** | **ID estable**; hoy se guarda pero no se usa como clave |
| `no_sub_title` / `yes_sub_title` | **[P]** | usado HOY para mapear por nombre (frágil) |
| `status` / `close_time` / `expiration_time` | **[P]** | estado y cierre |
| spread | **[G]** | `yes_ask − yes_bid` |
| midpoint | **[G]** | `(yes_bid+yes_ask)/2` |
| `provider_timestamp` | **[—] / [P]** | el market no trae un ts claro de cotización; usar `received_at` como basis y marcarlo |

### Convención numérica
- `_dollars` = string en dólares (`"0.4200"` = $0.42). `_fp` = fixed-point string (`"13.00"` = 13 contratos). **Mantener como string en NUMERIC; nunca convertir a float ni confundir centavos/dólares.**

### Estado de mercado
`status` ∈ {active, closed, settled, ...}. → normalizar a open/closed/suspended/settled/unknown; conservar el original en metadata.

### Rate limits / resiliencia
- Kalshi documenta límites por tier (lectura pública moderada). **Estrategia conservadora**: timeout 15s, ≤2 retries, backoff+jitter, respetar 429 `Retry-After`. Paginación con `cursor`.

### Fallos conocidos (hoy)
- Mapeo por `*_sub_title` (nombre). Sin order book. Sin timestamp del proveedor.

---

## Universo inicial de ingesta (controlado — NO toda la plataforma)
| Proveedor | Mercados |
|---|---|
| Polymarket | campeón (`world-cup-winner`) + mercados de partido ya rastreados (`db.matchSlugs`) + sus outcomes + order books |
| Kalshi | serie `KXMENWORLDCUP-26` (campeón) + outcomes/contratos + order books |

## Campos: proveedor vs calculado vs no disponible (referencia rápida)
- **[P] proveedor:** last_trade, best_bid, best_ask (Poly), volume, open_interest (Kalshi), niveles del book, ticker/condition_id, status, close_time.
- **[G] GP:** spread, midpoint, change24h, lado ask derivado (Kalshi), checksum, freshness.
- **[—] no disponible:** open_interest (Polymarket), provider_timestamp fiable (Kalshi market), liquidity (Kalshi).
