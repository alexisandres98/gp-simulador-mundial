# Sprint 4 — Política de publicación

## Estados (`arb_publications.publication_status`)
`draft → approved → published → (paused ↔ published) → expired | withdrawn`; `rejected` desde draft/approved.
Terminales: `withdrawn`, `rejected`, `expired` — **no reviven** sin re-aprobación explícita.

## Elegibilidad (`eligibility.checkEligibility`) — estándar SUPERIOR al motor
Para aprobar/publicar se exige TODO:
- `classification = pure_arb` **o** `execution_sensitive` con opt-in explícito (etiquetado + warning visible).
- `mapping = matched`, `outcome = matched`, `hard_conflicts = 0`, `rules_fingerprint` presente.
- `fee_status = known`, `market = open`, snapshots no stale, time skew válido.
- `fully_fillable`, `net_profit > 0`.
- `net_roi ≥ EXEC_PUBLIC_MIN_NET_ROI` (default **1%**, vs 0.5% del motor).
- `max_executable_capital ≥ EXEC_PUBLIC_MIN_EXECUTABLE_CAPITAL` (default **$50**, vs $25 del motor).
- evaluación no más vieja que `EXEC_PUBLIC_MAX_EVALUATION_AGE_MS` (default 2 min).
- deep links válidos (si el flag está activo); metadata de jurisdicción → si falta, warning (no bloqueo).

**Nunca publicable**: `conditional`, `price_discrepancy` (como arbitraje), `rejected`, `needs_review`,
fee unknown, rules missing, stale, market closed. `price_discrepancy` se reservará para otra sección (no en Sprint 4).

## Revalidación continua (`revalidation.revalidate`)
Oculta/expira cuando, contra la evaluación ACTUAL: opportunity status ≠ active/detected/aging; deja de ser
elegible; snapshot stale; market suspended/closed; rules fingerprint cambia; mapping version cambia; net ROI
cae bajo umbral; tamaño cae bajo mínimo; o expira por reloj. Si la validación no es reciente
(`EXEC_PUBLIC_MAX_REVALIDATION_AGE_MS`, default 30s) → estado **VERIFYING** (no se oculta, se refresca).

## Snapshot vs validación actual (§26)
`public_payload` congela lo mostrado **al publicar** (auditoría: qué vio el usuario, con qué evaluación, fees,
reglas y `risk_disclosure_version`). La vista activa muestra además la última validación (countdown, "validado hace Ns").

## Auditoría
Cada transición escribe en `arb_publication_history` (previous/new status, action, actor, reason, evaluation_id, metadata)
en la **misma transacción** que el cambio de estado.

## Invariante anti auto-publicación
`config.flags.autoPublicationBlocked = true` siempre. No existe ningún endpoint ni función que publique por
clasificación. `publish()` exige: flag `EXEC_OPPORTUNITIES_MANUAL_PUBLICATION_ENABLED` + llamada admin + revalidación.
Hereda `ARB_ENGINE_ALLOW_AUTO_PUBLICATION=false` (Sprint 3); la UI no puede eludirlo.
