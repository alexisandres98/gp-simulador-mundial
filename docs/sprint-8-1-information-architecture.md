# Sprint 8.1 — Arquitectura de información

## Jerarquía de producto (separación de conceptos, §1)
```
Oportunidades (nav inferior #1)
 ├─ Picks GP   → solo Picks GP publicadas (loadPicks). Empty: "Hoy no hay Picks GP."
 ├─ Value      → Value Engine PASS/WATCH/LEAN/STRONG (loadValue). PASS es válido.
 └─ Arbitraje  → solo arbitraje (loadOppArb). Sin Kelly/COMPRAR SÍ/MODEL EDGE.
Rendimiento (Transparencia)
 ├─ Verificable → Metrics Engine desde verified epoch. Empty honesto si signals=0.
 └─ Histórico   → legacy (40-41 partidos), con aviso explícito. Sin afirmar alpha.
Transparencia (menú "Más")
 ├─ Rendimiento · Registro · Metodología
Simulador → GP Intelligence V2 (protagonista) + chip "V2 · Experimental".
```

## Flags de UI (un área activa si su flag on Y (público on O admin+preview on))
`UI_INTEGRATION_V2_ENABLED` (master público) · `UI_ADMIN_PREVIEW_ENABLED` · áreas:
`UI_OPPORTUNITY_TABS_ENABLED`, `UI_VERIFIED_PERFORMANCE_ENABLED`, `UI_GP_INTELLIGENCE_LABELS_ENABLED`,
`UI_OPERATIONAL_STATES_ENABLED`, `UI_NAVIGATION_CLEANUP_ENABLED`, `UI_ALERT_DEFAULTS_V2_ENABLED`.
Con todo off → UI byte-idéntica (verificado).

## Rutas (tabs) — sin cambios destructivos
Conservadas todas. Nuevas/gated: pantalla Rendimiento (reusa #tab-record), sub-tabs en #tab-arb,
nueva sección #tab-methodology. Bottom nav del Mundial intacto (Oportunidades·Partidos·Equipos·Grupos·Más).
