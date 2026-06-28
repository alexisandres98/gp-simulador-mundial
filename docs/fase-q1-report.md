# Fase Q.1 — Unificación del producto en la plataforma principal · Reporte final

> Estado: A, B, C, D **desplegados** en prod (inertes/seguros). Flagship **encendido para admin/QA**.
> E (este reporte + Observatory perf) en curso. Pendiente: G.7 (Goal Engine).

## 1. Arquitectura unificada
La plataforma principal (`public/app.js`, ~3000 líneas, vanilla JS sin build) es la base
canónica. Toda la infra nueva (`gp-product/*` DTOs, `i18n/dictionary.js`, gates de arbitraje
de Fase R) se **fusionó dentro de `app.js`** reusando su shell/header/ticker/dark-theme/cards.
No se creó una segunda app. `/beta` queda como sandbox interno.

## 2. Componentes actuales reutilizados
Shell, header, ticker de mercados, dark theme, navegación desktop+móvil, cards `.feat`/`.xo-card`/
`.dualcard`/`.val-grid`, barras de probabilidad `.pbar`, `panel()`, `du()`, `xe()`, estados live,
banderas, tablas. El flagship usa estas clases — no cards planas de `/beta`.

## 3. Componentes de /beta reutilizados
DTOs neutrales (`gp-product/dto.js`, `repository.js`, `api.js`, `arbitrage.js`, `flags.js`),
diccionario `i18n/dictionary.js`, y la lógica de render de `beta.js` (adaptada al estilo premium
de `app.js`). Endpoints `/api/beta/*` (betaGuard) reutilizados tal cual.

## 4. /beta status
Intacto, sigue gateado por `GP_BETA_UI_ENABLED` + admin/allowlist. NO se borró (verificar paridad
primero). Recomendación posterior: dejarlo solo-admin con aviso de sandbox.

## 5. Navegación final
Oportunidades es la 1ª pestaña. Subtabs **Picks → Value → Arbitraje** (Picks default),
deep-link `/#opportunities/{picks,value,arb}`. El resto de superficies conservadas.

## 6. Oportunidades flagship
1ª pantalla, home premium (mejor Pick / mejor Value / activas / última actualización), subtabs
gateadas por flag §21. Cada subtab consume DTOs V2.

## 7. Picks (desktop/mobile)
Hero Pick premium (`oppHeroPick`) con equipos, kickoff localizado, selección, Prob GP, prob mercado,
diferencia bruta, edge ajustado, cuota justa/publicada/mínima, calidad, principal riesgo, CTAs
"Ver Pick" + "Análisis completo GP". Lista (`oppPickCard`) + detalle (`openOppPick`). Badge de
PRODUCTO "Pick GP"; históricas V1 con etiqueta discreta "Etapa anterior". Estados de ciclo de vida.

## 8. Value (desktop/mobile)
Scanner (`oppValueCard`) con clasificación (STRONG/LEAN/WATCH), Prob GP, mercado, diferencia bruta,
edge ajustado, mejor cuota/mínima, sportsbook, calidad, blockers. Filtro ACTIONABLE. Card → análisis canónico.

## 9. Arbitraje (desktop/mobile)
`loadOppArbV2` muestra SOLO ejecutables (los bloqueados/stale nunca se presentan como oportunidad —
quedan en Admin Observatory). Empty honesto ("Cero ejecutables es un resultado válido"). Sin "dinero
gratis"/"ganancia garantizada". `public=false`, `auto-execution=false` intactos.

## 10. Página GP Intelligence (canónica)
`openMatchV2(canonical_event_id)` → una sola página de análisis por evento, alcanzable desde
hero/lista/detalle de Picks y cards de Value. Consume `/api/beta/match/:id`.

## 11. Contexto V2 visible
Header, Probabilidad GP 1X2 + regulación 90', mercado comparativo, clasificación (eliminatorias),
contexto aplicado (factores/ajuste neto/estado/frescura), riesgos, goles (si flag). Sin "V1/V2".

## 12. Simulador V2
Ya computaba V2 (`/api/h2h/deep` = base + contexto). Copy §12 limpiado: sin "Experimental";
decomposición/trazabilidad "Probabilidad inicial → Probabilidad GP final"; verdict del backend
(`gpIntelligence.js`) reescrito sin "(V1)/(V2)".

## 13. Partidos / Equipos / Grupos / Bracket
Auditados (Bloque C): usan la **base calibrada** (Elo→Poisson→DC→calib) o el Monte Carlo del
torneo (proyecciones de campeón/avance, sin contexto per-fixture = correcto por diseño). **Ninguna
superficie usa "V1 legacy" silenciosamente.** Mejora opcional (no hecha): 1X2 de Partidos con
contexto per-fixture (cambia el 1X2 que ven los usuarios → requiere decisión).

## 14. Goal Insights
Sigue "en validación" (sin Pick/Signal/Value/Candidate oficial). Visible solo con `GP_GOAL_INSIGHTS_UI_ENABLED`.

## 15-16. i18n ES / EN
Diccionario `i18n-6`, **918 keys/locale, paridad 0**. Migradas ~325 strings legacy + flagship
nativo bilingüe. Toggle de idioma global en header; `setLang()` re-renderiza TODAS las superficies.
Admin-internos quedan en ES (§12).

