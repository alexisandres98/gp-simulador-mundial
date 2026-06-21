# Sprint 4 — Arquitectura de producto (oportunidades ejecutables)

La capa que **explica, controla y presenta** lo que el motor de arbitraje (Sprint 3) calcula.
El Sprint 3 calcula; el Sprint 4 no recalcula el arbitraje: lo redacta, lo somete a revisión humana,
lo publica de forma controlada, lo revalida y lo presenta. Móvil primero, seguro, en español.

## Flujo
```
Arb evaluations (Sprint 3, inmutables)
  → Publication eligibility   (exec-opportunities/eligibility.js)
  → Manual review + approval  (publicationService.js, admin)
  → Publication snapshot      (arb_publications.public_payload congelado)
  → Continuous revalidation   (revalidation.js)
  → Public / internal API     (server.js)
  → Opportunity cards/detail  (public/app.js, xo-*)
  → Calculator / deep links / jurisdiction
```

## Módulos (`exec-opportunities/`)
| Archivo | Rol |
|---|---|
| `config.js` | Flags `EXEC_OPPORTUNITIES_*` + umbrales `EXEC_PUBLIC_*`. Invariante: `autoPublicationBlocked=true` siempre. |
| `presentation.js` | Evaluación → `public_payload` por **lista blanca** (redacción). Card = proyección del detalle. |
| `eligibility.js` | Política de elegibilidad de publicación (estándar superior al de detección). Puro. |
| `revalidation.js` | Revalidación continua / ocultamiento automático. Usa la evaluación ACTUAL, no el histórico. |
| `breakpoints.js` | Hardening del size optimizer (oráculo + búsqueda en breakpoints + comparador). |
| `calculatorService.js` | Calculadora de capital server-side. No guarda capital. Usa breakpoints. |
| `deepLinks.js` | Generador versionado + allowlist de dominios + validación. |
| `jurisdiction.js` | Capa informativa de disponibilidad por país (no legalidad). |
| `publicationService.js` | Máquina de estados de publicación, atómica y auditada. **Sin auto-publicación.** |
| `adapters.js` | Reconstruye la "vista de evaluación" desde DB (camino con datos vivos). |
| `analytics.js` | Eventos mínimos. Nunca guarda capital/bankroll. |
| `index.js` | Fachada admin/pública + gating + overlay (jurisdicción/deep links al vuelo). |
| `repositories/` | publication, history, jurisdiction, deepLinkTemplate, analytics. |
| `fixtures/golden-ui.js` | 10 casos golden evaluados por el motor real. |

## Principios
- **Simple en la superficie, riguroso al profundizar**: la card muestra el NETO; el detalle abre el desglose técnico en paneles colapsables.
- **Una evaluación ≠ una publicación**: solo el admin publica, manualmente.
- **Activa = vigente**: la vista pública usa `current_evaluation`/revalidación reciente, nunca `best_net_roi` histórico.
- **Inerte por defecto**: con flags apagados, la app es idéntica y no aparecen rutas nuevas.
- No toca: Elo, Poisson, Dixon-Coles, Monte Carlo, GP Intelligence, track record, arbitraje legacy, alertas, Telegram, email, auth, SSE.
