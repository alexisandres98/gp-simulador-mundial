# Sprint 7 — Normalización de odds

`oddsNormalization.js`. Soporta `decimal | american | fractional | probability` → `decimal_odds` + `raw_implied_probability = 1/decimal`.
Valida: odds > 1, no NaN/Inf, estado abierto. Aritmética con números pero los cálculos críticos posteriores (no-vig/value) usan redondeo controlado. Quote `closed/suspended` → inválido. Verificado: 1.88→0.5319, +150→2.5, -200→1.5, 5/2→3.5.
