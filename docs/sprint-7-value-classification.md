# Sprint 7 — Clasificación de value

`valueFormulas.js` + `classification.js` + `qualityScore.js`. Thresholds centralizados en config (`VALUE_*`).

## Fórmulas (§24)
break_even = 1/odds · raw_edge = ensemble − break_even · **adjusted_edge = conservative − break_even** · raw_ev = ensemble·odds − 1 · adjusted_ev = conservative·odds − 1 · fair_odds = 1/ensemble · **minimum_acceptable_odds = (1+minEv)/conservative**. Prediction markets: `maximum_acceptable_price = conservative/(1+minEv)` (usa execution engine de Sprint 3 para fees; NO la fórmula sportsbook).
**No doble conteo (§25)**: la cuota ya contiene el vig → el overround NO se resta como fee; el no-vig solo estima consenso. Vig/fee/slippage/buffer no se restan dos veces.

## Clasificación (§28)
- **PASS**: edge ≤ 0, datos insuficientes, precio no accionable, consenso no disponible, conflicto de reglas, stale.
- **WATCH**: diferencia interesante bajo umbral.
- **LEAN**: edge positivo + fuentes/calidad suficientes, no STRONG.
- **STRONG** (`strongEligible`, §30): edge/EV ajustados ≥ umbral, ≥3 fuentes, ≥3 grupos, consenso completo, mapping matched, **0 hard conflicts**, fresh, versiones presentes, incertidumbre ≤ máx, calidad ≥ mín, data quality suficiente, cuota ≥ mínima, evento no iniciado. **Un hard conflict NUNCA es superado por un edge alto.** Quality alta + edge cero → PASS.
STRONG guarda `strong_reason_codes`/`strong_blockers`. Es una **conclusión analítica**, aún no una pick. No se sube LEAN→STRONG manualmente sin decisión versionada.
