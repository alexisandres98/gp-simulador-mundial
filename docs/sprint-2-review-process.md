# Sprint 2 — Proceso de revisión

> Cola interna `mapping_review_queue` + historial `mapping_decision_history` + endpoints admin.

## Qué entra a revisión
`needs_review`, `conditional`, casos con conflictos, baja confianza, reglas incompletas. Con
`AUTO_MATCH` apagado (default), **TODO** va a la cola (nada se aprueba automáticamente).

## Endpoints admin (sin secretos, paginados, parametrizados)
- `GET  /api/internal/canonical/status` — flags, thresholds, métricas, conteos.
- `GET  /api/internal/canonical/review?status=&limit=&offset=` — candidatos.
- `GET  /api/internal/canonical/review/:id` — detalle (títulos, score, conflictos, evidencia).
- `POST /api/internal/canonical/review/:id/decision` — body `{ decision: approve|reject|conditional|dismiss, notes }`.
Todos **admin-only**.

## Flujo
1. `canonical:match` (write on, auto-match off) → candidatos a la cola (`pending`).
2. Admin revisa lado a lado (títulos, participantes, fechas, reglas, hard conflicts, score).
3. Decisión (approve/reject/conditional/dismiss) → actualiza el item + registra `mapping_decision_history`
   (decision_source = manual, reviewed_by, reason). Auditable.

## Auditoría
- Cada decisión (auto o manual) deja fila en `mapping_decision_history` con versión del algoritmo.
- Nunca se actualiza un mapping histórico en silencio: una reevaluación con versión nueva conserva la
  decisión anterior y registra por qué cambió.
