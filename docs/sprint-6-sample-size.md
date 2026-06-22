# Sprint 6 — Política de tamaño de muestra

`config.sampleStatus(n)`. **No es ley científica; es política de comunicación.** No mostrar una cifra sin contexto de muestra.

| Estado | n | Comunicación |
|---|---|---|
| insufficient | 0–29 | muestra insuficiente |
| early | 30–99 | resultados iniciales |
| developing | 100–299 | muestra en desarrollo |
| established | 300+ | muestra más estable |

Configurable: `METRICS_SAMPLE_INSUFFICIENT_MAX`, `METRICS_SAMPLE_EARLY_MAX`, `METRICS_SAMPLE_DEVELOPING_MAX`.
La UI marca `insufficient`/`early` como **provisional** ("Muestra todavía limitada. Estos resultados pueden cambiar sustancialmente."). Algunas métricas se calculan internamente con n pequeño pero se etiquetan provisional. Cohortes con n muy pequeño no se publican.
