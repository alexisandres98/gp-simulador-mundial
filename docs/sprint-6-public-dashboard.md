# Sprint 6 — Dashboard público

Pestaña **"Rendimiento"** (`#tab-perf`, gated por `METRICS_PUBLIC_ENABLED` o admin preview). No destruye la página de Aciertos.

## Secciones
- **Encabezado**: "Track record verificable · Registro verificable desde [fecha] · N señales oficiales liquidadas · [copy de muestra]".
- **Bloque oficial V1**: Brier, log loss, accuracy (secundaria), ECE — cada uno con valor / **N/A** (≠ cero), n, estado de muestra, intervalo, "menor/mayor es mejor".
- **Calibración**: reliability chart (pronosticado vs observado) + línea diagonal ideal + ECE.
- **Arbitraje**: separado, oportunidades observadas, quoted→ejecutable, vida mediana — **sin ROI realizado**.
- **Experimental** (gated): control V1 vs challenger V2, etiquetado "Resultados experimentales. No forman parte del track record oficial."
- Periodo por defecto: **desde el inicio del registro verificable** (no "mejor mes/semana").

## API pública (§30)
`/api/metrics/{summary,calibration,cohorts,arb,experimental,methodology,snapshots}` — cada respuesta incluye n, metric_version, sample_status, intervalos, verified_epoch, exclusiones, disponibilidad. Nunca una cifra sin metadata.

## Reglas de copy (§33)
N/A ≠ 0. Muestra pequeña → "provisional". ROI simulado → "no representa operaciones realizadas". Arb → "oportunidades observadas, no ejecuciones". Prohibido: "modelo ganador / rentabilidad garantizada / somos mejores que el mercado / beneficio comprobado" sin evidencia suficiente. Verificado en preview móvil: 0 errores de consola.
