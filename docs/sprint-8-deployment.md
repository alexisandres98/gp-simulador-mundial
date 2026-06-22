# Sprint 8 — Despliegue por fases (gated)

**No desplegar al terminar.** Código INERTE. Reporte primero. Billing SIEMPRE off.

## Estado de construcción
- **8A**: orquestador de operaciones, proveedor real de sportsbooks (The Odds API), freshness/degradación,
  cableado closing/settlement/commitment, alertas de usuario, preferencias, onboarding, analítica/retención,
  referrals. **CONSTRUIDO + PROBADO (inerte)**.
- **8B**: entitlements, access grants, planes, waitlist GP Pro, billing abstraction (noop, forzado off),
  competition registry. **CONSTRUIDO + PROBADO (inerte)**.
- **Validación real**: PENDIENTE (falta API key de sportsbooks + cobertura 1X2 ≥72h) → estado del pipeline
  Value/Picks = **COMPLETADO CON PENDIENTE DE ACTIVACIÓN REAL** (§110). El resto es activable ya.

## Migraciones nuevas (aditivas, up/down probadas, rollback deja intactas las previas)
- `016_operations.sql` — operational_job_runs, operational_dead_letters, admin_audit_events.
- `017_sportsbook_provider.sql` — extiende sportsbook_quotes + sportsbook_source_metadata + sportsbook_provider_state.
- `018_alerts_preferences_onboarding.sql` — user_preferences, user_onboarding_state, user_alerts, alert_delivery_attempts.
- `019_analytics_referrals.sql` — product_events, analytics_*, referral_*.
- `020_entitlements_commercial.sql` — plans, features, plan_features, user_access_grants, entitlement_overrides, pro_waitlist, competition_registry.

## Variables nuevas (solo nombres; valores en Render, NUNCA en repo)
Operaciones: `OPERATIONS_ORCHESTRATOR_ENABLED`, `OPERATIONS_JOB_WRITES_ENABLED`, `OPERATIONS_ADMIN_ENABLED`,
`OPERATIONS_TICK_INTERVAL_MS`, `OPERATIONS_*`.
Sportsbooks: `SPORTSBOOK_PROVIDER_ENABLED`, `SPORTSBOOK_PROVIDER_WRITE_ENABLED`, `SPORTSBOOK_PROVIDER_SCHEDULER_ENABLED`,
**`SPORTSBOOK_PROVIDER_API_KEY`** (solo entorno), `SPORTSBOOK_PROVIDER_REGIONS`, `SPORTSBOOK_PROVIDER_MAX_REQUESTS_PER_RUN`,
`SPORTSBOOK_PROVIDER_QUOTA_RESERVE_PERCENT`, `SPORTSBOOK_*`, `SPORTSBOOK_MAX_*`.
Freshness: `FRESH_*_AGING_MS`, `FRESH_*_STALE_MS`.
Alertas/prefs: `USER_ALERTS_ENABLED/GENERATION/DELIVERY/IN_APP/EMAIL/TELEGRAM_ENABLED`, `USER_PREFERENCES_ENABLED`, `ONBOARDING_V2_ENABLED`.
Analítica/referrals: `PRODUCT_ANALYTICS_ENABLED`, `PRODUCT_ANALYTICS_WRITE_ENABLED`, `REFERRALS_ENABLED`, `REFERRAL_REWARDS_ENABLED`.
Comercial: `ENTITLEMENTS_ENABLED`, `WORLD_CUP_FREE_ACCESS_ENABLED`, `PRO_WAITLIST_ENABLED`, `POST_WORLD_CUP_COMPETITIONS_ENABLED`.
Billing (FORZADOS off en código): `BILLING_ENABLED`, `BILLING_PROVIDER=none`, `BILLING_STRIPE_ENABLED`, `CHECKOUT_ENABLED`,
`CUSTOMER_PORTAL_ENABLED`, `PAYWALL_ENABLED`, `SUBSCRIPTION_ENFORCEMENT_ENABLED`.

## Plan de fases (§114)
1. **Inerte** — push + migraciones 016-020, todos los flags off. App legacy idéntica (verificado: rutas nuevas 404, /api/health 200).
2. **Observabilidad interna** — `OPERATIONS_ORCHESTRATOR_ENABLED=true` + `OPERATIONS_ADMIN_ENABLED=true`, writes off. Solo status/dry-run.
3. **Sportsbook shadow** — poner `SPORTSBOOK_PROVIDER_API_KEY` + `SPORTSBOOK_PROVIDER_ENABLED/WRITE/SCHEDULER=true`. Ingesta 1X2 prematch (Value write off).
4. **Canonical review** — revisar mappings, confirmar 1X2, source groups, freshness, cuota.
5. **Value dry-run** → 6. **Value persistido interno** → 7. **Registry/closing/settlement** (epoch real, sin backdatear) → 8. **Picks internas** (manual) → 9. **Alertas in-app** → 10. **Beta pública** (solo tras validación real) → 11. **Email/Telegram opt-in** → 12. **Analytics/referrals/waitlist** → 13. **Post-Mundial** (competiciones validadas).
- **Billing**: permanece `false` SIEMPRE. La monetización real es una fase posterior con aprobación explícita.

## Activación del registro verificable (§111)
`SIGNAL_REGISTRY_VERIFIED_EPOCH` = timestamp real de activación (NO backdatear). Orden: registry → write → epoch → V1 manual → pick interna → closing → settlement → metrics.

## Prerequisito de validación real del pipeline (§110)
≥72h de ingesta de sportsbooks, ≥30 mercados 1X2, ≥3 grupos de independencia, mappings revisados, no-vig y consenso reproducibles, revisión manual de TODAS las STRONG. Sin esto: **no público**.