## 17. Design system
Reusa tokens/clases existentes (`.feat`/`.xo-*`/`.val-*`/`.dualcard`/`.seg`/`.pbar`/`panel`). Badges
de estado (`.xo-pill`, `.val-badge`), grados. No se introdujo un dashboard genérico.

## 18. Microinteracciones
Segmented control de subtabs, deep-link sin recarga, hover/focus de cards, CTAs claros. (Animaciones
avanzadas — pulse de cambio de precio/edge — pendientes, no críticas.)

## 19. API / DTOs
`/api/beta/{bootstrap,dashboard,match/:id,value,picks,picks/:id,history,arbitrage,arbitrage/:id}` —
códigos neutrales, ISO UTC, sin secretos/identidades/HTML. Anti-N+1 (`legsForMany`, batched).

## 20. Auth / flags
Flags §21 en `gp-product/flags.js`: `GP_OPPORTUNITIES_{PICKS,VALUE,ARBITRAGE}_ENABLED`,
`GP_BETA_ACCESS_ENABLED` (default false). `user.beta.opportunities={enabled,picks,value,arbitrage}`.
Cada subtab requiere acceso beta **Y** su flag (el flag NO sustituye auth). `betaGuard` server-side.
**Encendidos en Render para admin/QA** (público off).

## 21. Performance
DTOs cliente (no payloads crudos), queries batched/DISTINCT ON, anti-N+1. Sin 1.3M filas al cliente.

## 22. Observatory optimization (§23)
Las ~9 queries de ventana del observatory filtran `arb_evaluations` (1.37M filas) por `created_at`
sin un índice dedicado (usaban oportunísticamente `idx_arb_eval_market`). Se creó
`idx_arb_eval_created_at ON arb_evaluations(created_at DESC)` con **`CREATE INDEX CONCURRENTLY`**
(no bloquea lecturas/escrituras; el engine siguió evaluando) + `ANALYZE`. Tras el ANALYZE el
planner **pasó a usar el nuevo índice** (Index Scan dedicado; costo estimado ~240→~168) y escala
con el crecimiento de la tabla. NOTA: las mediciones de wall-clock (~0.9–1.8s) se hicieron sobre
una conexión **remota de alta latencia** (~200ms RTT) y NO representan al server de Render, que
está en la misma región (Oregon) que la DB y opera sub-ms; en producción el observatory es
sustancialmente más rápido que esas mediciones.

## 23. Visual regression (§25)
La herramienta de screenshot del entorno presentó glitches; la verificación se hizo por
**snapshot de texto + accessibility tree + console logs** (0 errores) en ES y EN, desktop, sobre
todas las superficies. Capturas formales pendientes para una pasada dedicada.

## 24. Tests (§26)
Cobertura existente verde: `gp-product` (flags/DTOs/i18n parity), value-engine, ui-flags, arb-*.
Verificación funcional en preview live contra DB prod (gating §21, render premium, ES/EN, 0 errores).

## 25. Migrations
Sin migraciones nuevas en código (39/39). El índice del observatory se añadió vía CONCURRENTLY
directo (no transaccional); recomendado formalizarlo en una migración 040 (`CREATE INDEX IF NOT EXISTS`).

## 26. Commits / deploy
- `13348fc` Bloque A (flagship + flags §21) — inerte.
- `243c701` Bloque B (copy §12 + página canónica).
- `70bc463` Bloque D (i18n total ES/EN).
- Flags `GP_OPPORTUNITIES_*=true` en Render + Manual Deploy → flagship encendido admin/QA.

## 27. QA
Verificado en preview live (server local + DB prod): data-path V2 end-to-end, render premium ES/EN,
toggle de idioma, página canónica, simulador sin V1/V2, flagship intacto, 0 errores de consola.
Prod: `/`→200, `/api/beta/*`→401 sin sesión, gating §21 correcto.

## 28. Invariantes (todos intactos)
`GP_OFFICIAL_MODEL=v2`; Picks/Signals V1=2 (no reescritas); nuevas Picks=manual+doble confirmación;
goles official/candidate/pick/signal=false; arbitrage public=false + auto-execution=false; billing=false;
Verified Epoch `2026-06-26T17:29:19.815Z` intacto; cadena del Registry válida; nombre = GP Simulador.

## 29. Riesgos
- i18n: superficies admin-internas + algunos error-fallbacks siguen en ES (permitido §12); posibles
  strings profundos sin migrar (no regresión — eran ES antes). Mitiga: el toggle solo mejora paridad.
- El índice del observatory se creó fuera del framework de migraciones (drift potencial) → formalizar.
- Mejora opcional de Partidos 1X2 con contexto: cambiaría el 1X2 live → requiere decisión del usuario.

## 30. Recomendación para G.7 y acceso beta
- **G.7 (Goal Engine hardening):** próxima fase. Goles siguen "en validación"; no habilitar mercados
  de goles hasta corrección matemática + gate.
- **Acceso beta:** el flagship está listo detrás de flags admin/QA. Para abrir a beta externa:
  Fase S (referidos + elegibilidad), T (email/onboarding), U (QA final + apertura). NO abrir antes
  de verificar paridad de `/beta` y completar visual regression formal.
