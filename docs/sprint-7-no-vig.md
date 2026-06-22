# Sprint 7 — No-vig

`noVig.js`. Métodos VERSIONADOS. **Método oficial V1: `no-vig-proportional-1`**; secundario de sensibilidad: `no-vig-power-1`.
- **Proportional**: `p_i = q_i / Σq_i`.
- **Power**: encuentra `k` tal que `Σ(q_i^k)=1` (solver de bisección determinístico, tolerancia, límites; `no_convergence` explícito si falla).
- **Overround** = `Σq_i − 1` (se guarda).
- **Shin**: NO implementado (documentado como futuro; no se entrega aproximación no validada).
`removeVig` devuelve oficial + alternativo + `method_disagreement`; si difieren materialmente (>2pp) → `method_disagreement_warning` (aumenta incertidumbre). **No se elige el método por mayor edge.** Mercado incompleto (<3 outcomes) → no produce no-vig.
