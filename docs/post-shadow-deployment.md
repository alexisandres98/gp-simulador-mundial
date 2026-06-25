# Post-Shadow — Plan de Deploy

> Código **inerte** → migraciones → verificación → activación controlada. **Sin deploy/commit/push** hasta
> aprobación explícita. La app pública y los usuarios no se ven afectados (todo nuevo está detrás de flags off).

## 1. Inertness (estado actual)
Todos los módulos nuevos no hacen nada con los flags por defecto:
- `sportsbook-providers/*` inerte sin `SPORTSBOOK_PROVIDER_ENABLED`.
- Value dry-run requiere `VALUE_ENGINE_ENABLED` + `SCHEDULER`; escritura shadow requiere `VALUE_SHADOW_RUNS_ENABLED`.
- Retención pausada (`SPORTSBOOK_RETENTION_ENABLED=false`).
- Canonical auto-match OFF (`CANONICAL_AUTO_MATCH_ENABLED=false`).
- Tablas nuevas vacías. La ingesta no escribe raw legacy (`SPORTSBOOK_RAW_LEGACY_WRITE_ENABLED=false`).

## 2. Migraciones (aditivas 021-023)
`DATABASE_URL=<externo> DB_SSL=true npm run db:migrate` → de 20/20 a **23/23**. up/down/re-up validados
(`tests/post-shadow-*-db.test.js`). **No** modifican migraciones aplicadas; **ningún cambio destructivo** sobre
las 283k filas existentes. Rollback probado (revierte solo 021-023, preserva 015/017 y todo lo previo).

## 3. Verificación post-migración
Rutas nuevas 404 con flags off; `/api/health` 200; pipeline arb (S1-3) sano; `db.json` y usuarios intactos;
`schema_migrations` = 23.

## 4. Activación controlada (orden, env-only)
Igual que [`second-shadow-plan.md`](second-shadow-plan.md): seed → ingesta corregida (24–48h, timeout por p95) →
canonical candidates (auto-match OFF, revisión manual) → Value dry-run (write=false, shadow). **No** activar:
Value persistido, Picks, Registry write, verified epoch, closing, settlement, alertas, analytics, billing,
auto-publicación. Esos siguen su propio plan por fases tras validar el dry-run.

## 5. Flags (todos OFF por defecto — §20 del spec)
```
SPORTSBOOK_PROVIDER_ENABLED/WRITE/SCHEDULER=false   SPORTSBOOK_RAW_LEGACY_WRITE_ENABLED=false
SPORTSBOOK_RETENTION_ENABLED=false  SPORTSBOOK_RETENTION_DRY_RUN=true
CANONICAL_MATCHING_SCHEDULER_ENABLED=false  CANONICAL_AUTO_MATCH_ENABLED=false
VALUE_ENGINE_ENABLED/SCHEDULER/WRITE=false  VALUE_ADMIN_PREVIEW/PUBLIC=false  VALUE_SHADOW_RUNS_ENABLED=false
PICKS_*=false  SIGNAL_REGISTRY_WRITE/PUBLIC=false  SIGNAL_{CLOSING,SETTLEMENT,COMMITMENT}_SCHEDULER=false
USER_ALERTS_*=false  BILLING/CHECKOUT/PAYWALL=false
```

## 6. Secrets (acción del usuario, pre-deploy)
Rotar lo expuesto: `RENDER_API_KEY`, `TELEGRAM_BOT_TOKEN`, ambas keys de The Odds API (vieja 500 + nueva 20k),
API-Football. La key 20k (`f214ddd2…`) entra **solo** a `SPORTSBOOK_PROVIDER_API_KEY` en env de prod al autorizar
el deploy — nunca en repo/logs/fixtures.

## 7. Procedimiento (cuando se autorice)
`git add` (solo archivos nuevos/modificados de esta fase) → commit (Co-Authored-By) → push → `db:migrate`
(021-023) → Manual Deploy (Render API) → verificar 404/health/migraciones → activar flags por fases.
