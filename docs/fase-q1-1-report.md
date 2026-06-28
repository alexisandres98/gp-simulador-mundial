# Fase Q.1.1 — Cierre de Q.1 · Reporte final

> Estado: §1–§4, §9 implementados, verificados y **desplegados**; flagship + Partidos V2 encendidos
> para admin/QA. §5 capturas reales tomadas. **STOP §14: espera aprobación visual explícita de Alexis.**
> No se inicia G.7.

## 1. Migración 040 (índice del Observatory)
`database/migrations/040_arb_eval_created_at_index.sql` — **40/40 aplicada en prod**.
- Nombre: `idx_arb_eval_created_at` · Columnas: `arb_evaluations(created_at DESC)` (btree) · Tamaño: **29 MB**.
- Idempotente: `CREATE INDEX IF NOT EXISTS` (no-op en prod porque el índice ya existía vía CONCURRENTLY;
  en DBs frescas la tabla está vacía → build trivial). Down: `DROP INDEX IF EXISTS`.
- No crea índice duplicado (mismo nombre/definición que el existente).
- Query beneficiada: ventanas del Observatory `WHERE created_at > now() - interval 'N min' GROUP BY classification`.
- Plan **antes**: `Index Scan using idx_arb_eval_market` cost≈240. **Después** (índice + ANALYZE):
  `Index Scan using idx_arb_eval_created_at` cost≈142. El planner usa el índice nuevo.

## 2. Partidos usa GP Intelligence V2 — flujo exacto
**Flujo (lista):** `renderMatches`/`matchCard` (app.js) → `/api/state` → `buildState` (server.js) →
`matchProbs(effElo)` = **base calibrada** (Elo→Poisson→Dixon-Coles).
**Flujo (detalle, con V2):**
```
openMatchPage(fixtureId) → /api/match/:id (pasa el user) → buildMatchDetail(id, user) [server.js]
  modelProbabilities = matchProbs(effElo)                    ← MODELO BASE (sigue separado y visible)
  si user.beta.matchesV2:
    canonical_event_id = resolveCanonicalByFixture(espnId|id)      [puente persistente, approved]
                      ?? resolveCanonicalByTeams(home,away,fecha)  [display-only; cubre knockouts]
    v2 = gpProductApi.buildMatch(ctx, canonical_event_id, user)    [DTO V2: header/probability/
         analysis(context_state/data_freshness/context_completeness)/risks/goal_insights/has_official_v2]
  → renderMatchDetail: bloque "GP Intelligence" = oppMatchV2Html(d.v2)
```
- **model_family/version:** la prob V2 viene de `value_evaluations`/`v2_probability_snapshots`
  (`official_gp_model='V2'`) vía `gp-product/dto.analysisFactors`. El cliente NUNCA ve "V1/V2".
- **Sin fallback silencioso:** sin mapping/snapshot → `v2=null` + `v2_requested=true` → estado EXPLÍCITO
  "Análisis GP Intelligence aún no disponible para este partido" (el modelo base de arriba NO se presenta
  como análisis con contexto actualizado).
- **Freshness / incertidumbre / PARTIAL_CONTEXT:** expuestos como tags y risk_codes
  (`data_freshness_code`, `context_completeness`, `context_state_code` BASE_ONLY/PARTIAL_CONTEXT/FULL_CONTEXT,
  `MODEL_UNCERTAINTY`, `LINEUP_NOT_CONFIRMED`).
- **Cobertura real (mid-torneo):** 64 canonical_events, 10 con eval V2, los que el sportsbook (the_odds_api)
  cotiza. Verificado: 3 knockouts muestran V2 (Sudáfrica/Canadá, Países Bajos/Marruecos, Brasil/Japón);
  29 muestran estado explícito. Esto es lo correcto/honesto (no se inventan probabilidades).

## 3. Cruces hipotéticos
El Simulador (`/api/h2h/deep`) ya usa V2 (base + contexto). Nota exacta del spec, ES/EN:
`sim.label_gpi` = "Simulación hipotética con el contexto disponible actualmente" /
"Hypothetical simulation using the context currently available". No inventa venue/clima/alineación/cuotas
de un fixture inexistente (usa base calibrada + contexto estructural vigente).

