# Sprint 1 — Política de frescura

> `market-data/freshness.js`. Clasifica cada dato como fresh / aging / stale / unknown. No hardcodea
> un único umbral: depende del intervalo esperado por proveedor/mercado.

## Estados
| Estado | Significado |
|---|---|
| `fresh` | dentro de la ventana esperada |
| `aging` | más viejo de lo ideal, aún utilizable con advertencia |
| `stale` | demasiado viejo para presentarlo como vigente |
| `unknown` | sin base para evaluar (ni provider_timestamp ni received_at) |

## Umbrales (configurables)
```
expectedInterval = intervalo del proveedor (p.ej. 30 s)
fresh:  age ≤ expectedInterval × MARKET_DATA_FRESH_MULTIPLIER   (default 2 → 60 s)
aging:  fresh < age ≤ expectedInterval × MARKET_DATA_STALE_MULTIPLIER  (default 5 → 150 s)
stale:  age > expectedInterval × STALE_MULTIPLIER
```
- `MARKET_DATA_FRESH_MULTIPLIER=2`, `MARKET_DATA_STALE_MULTIPLIER=5` (orientativos; se afinan por deporte/live).

## Basis (importante)
- Si existe `provider_timestamp`, se usa y `basis='provider_timestamp'`.
- Si **no** existe (p.ej. Kalshi market), se usa `received_at` y `basis='received_at'`. **No** se presenta
  como frescura garantizada por el proveedor: el `basis` deja claro que es nuestra hora de recepción.
- Sin ninguno de los dos → `unknown`.

## Uso
- Se calcula por snapshot durante la ingesta (métrica por ciclo) y de forma agregada por proveedor en
  el admin status (a partir del último `received_at`).
- Live vs prematch: el intervalo esperado puede ser menor para mercados en vivo
  (`MARKET_DATA_LIVE_INTERVAL_MS`), endureciendo la frescura cuando importa.

## No se infiere settlement por desaparición
La frescura mide actualidad, **no** resolución. Un mercado que deja de aparecer no se marca como
`settled`; se actualiza su `last_seen_at`/estado (ver operations).
