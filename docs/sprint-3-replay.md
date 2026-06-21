# Sprint 3 — Replay (validación histórica)

> `arb-engine/replay.js`. Reproduce el motor con snapshots históricos SIN look-ahead.

## No look-ahead (garantizado por construcción)
Para cada momento t solo se usan snapshots con `received_at ≤ t` (`replayFromHistory` filtra por tiempo).
No se usa el siguiente snapshot ni un closing price futuro. Se respeta time skew y la fee/mapping/rules
vigente en esa fecha.

## Métricas (sin afirmar ROI realizado)
oportunidades detectadas, oportunidades únicas, distribución de clasificación, lifetime mediano,
max net ROI, frecuencia de desaparición. **No hubo ejecución real → no se afirma ROI realizado.**

## Estado
Requiere histórico de Sprint 1 para datos reales (hoy inerte). El replay opera sobre secuencias de
snapshots; con fixtures se valida la lógica de no-look-ahead.
