# Sprint 3 — Arquitectura del motor de arbitraje

> Backend interno, shadow mode, sin publicación. Precisión-primero: rechazar lo que solo parece arbitraje.

## Pipeline
```
candidatos (mappings matched) → snapshot selection → book validation → fee calc →
book walking/VWAP → size optimizer → eligibility + time skew → classification →
confidence → opportunity key → lifecycle → persistencia (gated) + métricas
```
Módulos en `arb-engine/`: decimal, bookWalker, payoutNormalizer, feeEngine, arbCore, sizeOptimizer,
binaryArb, oneXTwoArb, bookValidator, eligibility, snapshotSelector, classifier, confidence,
opportunityKey, lifecycle, candidateGenerator, persist, scheduler, replay, cli, config, index.

## Principios
- **Dinero en aritmética decimal** (BigInt ×1e8), NUNCA binary float.
- **Slippage = VWAP del book walking** (no se resta otra fee de slippage → no doble conteo).
- **Execution buffer** separado (riesgo operativo, no fee).
- **ROI único**: `net_roi = net_profit / capital_required`.
- **Fee unknown / mapping no matched / stale / book inválido / time skew → NUNCA Pure Arb**.
- Gated por flags `ARB_ENGINE_*`; `ALLOW_AUTO_PUBLICATION` forzado a false en Sprint 3.
