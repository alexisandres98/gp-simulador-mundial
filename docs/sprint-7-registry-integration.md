# Sprint 7 — Integración con el registro

Schema nuevo en Signal Registry (Sprint 5): **`pick_gp_strong_value`** (`pick_gp_strong_value-1`).
Al publicar una Pick GP, `picks.publish` crea la señal inmutable **en la misma transacción** que la `pick_publication` ("no signal → no pick"; si la señal falla → rollback). La señal congela: value_evaluation_id, selección, observed_price, price_limit, probabilities (gp/consenso/pm/ensemble/conservadora), edge, EV, fuentes, versiones, tracking (`executed_by_gp=false`, `realized_roi=null`).
Reglas heredadas: append-only, hash chain, source references, verified epoch, published-before-event (eligibility), no backdating, no edits silenciosos. Una retirada crea **evento** (no actualiza la señal original). `pick_publication_id` NO es requerido en el schema (la señal se crea antes que la publicación, que la referencia).
