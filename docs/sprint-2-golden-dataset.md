# Sprint 2 — Golden dataset

> `canonical-graph/fixtures/golden.js`: 40 casos validados manualmente (10 matched / 10 conditional /
> 10 rejected / 10 needs_review). Datos sanitizados (sin tokens). Evaluado por `tests/canonical-graph.test.js`.

## Resultados (medidos)
```
precision auto-match: 100%   ·   recall: 100%   ·   false positives MATERIALES: 0
matched 10/10 · conditional 10/10 · rejected 10/10 · needs_review 10/10  → estado esperado
```
- **0 falsos positivos materiales**: el sistema nunca declara `matched` donde el golden espera no-matched.
- Detección de conflictos: periodo, draw, penales, win-vs-qualify, torneo-vs-partido, categoría,
  participantes, fecha, estado, mitad-vs-completo.

## Casos cubiertos
- **Matched:** campeón mismo equipo en ambos proveedores (alias normalizados).
- **Conditional:** 90m vs prórroga, penales sí/no, win vs qualify, postponement distinto (mismo evento).
- **Rejected:** torneo vs partido, partido distinto, mujer vs hombre, U20 vs absoluta, primera mitad,
  empate sí/no, competición distinta, fecha incompatible, outcome de equipo equivocado, estado cancelado.
- **Needs_review:** sin reglas, alias desconocido, sin fecha, un solo participante.

## Condición para auto-match
NO habilitar `AUTO_MATCH` en producción si existe **un solo falso positivo material** en el golden.
Prioridad: **precisión** (un mapping falso puede crear un arbitraje falso y provocar pérdida).
No se maquillan resultados moviendo casos difíciles fuera del dataset.
