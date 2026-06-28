# Rediseño Premium — CORTE 2.1 (hardening) + CORTE 3 (Partidos + Simulador)

**Fecha:** 2026-06-28 · Todo aislado en `/x` detrás de `GP_PREMIUM_UI_ENABLED`. La plataforma de los 509 usuarios
queda intacta. Corte 2 quedó **aprobado** por Alexis; esto cierra los ajustes obligatorios y construye Partidos +
Simulador premium.

## PARTE A — Corte 2.1: hardening (8 ítems)

- **A.1 Confianza — fuente única.** Nuevo módulo PURO `gp-product/confidence.js` (`LOW/MEDIUM/HIGH`,
  determinístico). El DTO `/api/beta/match` expone `confidence_code`. En el cliente, **un solo valor** controla el
  badge; el copy de riesgo ya NO afirma ningún nivel (se quitó "se mantiene moderada" / "stays moderate"). Tests
  `tests/premium-confidence.test.js` (10/0) que fallan si el badge y la narrativa difieren, si el valor no es del
  enum, o si reaparece copy de nivel en el riesgo.
- **A.2 Renombrado.** "Mayor desacuerdo" → **"Mayor desacuerdo GP–mercado" / "Largest GP–market disagreement"** +
  tooltip aclarando que un desacuerdo no implica oportunidad ejecutable. No se clasifica como Value.
- **A.3 Fila seleccionada.** Borde izq teal + tinte muy bajo (.045) + outline tenue; selección de navegación
  separada de la intensidad de señal LEAN/STRONG.
- **A.4 Mercados responsive.** En móvil cada resultado/proveedor es una **card apilada** (cuota/implícita/sin
  margen/liquidez/movimiento); matriz densa solo en desktop; sin scroll horizontal.
- **A.5 Data Trust de alineaciones.** Estados `CONFIRMED/PROBABLE/UNAVAILABLE/STALE` con fuente + freshness en
  tooltip. "Confirmada" solo con evidencia verificable (lista real + flag confirmado); sin esa evidencia → Probable.
- **A.6 Copy.** "Datos no disponibles", "4 partidos · Probabilidad GP", frescura contextual **"Datos recientes" vs
  "Precio reciente"** según lo que se califica. Paridad ES/EN, sin hardcode.
- **A.7 Navegación interna.** Barra de secciones **sticky** (Resumen/Probabilidad/Mercados/Contexto/Goles/En vivo)
  con scroll-spy (IntersectionObserver) en desktop y móvil.
- **A.8 QA del Live.** `public/premium-qa.js` con fixtures determinísticos (`#match/qa-live`, `#match/qa-finished`)
  que se sirven e inyectan **solo** con `GP_PREMIUM_QA_ENABLED=true` (preview interno; en prod el flag está apagado
  → 404, nunca visible para usuarios, nunca mezclado con la DB real). Permitió verificar el módulo Live
  (marcador/minuto/eventos/stats/prob-live-modelo/freshness) sin fabricar datos en producción.

## PARTE B — Corte 3: Partidos premium

Nueva vista `/x#matches`. Calendario completo desde `/api/state` (group + knockout) **enriquecido** con el nuevo
endpoint `/api/beta/matches` (eventos canónicos con GP 1X2 + resumen de value), cruzados por equipos+fecha.
- Filtros **Todos / En vivo / Próximos / Finalizados** + selector de fase + búsqueda por equipo; agrupado por día
  (Hoy/Mañana/fecha).
- Por partido: hora+fase, equipos+banderas, estado (live/marcador/scheduled/finalizado), **Probabilidad GP 1X2** y
  **señal** cuando hay GP Intelligence; si no, estados explícitos **"GP Intelligence no disponible" / "Mercado no
  cargado"** (sin guiones ambiguos).
- Desktop = board calendario; móvil = cards. Diferenciada de Oportunidades (calendario/estado/entrada a GP, no otro
  Value board). Las filas con GP abren la **misma página canónica** del cockpit.

## PARTE C — Corte 3: Simulador premium

Nueva vista `/x#sim`. Consume `/api/h2h/deep` (no duplica probabilidades ni cockpit).
- Selector A/B con banderas, Elo, intercambiar, "Simular cruce". **Aviso hipotético permanente.**
- Resultado = experiencia GP Intelligence: **Hero** (Prob GP 1X2 + xG + marcador + BTTS + nº simulaciones +
  confianza), **Decision Memo hipotético** (Veredicto/Tesis/Riesgo) donde **Precio = "No se evalúa precio porque
  este cruce no corresponde a un mercado programado."** (sin inventar precio/edge/Value/Pick), **Contexto**
  narrativo (forma/bajas/factores), **Monte Carlo** (10k: 1X2, O/U, BTTS, goles promedio, scorelines, histograma de
  totales), **Goles "en validación"** (sin Picks/Value).
- **Nunca expone V1/V2/challenger/lambda/delta** (verificado: 0 fugas en el DOM); usa "probabilidad inicial →
  Probabilidad GP final".

## QA (preview :3011, DB prod read-only, admin)
- Viewports 1440×900 y 390×844: **sin overflow horizontal** en cockpit, Partidos y Simulador.
- ES/EN: toggle re-renderiza Partidos y Simulador completos; **0 keys crudas**, **0 errores de consola**.
- Verificado: QA Live (prob-live/stats/eventos/Confianza Media sin contradicción/Alineación Confirmada/Datos
  recientes), Partidos (Todos 88 / Próximos con GP+señal / "GP Intelligence no disponible" honesto), Simulador
  (BRA vs ARG: hero/memo/Monte Carlo/goles-en-validación, precio no evaluado, sin fuga V1/V2).
- Capturas reales: cockpit QA-Live (desktop+móvil ES), Partidos Todos/Próximos (desktop), Simulador (desktop+móvil).

## Tests
- `premium-confidence` 10/0 · `gp-product` 41/0 (se corrigió una aserción i18n **stale** de sesión previa: i18n-3 →
  i18n-6) · `value-engine` 36/0.
- **NOTA:** `tests/ui-flags.test.js` tiene 6 fallos **pre-existentes** sobre `public/app.js` (gating viejo de
  Sprint 8.1 que Q.1 reemplazó por el flagship V2). **No toqué `app.js` esta sesión** → no son regresión de Corte
  2.1/3; quedan para una limpieza aparte de esos tests.

## Invariantes (intactos)
GP_OFFICIAL_MODEL=v2 · Picks/Signals históricas · Registry · Verified Epoch · usuarios/auth/sesiones/betaGuard ·
auto-publication/goals-públicos/arbitraje-público/billing OFF · nombre **GP Simulador**. **No se fusionó `/x` con la
plataforma principal. No se inició Equipos/Grupos/Bracket/Evolución/Seguidos/Alertas. G.7 sin tocar.**

## Archivos
- `public/premium.{js,css}` — hardening + Partidos + Simulador.
- `public/premium-qa.js` (nuevo) — fixtures QA gated.
- `gp-product/confidence.js` (nuevo) + `gp-product/api.js` (confidence_code + `/api/beta/matches`) +
  `gp-product/flags.js` (`premiumQa`).
- `server.js` — serving/inyección gateada de premium-qa.js.
- `tests/premium-confidence.test.js` (nuevo), `tests/gp-product.test.js` (fix i18n stale).

## STOP
Detenido tras Corte 2.1 + Partidos + Simulador + deploy interno + capturas + reporte. **Esperando aprobación.** No
iniciar Equipos/Grupos/Bracket/Evolución/Seguidos/Alertas, fusión con la plataforma principal, referidos,
onboarding ni G.7.
