# Investigación del outlier "Bosnia" (Bloque I)

## El caso observado
Durante el shadow se observó, para aparentemente el **mismo outcome away**, cuotas:
```
away: 1.22   5.10   5.10
```
1.22 ⇒ ~82 % implícito; 5.10 ⇒ ~20 %. Una diferencia así **no** es dispersión estadística normal entre casas
(que rara vez supera ~10–15 pp). El spec exige tratarlo como **posible error semántico/de mapping**, no como
ruido a promediar.

## Hipótesis revisadas
La fuente más probable de una cuota "away" a 1.22 cuando el resto la da a ~5.10 es una **inversión home↔away**
en una casa (o un set que mezcló outcomes / market mismatch): esa casa estaría reportando el **favorito** en la
posición "away". Otras causas a descartar caso por caso: market key/period distinto, `external_event_id`
incorrecto, outcome name mal clasificado, set construido con outcomes de timestamps incompatibles.

## Clasificación (resoluciones posibles)
`data_error | mapping_error | market_mismatch | legitimate_outlier | unresolved`.

## Detector implementado (`sportsbook-providers/outliers.js`)
Orden del spec: **validación semántica → completeness → source → outlier** (no al revés).
- Calcula prob implícita por set y la **mediana por outcome**.
- **Inversión** (`mapping_error`): `home` y `away` se desvían fuerte (>0.25) en **sentidos opuestos** de la
  mediana → patrón Bosnia. Verificado con fixture: book con `home 11 / away 1.25` frente a dos con
  `home 1.25 / away 11` → detectado como `home_away_inversion`.
- **Desviación extrema** de un solo outcome (>0.30) sin inversión → `data_error` (`extreme_deviation`).

## Tratamiento mientras esté `unresolved`
El book/outcome se **excluye** del consenso, **no** se muestra públicamente, y el evento marca
`hasUnresolved=true` → `criticalContradiction` en la evaluación → **STRONG bloqueado**. El filtro es robusto por
mediana **pero no oculta el error semántico**: queda registrado en el diagnóstico de la evaluación shadow para
revisión humana. El estado final de un caso concreto requiere ver los datos crudos del evento (read-only) en la
auditoría manual; hasta entonces se mantiene `unresolved` y bloqueado. Tests: `tests/post-shadow-value-dryrun-db.test.js`
(I: detección + STRONG bloqueado).
