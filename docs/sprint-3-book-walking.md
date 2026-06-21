# Sprint 3 — Book walking y VWAP

> `arb-engine/bookWalker.js` + `decimal.js`. Determinístico, exacto, no muta el book.

## Entrada / salida
in: `{ levels, requestedQuantity, side, tickSize, minimumOrderSize }`.
out: `{ filledQuantity, unfilledQuantity, vwap, worstPrice, grossCost, levelsConsumed, fullyFillable, meetsMinimumOrder }`.

## Reglas
- Consume mejor precio primero (asks ascendente para compra). Respeta el size de cada nivel.
- No asume fill completo; calcula `unfilled`. Respeta `minimumOrderSize`.
- Aritmética decimal: `grossCost = Σ(price×take)`, `vwap = grossCost/filled`.
- No modifica el book original (ordena una copia).

## Decimal (`decimal.js`)
- BigInt escalado ×1e8. add/sub/mul/div con redondeo half-up explícito.
- `0.1+0.2=0.3` exacto; `0.07×100=7`; sin binary float para dinero.

## Slippage
`book_slippage = VWAP − best_ask` (deriva del walking). NO se resta una fee genérica de slippage aparte.
