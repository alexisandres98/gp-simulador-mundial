# Sprint 5 — Scoring eligibility

`eligibility.evaluate(signal, ctx)` → `{ score_eligible, verification_status, legacy, experimental, reasons }`.
Las señales no elegibles **se registran igual** (transparencia), pero con `score_eligible=false` y un
`verification_status` que explica por qué.

## Reglas (§16) — score_eligible=true requiere TODO
- `published_at < event_start_at` y `< market_close_at` cuando aplica.
- `input_cutoff_at <= published_at` (no usar datos posteriores a la publicación).
- outcome aún no conocido.
- payload válido (schema).
- `model_version` y `methodology_version` presentes.
- source references suficientes (≥ `minSourceRefs`, default 1).
- epoch verificable cumplido (`published_at >= SIGNAL_REGISTRY_VERIFIED_EPOCH`).
- no experimental, no legacy.

## verification_status
| Valor | Cuándo | score_eligible |
|---|---|---|
| `verified` | cumple todo | **true** |
| `late` | publicada después del inicio/cierre, u outcome conocido | false |
| `legacy_unverified` | antes del epoch, o import histórico/retroactivo | false |
| `experimental` | GP Intelligence V2 | false |
| `disputed` | marcada en disputa (vía evento) | false |

## Epoch verificable (§6)
`SIGNAL_REGISTRY_VERIFIED_EPOCH` se configura al activar en producción. **No se backdatea.** Toda señal anterior →
`legacy_unverified`. La UI futura dirá "Registro verificable desde: [fecha]".

## Imports históricos (§36)
`legacyImport=true` → `legacy_unverified`, `score_eligible=false`. El timestamp histórico alegado puede guardarse
en `source_created_at`, pero **no** como `published_at` verificado.
