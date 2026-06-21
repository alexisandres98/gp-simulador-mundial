# Sprint 1 — Contrato de normalización

> Forma interna consistente a la que ambos proveedores convergen. Normalizadores **versionados** y
> deterministas; permiten reprocesar raw con una versión futura sin sobreescribir la original.

## Versionado
- `polymarket-normalizer-1`, `kalshi-normalizer-1`. La versión se guarda en cada
  `normalized_market_snapshots.normalizer_version`. Una v2 futura genera filas nuevas (no sobreescribe).

## raw_market_snapshots (qué se guarda)
- **Objeto EXACTO del mercado** por observación (no se duplica el response completo de la lista). El
  payload del order book se guarda como una fila raw adicional para reconstrucción/auditoría.
- `checksum` determinístico (`database/checksum.js`) del contenido; **excluye** `received_at` y secretos.
- Nunca se guardan headers, tokens, cookies ni API keys.

## normalized_market_snapshots (campos y reglas)
| Campo | Regla |
|---|---|
| `best_bid` / `best_ask` / `last_trade` | **string** NUMERIC; tal cual del proveedor (no float) |
| `midpoint` | `(bid+ask)/2` **[gp_derived]**, solo si ambos existen; no es precio ejecutable |
| `spread` | `ask−bid` **[gp_derived]**, solo si ambos existen |
| `volume` | string; Polymarket USD, Kalshi contratos `_fp` |
| `open_interest` | Kalshi `open_interest_fp` **[provider]**; Polymarket **null** (no 0) |
| `available_depth` | Polymarket `liquidityNum`; Kalshi **null** |
| `market_status` | normalizado a open/closed/suspended/settled/cancelled/unknown; original en `metadata.statusRaw` |
| `side` | yes/home/draw/away/team según evento |
| `provider_timestamp` | solo si el proveedor lo da (Polymarket CLOB book sí; Kalshi market no) → si falta, **null** |
| `metadata.provenance` | marca cada valor: `provider_reported` / `gp_derived` / `unavailable` |

### Reglas numéricas duras
- NUMERIC como **string** en persistencia. No convertir dinero a float. No confundir centavos/dólares.
- No asumir `last_trade == best_ask`. No asumir `midpoint` ejecutable.
- **Ausencia de dato = `null`, nunca 0.**
- No inventar `open_interest` cuando no existe.

## Order book (normalized_orderbook_levels)
- `side` bid/ask, `level_index` 0 = mejor nivel; bids descendente, asks ascendente (orden determinista).
- **Polymarket**: bids/asks explícitos del CLOB book.
- **Kalshi**: el book trae solo bids (`yes_dollars`, `no_dollars`). El **lado ask del YES se DERIVA**:
  un `no` bid a X = `yes` ask a (1−X) **[gp_derived]**.
- Precios/sizes **string** NUMERIC; negativos rechazados; `MARKET_DATA_ORDERBOOK_MAX_LEVELS` (default 20).
- `ON DELETE CASCADE` desde el snapshot normalizado; no se duplican niveles (UNIQUE snapshot+side+index).
