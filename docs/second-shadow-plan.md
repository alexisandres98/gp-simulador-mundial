# Plan del Segundo Shadow (24–48h) — PREPARACIÓN, NO EJECUCIÓN

> **No ejecutar.** Este documento describe el plan; la ingesta permanece detenida hasta aprobación explícita.

## Qué valida
```
The Odds API → ingesta corregida (batch/idempotente) → current/history → source independence
→ Canonical candidates → mappings revisados → synchronized sets → no-vig → consenso → ensemble → Value dry-run
```

## Criterios previos para iniciarlo (checklist)
- [x] Batch insert validado (3000 cuotas < 10 s; replay sin nuevas filas).
- [x] Job termina `success/partial/failed` real; timeout cancela cooperativamente; sin escrituras en background.
- [x] Cero solapamientos (lock retenido durante toda la ejecución + abort+grace antes de reintentar).
- [x] Retención segura (dry-run por defecto, execute guarded, allowlist).
- [x] Source catalog sembrado (verified/duplicate_skin) + resto unverified.
- [x] `seedParticipants()` ejecutable; candidates/needs_review generados (auto-match OFF).
- [x] Bosnia: detector de inversión + unresolved bloquea STRONG.
- [x] Value dry-run corre con write=false y **no** escribe tablas oficiales.
- [x] Tests verdes (83 nuevos + regresiones).
- [ ] **Secrets rotados** (Render / Telegram / Odds API ×2 / API-Football) — acción del usuario.
- [x] Migraciones 021-023 revisadas (up/down/re-up).

## Activación por fases (env-only, flags)
1. **Migrar** 021-023 en staging/prod (`db:migrate`), verificar 23/23 → 23+3.
2. **Seed**: `seedParticipants()` + `sourceCatalog.seedAll()` (idempotentes, sin escribir cuotas).
3. **Ingesta corregida** (24–48h): `SPORTSBOOK_PROVIDER_ENABLED/WRITE/SCHEDULER=true`,
   `OPERATIONS_ORCHESTRATOR_ENABLED=true` (+ `OPERATIONS_MANAGED_JOBS=sportsbook_ingestion`),
   `SPORTSBOOK_JOB_TIMEOUT_MS` ajustado a **p95 medido** (no a ciegas). Key 20k en env de prod (no en repo).
4. **Canonical candidates** (auto-match OFF): correr `generateCandidates`; revisar la cola (≥30 eventos, §abajo).
5. **Value dry-run**: `VALUE_ENGINE_ENABLED=true` + `SCHEDULER=true` + `WRITE=false` + `VALUE_SHADOW_RUNS_ENABLED=true`.

## Auditoría manual (≥30 eventos, read-only) — §18
Antes de aprobar mappings: muestra de **10 favoritos + 10 equilibrados + 10 underdogs**, distintas regiones/books,
cercanos y lejanos. Revisar: equipos, home/away, competición, kickoff, market, period, outcomes, timestamps,
source grouping, outliers, canonical mapping. **No** aprobar mappings masivamente; entregar lista para revisión humana.

## Métricas a observar (24–48h)
Duración p50/p95/max del job; `success` vs `partial`/`timed_out`; solapamientos (objetivo **0**); filas
`inserted/updated/unchanged`; crecimiento de current/history (proyección 7d/30d); `disabled_sport_keys`; runs
huérfanos (objetivo 0, reconciliación disponible); distribución Value dry-run PASS/WATCH/LEAN/STRONG/BLOCKED
(**avalancha de STRONG = sospecha**). Invariantes oficiales en 0.

## Pausa de emergencia
Apagar `SPORTSBOOK_PROVIDER_*` (env) → ingesta inerte, datos preservados. Idéntico al corte del 1er shadow.