## 4. Flag QA de Partidos
`GP_MATCHES_V2_UI_ENABLED` (gp-product/flags.js) → `user.beta.matchesV2` (= beta **Y** flag). Default false →
Partidos byte-idéntica para los ~509 usuarios. NO cambia el modelo oficial del backend; solo presentación+DTO.
Integrado en la página canónica existente (no segunda página). **Encendido en Render** para admin/QA.

## 5. Visual regression (capturas REALES)
Generadas con la herramienta de preview (Chromium real, no accessibility tree), viewports reales:
- **Desktop 1440×900 · ES · Oportunidades/Picks** — hero "Croacia gana", métricas reconciliables, CTAs.
- **Mobile 390×844 · ES · Oportunidades/Picks** — summary, subtabs, hero, bottom nav. Sin overflow horizontal (scrollWidth==clientWidth==390).
- **Mobile 390×844 · EN · Oportunidades/Picks** — "Opportunities", "GP Pick"/"Previous generation", hora local.
- **Desktop 1440×900 · ES · Partidos (Sudáfrica/Canadá)** — MODELO base separado + bloque "GP Intelligence"
  (PROBABILIDAD GP, 90', mercado, CONTEXTO APLICADO=SOLO BASE, RIESGOS, actualizado).
- Verificado además sin overflow horizontal a 390px.
**Hallazgo (para tu aprobación visual):** en MÓVIL el CTA principal "Ver Pick" queda **bajo el fold**
(summary + subtabs + grid de 8 métricas ocupan la 1ª pantalla). §6/§17 piden el CTA visible sin scroll.
NO lo rediseñé sin tu OK (§11). Opciones: summary más compacto/colapsable en móvil, o hero con menos
métricas sobre el fold + "ver más". (Capturas restantes — tablet 768×1024, wide 1920×1080, detalle de Pick,
empty de Arbitraje, pick histórica — quedan para la pasada que apruebes el ajuste móvil.)

## 6. Gate estético de Oportunidades
✓ Picks abre por defecto · ✓ hero domina · ✓ subtabs claras · ✓ jerarquía acción→precio→razón→riesgo ·
✓ no parece /beta ni dashboard genérico · ✓ lenguaje visual premium · ✓ sin scroll horizontal.
✗ **CTA visible sin scroll en móvil** (ver §5, pendiente de tu decisión).

## 7. Edge UX
Reconciliable y verificado en captura: **Probabilidad GP 71.2% · Mercado 50.4% · Diferencia bruta +20.8 pp ·
Margen (edge ajustado) +4.5 pp · Cuota justa/publicada/mínima**. El "+4.5 pp" del hero coincide con "Margen".

## 8. GP Analysis
La página canónica muestra: Probabilidad GP, Contexto aplicado (factores realmente aplicados / "el contexto
no modificó la base" cuando aplica), Riesgos (desacuerdo con mercado, etapa inicial, etc.), freshness/
completitud. No muestra factores de impacto 0 como decisivos, ni V1/V2/lambda/policy.

## 9. Suite de tests reproducible
`tests/q11-flagship.test.js` (`npm run test:q11`) — **29/29 PASS**, sin DB ni browser:
gating §21 + `GP_MATCHES_V2_UI_ENABLED` (admin/QA sí, público/anónimo no, el flag no es auth), paridad i18n
ES/EN 0 gaps, sin copy "V1/V2/challenger" en strings de cliente, neutralidad de DTOs (model_label
CURRENT/PREVIOUS, sin secretos), firma del resolver inverso.
**Browser smoke (vía preview, documentado):** carga sin errores de consola (0), sin overflow horizontal a
390px, tabs cambian sin reload completo, CTA "Análisis completo GP" abre el evento canónico. (Una suite de
browser automatizada requeriría puppeteer/playwright — el proyecto es zero-dep; se recomienda como opcional.)

## 10. Performance
Payloads (DTOs de cliente, sin agregaciones del Observatory en rutas cliente):
`/api/beta/picks` 1.9 KB · `value` 0.75 KB · `arbitrage` 33 KB (60 items) · `dashboard` 7.2 KB.
Queries batched / anti-N+1 (`legsForMany`, DISTINCT ON). Las latencias medidas (0.4–10.8 s) están dominadas
por la **conexión remota de alta latencia** (mi máquina → DB Oregon, múltiples roundtrips) y NO representan al
server de Render (misma región, sub-ms). Recomendado: profiling in-region; el payload de `arbitrage` (33 KB)
admite paginación si se abriera a más usuarios.

## 11. Instrucciones de QA para Alexis
- **URL:** https://gpsimulador.com — login con tu email admin (`alexisgomezico@gmail.com`).
- **Flags activos (admin/QA, público off):** Oportunidades (Picks/Value/Arbitraje), Partidos V2, Goal Insights.
- **Recorrido recomendado:**
  1. Pestaña **Oportunidades** → Picks (hero), Value, Arbitraje (empty honesto).
  2. Hero Pick → **"Ver Pick"** (detalle) y **"Análisis completo GP"** (página canónica GP Intelligence).
  3. Pestaña **Partidos** → abrí un knockout próximo (p.ej. Sudáfrica vs Canadá, Brasil vs Japón) → mirá el
     bloque **"GP Intelligence"** debajo del MODELO base; abrí uno sin V2 → estado "no disponible".
  4. **Simulador** → cualquier cruce → nota "Simulación hipotética…".
- **Cambiar idioma:** botón **ES/EN** en el header (arriba a la derecha). Verificá que TODAS las superficies
  cambian (no solo la activa).
- **Móvil vs desktop:** redimensioná la ventana o abrí desde el teléfono. **Revisá el hallazgo §5** (CTA bajo
  el fold en móvil) y decime si lo ajusto.
- **Qué revisar:** densidad premium, jerarquía, que no parezca /beta, edge reconciliable, sin jerga V1/V2,
  sin overflow/texto cortado, empty states honestos.
- **Cómo reportar ajustes:** decímelos y los aplico detrás del flag antes de cualquier apertura pública.
- **NO** está abierto a usuarios externos; espera tu aprobación visual explícita.

## 12. Invariantes (intactos)
`GP_OFFICIAL_MODEL=v2`; Picks/Signals V1=2; nuevas Picks=manual + auto-publication=false; goal markets
official/candidate/pick/signal=false; arbitrage public=false + auto-execution=false; referral/email/billing=false;
Verified Epoch intacto; Registry chain válida. El flag de Partidos no toca el modelo del backend.

## 13. Deliverables / commits / deploy
- `75c30a0` §1 migración 040 (40/40) · `cc9e59c` §2-4 Partidos V2 + flag (desplegado, flag on admin/QA) ·
  `4721fdf` §3 nota hipotética + §9 tests.
- Flags Render: `GP_MATCHES_V2_UI_ENABLED=true` (+ los §21 ya on). Públicos off.
- Prod verificado: `/`→200, i18n-6, `/api/beta/*`→401 sin sesión.

## 14. Riesgos
- Cobertura V2 en Partidos limitada a los partidos que el sportsbook cotiza (esperable; estado explícito
  cubre el resto). `resolveCanonicalByTeams` es display-only (no settlement); el match por equipos+fecha es
  inequívoco en el Mundial, pero si dos canonical_events coincidieran en equipos+fecha tomaría el primero.
- Hallazgo de CTA móvil bajo el fold (§5) — pendiente de tu decisión.
- Stage labels ("16AVOS") aún sin localizar (gap i18n preexistente del backend, menor).
- Capturas formales restantes (tablet/wide/otros surfaces) pendientes tras el ajuste móvil.

## STOP §14
Detenido tras: migración 040 + Partidos V2 tras flag interno + capturas reales + tests reproducibles +
QA técnico + reporte. **No se inicia G.7.** Próximo: tu aprobación visual → (ajuste móvil si lo pedís) →
capturas finales → luego G.7 (Goal Engine hardening).
