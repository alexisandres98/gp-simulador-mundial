# Sprint 4 — Calculadora de capital

`exec-opportunities/calculatorService.js`. Matemática y general. **Server-side siempre.**

## Entrada / salida
- Input: `capital` (USD), `minRoi` opcional. Admin puede pasar `executionBufferBps` (nunca por debajo del mínimo seguro).
- Output binary: contratos por pata, capital por plataforma, payout, beneficio mínimo estimado, net ROI, **precio límite por pata**, `calculated_at`, `valid_until`, `evaluation_id`, `warnings`.
- 1X2: capital por outcome, payout mínimo, beneficio mínimo, net ROI.

## Reglas
- **No guarda** el capital introducido, ni bankroll, ni patrimonio. No ejecuta operaciones.
- ROI efectivo = `max(minRoi del usuario, EXEC_PUBLIC_MIN_NET_ROI)`.
- Usuario público **no** puede reducir el buffer por debajo de `minExecutionBufferBps`.
- Validación de input: positivo, ≤ `EXEC_PUBLIC_CALC_MAX_CAPITAL`, decimal válido; negativos/enormes → error claro.
- Rate limit: `EXEC_PUBLIC_CALC_RATE_LIMIT`/min por usuario (en `server.js`).

## Revalidación al calcular (§16)
El endpoint resuelve las patas de la **última evaluación válida** (`adapters.loadLiveContext`). Si la oportunidad
expiró → `available:false` + "Esta oportunidad ya no está disponible con los precios observados." Nunca devuelve
el cálculo antiguo en silencio.

## Por qué breakpoints y no la binaria del motor
La calculadora usa `breakpoints.breakpointMaxSize` (búsqueda exhaustiva en fronteras del book + micro-binaria en el
cruce continuo) como **defensa en profundidad** ante la no-monotonicidad por el `ceil` de fees de Kalshi. Ver
`sprint-4-testing.md` (hardening): la binaria del motor pasó 204 casos sin devolver tamaño no elegible ni perder
tamaño material, pero la búsqueda en breakpoints aterriza exactamente en las fronteras.
