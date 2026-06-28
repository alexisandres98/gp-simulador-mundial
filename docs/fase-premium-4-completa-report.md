# FASE PREMIUM 4 — Reporte FINAL (4H superficies de torneo + §29 Observatory + 4B/4A)

**Fecha:** 2026-06-28 · Todo en `/x` detrás de `GP_PREMIUM_UI_ENABLED`. Plataforma de los 509 usuarios intacta.
Continuación directa del slice previo (commit `531d51d`). Este corte completa las **superficies de torneo (4H)**,
el **Observatory de cobertura (§29)** y el **plumbing de 4B/4A**.

## 4H — Superficies de torneo premium (todas en `/x`, reusando datos existentes)

Sistema de vistas extendido (routing por hash + nav sidebar/bottom cableada): `#teams #team/<ID> #groups
#bracket #evo #registry #method #admin`. Todas abren la **misma página canónica** del cockpit donde corresponde.

- **Equipos** (`#teams`) — ladder por probabilidad de campeón (barras), Elo, grupo, avance; búsqueda; 48 equipos;
  fila → detalle.
- **Equipo detalle** (`#team/ARG`) — desde `/api/teamdetail/:id`: hero (Elo/rank), probabilidades **Campeón/Final/
  Semis/Cuartos/Avanza** (Monte Carlo del torneo, con nota), **próximo partido** + **partidos recientes** (link al
  cockpit canónico/fx), **forma reciente** (V/E/D en ES), **bajas**, **noticias**. Sin perder datos de la superficie
  anterior.
- **Grupos** (`#groups`) — 12 tablas reales (PJ/Pts/GF:GC) + **probabilidad de avanzar** (1º+2º) por equipo;
  filas → equipo. Nota aclaratoria de "Avanza".
- **Bracket** (`#bracket`) — 5 rondas (16avos→Final) navegables; cada cruce resuelto abre el cockpit; **separa
  explícitamente "Probabilidad 1X2 a 90 min (no es probabilidad de avanzar)"**; futuros "Por definir". No confunde
  empate reglamentario con clasificación.
- **Evolución** (`#evo`) — **solo snapshots reales** (`/api/state.history`): tendencia de probabilidad de campeón
  con sparkline + Δ vs primer snapshot. Si <2 snapshots → estado honesto "aún no hay suficientes snapshots". **No se
  fabrica histórico.**
- **Registro** (`#registry`) — desde `/api/beta/history`: KPIs (Picks/Liquidadas/Aciertos/Muestra), historial de
  Picks (selección/cuota/estado/resultado/modelo-era customer-friendly), nota de **muestra insuficiente** (no se
  afirma rentabilidad). ES/EN.
- **Metodología** (`#method`) — explica GP Intelligence (prob inicial → contexto → prob GP final) **sin V1/V2
  interno**: base estadística, contexto, mercado, incertidumbre, Picks/Value (manuales/no auto-publicados), Goal
  Engine en validación, limitaciones. ES/EN.

## §29 — Observatory de cobertura (admin)

Nuevo endpoint `GET /api/beta/observatory` (**solo admin**, 403/401 si no) + `repo.coverageObservatory`: eventos
canónicos (total/próximos/pasados), **con evaluación GP**, próximos evaluados/**pendientes**, distribución
`FULL/PARTIAL/BASE_ONLY`, frescura de snapshots. Vista premium `#admin` que lo muestra. Read-only, sin escrituras.

## 4B — Plumbing aditivo (sin cambiar el universo evaluado)

`value-engine/config.js` ahora expone `evaluationHorizonHours` desde `GP_INTELLIGENCE_EVALUATION_HORIZON_HOURS`
(default **null = comportamiento actual**). **NO cambia qué se evalúa** — ampliar la cobertura a todos los fixtures
requiere además cablear `linkedEvents()` + ingesta/auto-match (decisión operativa/costo de Alexis, toca el motor en
vivo). El Observatory hace visible esa brecha.

## 4A — Patrón canónico (verificado, sin refactor riesgoso)

El patrón **PARTIDO CANÓNICO → GP INTELLIGENCE → superficies** ya se cumple a nivel de lectura: Oportunidades,
Partidos, Equipos, Bracket, Grupos y deep-links **abren el mismo DTO canónico** (`/api/beta/match` vía `buildMatch`,
o el modo `fx-` desde `/api/match` para partidos sin evaluación). El botón volver conserva el origen (`returnTo`).
Consolidar todo en un único servicio server-side `buildPremiumMatchIntelligence` queda como refactor opcional
futuro (no aporta valor visible y agrega riesgo).

## QA (preview :3011, DB prod read-only, admin)
- 1440×900 + 390×844: **0 overflow**, **0 errores de consola**.
- Verificado: Equipos (48, ladder), Equipo detalle (Argentina: avance/forma V-E-D/próximo+recientes/noticias),
  Grupos (12 tablas + avance), Bracket (5 rondas, 1X2-90 separado de avance, cruces→cockpit), Evolución (sparklines,
  solo reales), Registro (Picks+muestra insuficiente), Metodología (sin V1/V2), Admin Observatory (cobertura),
  toggle EN (Metodología/superficies sin keys crudas ni fuga ES).
- Tests: `premium-confidence` 10/0, `premium-i18n` 9/0 (paridad ES/EN del diccionario, +claves 4H), `gp-product`
  41/0, `value-engine` 36/0.

## Invariantes (intactos)
509 usuarios/auth/sesiones · Verified Epoch · Registry · Picks/Signals V1=2 · modelo forward-only · sin fallback
silencioso a V1 · goles en validación · arbitraje/billing/públicos/auto-exec OFF · **ninguna migración** (todo
aditivo: 1 endpoint admin read-only + 1 config null + UI) · `app.js` NO tocado · **no se fabricó** prob histórica/
mercado/sede/clima/alineación/noticia · no auto-publicación.

## Estado de los cortes de Fase 4
- **HECHO:** 4C#7, 4C#8, 4D#10 (audit), 4D#11, 4F (Simulador+V/E/D+test), 4G, **4H completo (Equipos/Grupos/Bracket/
  Evolución/Registro/Metodología)**, §29 Observatory, 4B plumbing, 4A verificado.
- **DIFERIDO (operativo/backend, decisión de Alexis):** 4B cobertura total real (ingesta/auto-match + costo API),
  4A servicio único server-side (refactor opcional), 4C#6 persistencia forward-only de snapshots (escritura motor),
  4D#12 sede/clima exacto (no hay datos → no fabricar), 4F narrativa estructurada del backend en DTOs oficiales.

## STOP
Detenido tras todo lo entregable sin tocar el motor en vivo ni datos históricos. **NO** fusionar `/x` con la
principal, **NO** G.7/referidos/email/billing/beta externa. Esperando tu revisión y feedback.
