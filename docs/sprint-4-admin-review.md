# Sprint 4 — Flujo de revisión administrativa

## Acciones (`publicationService`)
| Acción | Transición | Requisitos |
|---|---|---|
| `createDraft` | (nueva) → draft | construye `public_payload`; genera `public_id` opaco |
| `approve` | draft/rejected → approved | flag manual + **elegibilidad** contra evaluación actual |
| `publish` | approved/paused → published | flag manual + **revalidación** + congela snapshot + `expires_at` |
| `pause` | published → paused | — |
| `withdraw` | * → withdrawn | terminal |
| `reject` | draft/approved → rejected | — |
| `revalidatePublication` | published → published/expired | auto (system), auditado |

Toda acción escribe en `arb_publication_history` en la misma transacción (bloqueo `FOR UPDATE`).

## Endpoints admin (`/api/internal/executable-opportunities`)
- `GET /` — estado + lista para revisión (paginado, filtro por status).
- `GET /:id` — publicación + historial + **diff aprobado vs actual** (net ROI, clasificación, fees, tamaño).
- `POST /:id/{approve|publish|pause|withdraw|revalidate}`.
- `POST /create` — borrador desde una oportunidad del motor (`opportunityKey`).

Todos admin-only (403 si no admin), 404 si `EXEC_OPPORTUNITIES_UI_ENABLED=false`.

## Panel UI (`public/app.js`, dentro de la pestaña "Ejecutables", solo admin)
Lista de publicaciones con estado/visibilidad y botones Aprobar/Publicar/Pausar/Revalidar/Retirar. Muestra conteos.
Aviso explícito: "Aprobación manual. Nada se publica automáticamente. Cada acción queda auditada."

## No publicar una evaluación vieja sin revalidar
`approve`/`publish` reconstruyen la evaluación **viva** vía `adapters.loadLiveContext` y exigen elegibilidad/revalidación.
Si no hay evaluación vigente (sin datos reales del motor) → 409 con mensaje claro.
