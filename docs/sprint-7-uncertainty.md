# Sprint 7 — Incertidumbre

`uncertainty.js`. Separa **probabilidad central / incertidumbre / calidad**. Factores: dispersión entre books, desacuerdo de métodos no-vig, GP vs mercado, discrepancia PM, sample status, data quality, freshness, source/independence count, precio derivado, baja liquidez, alineación sin confirmar. Cada factor aporta `points + evidence + warning`.
Output: `uncertainty_score 0–100`, `label low/medium/high`, `uncertainty_buffer_pp`, `warnings[]`, `contributions[]`.
**La incertidumbre NO cambia silenciosamente la probabilidad central**: produce `conservative_probability = max(0, ensemble − uncertainty_buffer)`, usada para evaluar compras. No es un intervalo estadístico (no se llama así).
