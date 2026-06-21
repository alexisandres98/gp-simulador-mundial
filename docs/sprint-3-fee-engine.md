# Sprint 3 — Motor de fees

> `arb-engine/feeEngine.js` (versionado) + tabla `provider_fee_schedules`. Aritmética decimal.

## Schedules (versionados; fuente + fecha de verificación)
- **Polymarket** `pm-fee-1`: flat 0% (trading fee de plataforma 0; hay gas/spread). Estado: known (verificar).
- **Kalshi** `ks-fee-1`: `fee = ceil_cents(0.07 × contracts × price × (1−price))` (taker). Pública.

## Reglas
- NO hardcodea una fee global. Distingue proveedor/fórmula/taker. V1 usa **taker** (ejecución inmediata);
  maker NO se trata como ejecutable instantáneo.
- **`fee_status = unknown`** cuando no hay info fiable → la oportunidad NO puede ser Pure Arb.
- No se cuenta una fee dos veces. Schedules versionadas; no se sobreescribe el historial.
- Distingue entrada/salida/settlement/maker/taker (V1 calcula la de entrada taker).
