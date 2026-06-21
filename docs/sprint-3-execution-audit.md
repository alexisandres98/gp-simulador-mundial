# Sprint 3 — Auditoría de ejecución

> **Estado:** el histórico de Sprint 1 y los mappings de Sprint 2 están **inertes en producción**
> (flags off, sin `DATABASE_URL`) → **no hay datos reales ni mappings aprobados todavía**. Esta
> auditoría se basa en los formatos conocidos (Sprint 1) + documentación pública de fees, y el motor
> se implementa y prueba con **fixtures validados**. Reporte: **COMPLETADO CON PENDIENTE DE VALIDACIÓN REAL**.
> Marcas: **[D] directo del proveedor · [G] derivado por GP · [E] estimado · [—] no disponible**.

## Order book
| Aspecto | Polymarket (CLOB) | Kalshi |
|---|---|---|
| bids / asks | **[D]** bids y asks explícitos | **[D]** solo bids (yes + no); **el ask del YES se DERIVA [G]** de `1 − no_bid` |
| precio | **[D]** 0–1 (string) | **[D]** dólares string (`_dollars`) |
| size | **[D]** | **[D]** contratos (`_fp`) |
| tick size | **[D]** `tick_size` (0.01) | **[E]** 1¢ (a confirmar por mercado) |
| min order size | **[D]** `min_order_size` | **[E]** 1 contrato (a confirmar) |
| provider_timestamp | **[D]** `book.timestamp` | **[—]** (usar `received_at` como basis) |

## Precios: directos vs derivados (crítico)
- **Polymarket YES ask** = ask directo **[D]** (`price_source: direct_ask`).
- **Kalshi YES ask** = `1 − no_bid` **[G]** (`price_source: derived_from_complement_bid`). Se conserva
  `source_outcome/source_side/source_price/derivation_formula`. La confianza penaliza el derivado.

## Fees (versionadas; nunca inventar — `unknown` si no es fiable)
| Proveedor | Fee de trading conocida | Estado |
|---|---|---|
| **Kalshi** | `fee = ceil(0.07 × C × P × (1−P))` por contrato (taker). Fórmula pública documentada. | **[D]** (verificar fecha) |
| **Polymarket** | Históricamente **0%** de trading fee on-chain (hay gas/spread, no fee de plataforma). | **[E]** → marcar `fee_status` y fecha de verificación; si hay duda → `unknown` |
- **Regla:** si `fee_status = unknown` para una pata → la oportunidad **no** puede ser Pure Arb ejecutable.
- Se distinguen: entrada, salida, settlement, maker, taker. **V1 usa taker** (ejecución inmediata).
  Maker NO se trata como ejecutable instantáneo.

## Payout / contrato
- Mercados binarios payout $1: `price ∈ [0,1]`, `payout_if_winner=1`, `payout_if_loser=0`, `currency=USD`.
- **No mezclar** centavos/dólares/porcentajes/odds decimales/strings. Contrato interno normalizado
  (`normalized_price`, `normalized_payout`, `currency`, `contract_multiplier`, `quantity`).
- **Aritmética decimal** (BigInt escalado ×1e8), **nunca binary float** para dinero.

## Estados / temporalidad
- `market_status` open/closed/suspended/settled. Solo `open` es elegible.
- Snapshots pueden estar **desalineados temporalmente** entre patas → `leg_time_skew_ms`; si excede el
  umbral → rechazo (Pure Arb conservador). Edad máxima distinta para **live** vs **prematch**.

## Limitaciones detectadas (a validar con datos reales)
- Sin datos reales, los tick/min-order de Kalshi y la fee real de Polymarket están **estimados** → el
  motor los trata conservadoramente (fee unknown bloquea Pure Arb). Se refinará al activar la ingesta.
